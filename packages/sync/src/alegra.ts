import { toCents } from "@franzebi/domain";
import type { CatalogRecord, CatalogSource, SourcePage } from "./types.js";

/**
 * Adaptador Alegra (API v1). Credenciales SÓLO por variables de entorno:
 *   ALEGRA_API_EMAIL, ALEGRA_API_TOKEN, ALEGRA_RETAIL_PRICE_LIST, ALEGRA_WHOLESALE_PRICE_LIST (=MAYORISTA)
 * Reglas:
 *  - SKU = item.reference (igual que el sync actual de WordPress). Se hace trim; vacío => rechazo.
 *  - Precio mayorista = lista cuyo NOMBRE es "MAYORISTA" en ARS. Listas en USD se ignoran.
 *  - Nunca se calcula un precio: si falta, queda null y se reporta.
 *
 * Campos verificados contra la API real (2026-11-21): price[].id, inventory.availableQuantity, itemCategory, reference.
 * Alegra NO devuelve imágenes de ítems: las fotos se migran desde Woo y el sync no las toca si el origen no trae.
 * Lista minorista vigente: "ARABES MINORISTA (pesos)" (D-10, confirmado por el dueño; es la lista principal en Alegra).
 */

export interface AlegraConfig {
  baseUrl?: string;
  email: string;
  token: string;
  retailPriceListName: string; // p.ej. "General" — D-10 confirmar
  wholesalePriceListName: string; // "MAYORISTA"
  pageSize?: number; // Alegra máx 30
  fetchImpl?: typeof fetch;
  minIntervalMs?: number; // espaciado entre requests (default 450 ms ≈ 133/min)
}

interface AlegraPriceList { id: string | number; name: string; currency?: { code?: string } | string | null; status?: string }
interface AlegraItem {
  id: string | number;
  name: string;
  reference?: string | { reference?: string } | null;
  status?: string;
  price?: Array<{ id?: string | number; idPriceList?: string | number; name?: string; price: number | string; currency?: { code?: string } | string }>;
  inventory?: { availableQuantity?: number | string } | null;
  itemCategory?: { name?: string } | null;
  category?: { name?: string } | null;
  images?: Array<{ url?: string; favorite?: boolean }> | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const currencyOf = (c: unknown): string => (typeof c === "string" ? c : (c as { code?: string } | null)?.code ?? "ARS").toUpperCase();

export class AlegraSource implements CatalogSource {
  readonly name = "alegra";
  private lists: { retail: string; wholesale: string | null } | null = null;
  constructor(private cfg: AlegraConfig) {
    if (!cfg.email || !cfg.token) throw new Error("Faltan ALEGRA_API_EMAIL / ALEGRA_API_TOKEN en el entorno");
  }

  private lastCall = 0;
  private async get<T>(path: string): Promise<T> {
    const f = this.cfg.fetchImpl ?? fetch;
    // Alegra: 150 requests/min (X-Rate-Limit-Limit). Se espacian las llamadas y se respeta el 429.
    const BACKOFF_5XX = [5_000, 15_000, 30_000, 60_000];
    for (let attempt = 0; attempt <= BACKOFF_5XX.length; attempt++) {
      const wait = this.lastCall + (this.cfg.minIntervalMs ?? 450) - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastCall = Date.now();
      const res = await f(`${this.cfg.baseUrl ?? "https://api.alegra.com/api/v1"}${path}`, {
        headers: {
          Authorization: "Basic " + Buffer.from(`${this.cfg.email}:${this.cfg.token}`).toString("base64"),
          Accept: "application/json",
        },
      });
      if (res.status === 429 || res.status >= 500) {
        if (attempt === BACKOFF_5XX.length) throw Object.assign(new Error(`Alegra HTTP ${res.status} en ${path.split("?")[0]}`), { retryable: true });
        await sleep(res.status === 429 ? Number(res.headers.get("x-rate-limit-reset") ?? 60) * 1000 : BACKOFF_5XX[attempt]!);
        continue;
      }
      if (!res.ok) throw Object.assign(new Error(`Alegra HTTP ${res.status} en ${path.split("?")[0]}`), { retryable: false });
      return (await res.json()) as T;
    }
    throw new Error("unreachable");
  }

  private async resolveLists() {
    if (this.lists) return this.lists;
    const all = await this.get<AlegraPriceList[]>("/price-lists");
    // Listas en USD se ignoran: por moneda Y por nombre (en Alegra "ARABES MAYORISTA usd" figura con currency ARS).
    const ars = all.filter((l) => currencyOf(l.currency) === "ARS" && !/\busd\b/i.test(l.name) && (l.status ?? "active") === "active");
    const byName = (n: string) => ars.find((l) => l.name.trim().toUpperCase() === n.trim().toUpperCase());
    const retail = byName(this.cfg.retailPriceListName);
    if (!retail) throw new Error(`No existe lista ARS "${this.cfg.retailPriceListName}" en Alegra`);
    const wholesale = byName(this.cfg.wholesalePriceListName);
    this.lists = { retail: String(retail.id), wholesale: wholesale ? String(wholesale.id) : null };
    return this.lists;
  }

  async fetchPage(cursor: string | null): Promise<SourcePage> {
    const lists = await this.resolveLists();
    const start = Number(cursor ?? 0);
    const limit = Math.min(this.cfg.pageSize ?? 30, 30);
    const items = await this.get<AlegraItem[]>(`/items?start=${start}&limit=${limit}&order_field=id`);
    const records: CatalogRecord[] = [];
    const rejects: SourcePage["rejects"] = [];
    for (const it of items) {
      const sourceId = String(it.id);
      const ref = typeof it.reference === "object" ? it.reference?.reference : it.reference;
      const sku = String(ref ?? "").trim();
      if (!sku) { rejects.push({ sourceId, code: "missing_sku", message: `Ítem "${it.name}" sin referencia/SKU en Alegra` }); continue; }
      const priceFor = (listId: string | null) => {
        if (!listId) return null;
        // La API devuelve el id de la lista en `id` (verificado 2026-11-21); `idPriceList` se acepta por compatibilidad.
        const row = (it.price ?? []).find((p) => String(p.idPriceList ?? p.id) === listId && currencyOf(p.currency ?? "ARS") === "ARS");
        if (!row) return null;
        const n = Number(row.price);
        return Number.isFinite(n) && n > 0 ? toCents(n) : null;
      };
      const cat = it.itemCategory?.name ?? it.category?.name ?? "";
      records.push({
        sku,
        sourceId,
        name: String(it.name ?? "").trim(),
        retailPriceCents: priceFor(lists.retail),
        wholesalePriceCents: priceFor(lists.wholesale),
        stock: Math.max(0, Math.floor(Number(it.inventory?.availableQuantity ?? 0)) || 0),
        categoryPath: cat ? cat.split(/\s*[>/]\s*/).filter(Boolean) : [],
        imageUrls: (it.images ?? []).sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite)).map((i) => i.url).filter((u): u is string => !!u),
        active: (it.status ?? "active") === "active",
      });
    }
    return { records, rejects, next: items.length < limit ? null : String(start + limit) };
  }
}
