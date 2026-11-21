import { SinkError, type OrderEvent, type OrderSink, type SinkOrder } from "./orders.js";

/**
 * Facturación directa en Alegra (alternativa a AstroSelling, D-18 / D-27).
 *
 * Replica la factura que hoy genera AstroSelling para cada pedido web (relevado 2026-11-21, factura 10714):
 *   - numeración "TICKET" (id 3, INVOICE_X, no electrónica)  - depósito "Principal" (id 1)
 *   - lista de precios "MINORISTA" (o "MAYORISTA" si el pedido aplicó precio mayorista)
 *   - saleCondition TRANSFER (efectivo => CASH), sin vendedor, sin IVA
 *   - observations: "Venta https://franzebi.ar #<n> - Facturado desde <origen>"
 *   - cliente consumidor final (se busca por documento; si no existe se crea)
 * Al emitirse la factura Alegra descuenta el stock: el sync luego lo trae de vuelta a la tienda.
 *
 * Idempotencia: antes de crear, se busca entre las últimas facturas una con la misma marca "#<n> -".
 * Cancelación/reembolso del pedido => se anula la factura (POST /invoices/{id}/void).
 */
export interface AlegraInvoiceConfig {
  email: string;
  token: string;
  siteUrl: string;                 // https://franzebi.ar
  numberTemplateId: string;        // "3" (TICKET)
  warehouseId: string;             // "1" (Principal)
  retailPriceListId: string;       // id de "MINORISTA"
  wholesalePriceListId?: string;   // id de "MAYORISTA"
  shippingItemId?: string;         // ítem "ENVIO" de Alegra (si se quiere facturar el envío; AstroSelling hoy no lo factura)
  status?: "open" | "draft";       // "draft" para validar las primeras facturas antes de emitirlas
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  minIntervalMs?: number;
}

const BASE = "https://api.alegra.com/api/v1";
const pesos = (cents: number) => Math.round(cents / 100);
const arDate = (iso: string, plusDays = 0) => {
  const d = new Date(new Date(iso).getTime() + plusDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(d); // YYYY-MM-DD
};

export function invoiceMarker(order: Pick<SinkOrder, "number">, siteUrl: string) {
  return `Venta ${siteUrl.replace(/\/$/, "")} #${order.number} -`;
}

/** Arma el payload de POST /invoices (puro, testeable). */
export function toAlegraInvoice(order: SinkOrder, clientId: string, cfg: AlegraInvoiceConfig) {
  const missing = order.items.filter((i) => !i.sourceId).map((i) => i.sku);
  if (missing.length) throw new SinkError(`Ítems sin id de Alegra: ${missing.join(", ")}`, false);
  const cashPct = order.cashDiscountCents > 0 && order.subtotalCents > 0 ? Math.round((order.cashDiscountCents / order.subtotalCents) * 10000) / 100 : 0;
  const items = order.items.map((i) => ({ id: i.sourceId!, price: pesos(i.unitPriceCents), quantity: i.quantity, discount: cashPct }));
  if (cfg.shippingItemId && order.shippingCents > 0) items.push({ id: cfg.shippingItemId, price: pesos(order.shippingCents), quantity: 1, discount: 0 });
  const host = new URL(cfg.siteUrl).host;
  return {
    date: arDate(order.placedAt),
    dueDate: arDate(order.placedAt, 30),
    client: { id: clientId },
    numberTemplate: { id: cfg.numberTemplateId },
    warehouse: { id: cfg.warehouseId },
    priceList: { id: order.wholesaleApplied && cfg.wholesalePriceListId ? cfg.wholesalePriceListId : cfg.retailPriceListId },
    saleCondition: order.paymentMethod === "cash" ? "CASH" : "TRANSFER",
    observations: `${invoiceMarker(order, cfg.siteUrl)} Facturado desde ${host}`,
    items,
    ...(cfg.status === "draft" ? { status: "draft" } : {}),
  };
}

export class AlegraInvoiceSink implements OrderSink {
  readonly name = "alegra";
  private last = 0;
  constructor(private cfg: AlegraInvoiceConfig) {
    if (!cfg.email || !cfg.token) throw new Error("Faltan ALEGRA_API_EMAIL / ALEGRA_API_TOKEN");
    if (!cfg.retailPriceListId) throw new Error("Falta ALEGRA_INVOICE_PRICE_LIST_ID (lista MINORISTA)");
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const wait = this.last + (this.cfg.minIntervalMs ?? 450) - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = Date.now();
    const res = await (this.cfg.fetchImpl ?? fetch)(`${this.cfg.baseUrl ?? BASE}${path}`, {
      method,
      headers: { Authorization: `Basic ${Buffer.from(`${this.cfg.email}:${this.cfg.token}`).toString("base64")}`, "Content-Type": "application/json", Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) {
      const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
      let msg = text.slice(0, 300);
      try { msg = (JSON.parse(text) as { message?: string }).message ?? msg; } catch { /* texto plano */ }
      throw new SinkError(`Alegra ${method} ${path.split("?")[0]} HTTP ${res.status}: ${msg}`, retryable);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  /** Busca la factura de este pedido entre las últimas (evita duplicar si un intento anterior se cortó). */
  private async findExisting(order: SinkOrder) {
    const marker = invoiceMarker(order, this.cfg.siteUrl);
    for (let start = 0; start < 90; start += 30) {
      const list = await this.call<Array<{ id: string; observations?: string | null }>>("GET", `/invoices?start=${start}&limit=30&order_direction=DESC&order_field=id`);
      const hit = list.find((i) => (i.observations ?? "").startsWith(marker));
      if (hit) return hit.id;
      if (list.length < 30) break;
    }
    return null;
  }

  private async findOrCreateClient(order: SinkOrder) {
    const dni = (order.billing.dni ?? "").replace(/\D/g, "");
    if (dni) {
      const found = await this.call<Array<{ id: string | number }>>("GET", `/contacts?identification=${encodeURIComponent(dni)}&limit=1`);
      if (found?.[0]) return String(found[0].id);
    }
    const name = [order.billing.firstName, order.billing.lastName].filter(Boolean).join(" ").trim() || order.email;
    const a = order.shippingAddress ?? {};
    const created = await this.call<{ id: string | number }>("POST", "/contacts", {
      name,
      identificationObject: dni ? { type: "DNI", number: dni } : undefined,
      ivaCondition: "FINAL_CONSUMER",
      email: order.email,
      phonePrimary: order.billing.phone || undefined,
      address: { address: [a.street, a.number, a.apartment].filter(Boolean).join(" ") || undefined, city: a.city || undefined, province: a.state || undefined, postalCode: a.postcode || undefined },
      type: ["client"],
    });
    return String(created.id);
  }

  async send(ev: OrderEvent, order: SinkOrder) {
    const existingRef = order.externalRefs?.alegra;
    if (ev.event === "order.updated") {
      if ((order.status === "cancelled" || order.status === "refunded") && existingRef) {
        await this.call("POST", `/invoices/${encodeURIComponent(existingRef)}/void`, { cause: `Pedido web #${order.number} ${order.status === "cancelled" ? "cancelado" : "reembolsado"}` });
        return { externalRef: existingRef };
      }
      return { externalRef: existingRef }; // otros cambios de estado no afectan la factura
    }
    if (order.status === "cancelled" || order.status === "failed") return { externalRef: existingRef };
    if (existingRef) return { externalRef: existingRef };
    const prior = await this.findExisting(order);
    if (prior) return { externalRef: prior };
    const clientId = await this.findOrCreateClient(order);
    const inv = await this.call<{ id: string | number }>("POST", "/invoices", toAlegraInvoice(order, clientId, this.cfg));
    return { externalRef: String(inv.id) };
  }
}
