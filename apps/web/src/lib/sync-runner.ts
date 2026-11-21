import "server-only";
import { AlegraSource, HttpImageFetcher, runCatalogSync, SupabaseCatalogStore } from "@franzebi/sync";
import { loadCommerceConfig } from "./config";
import { env } from "./env";
import { adminClient } from "./supabase";

/** Ejecuta el sync de catálogo. `apply` real sólo si SYNC_ALLOW_APPLY=true (doble llave). */
export async function runSync(opts: { apply: boolean; trigger: string; onlySkus?: string[] }) {
  const e = env();
  if (!e.ALEGRA_API_EMAIL || !e.ALEGRA_API_TOKEN) throw new Error("Alegra no configurado (ALEGRA_API_EMAIL / ALEGRA_API_TOKEN)");
  const apply = opts.apply && e.SYNC_ALLOW_APPLY === "true";
  const cfg = await loadCommerceConfig();
  const db = adminClient();
  const { data: cats } = await db.from("categories").select("id, name, path");
  const resolveCategory = async (path: string[]) => {
    const last = path.at(-1)?.toLowerCase();
    return (cats ?? []).find((c) => c.name.toLowerCase() === last)?.id ?? null; // D-09: mapeo categoría Alegra ⇄ tienda a confirmar
  };
  return runCatalogSync(
    new AlegraSource({ email: e.ALEGRA_API_EMAIL, token: e.ALEGRA_API_TOKEN, retailPriceListName: e.ALEGRA_RETAIL_PRICE_LIST, wholesalePriceListName: e.ALEGRA_WHOLESALE_PRICE_LIST }),
    new SupabaseCatalogStore(db, { resolveCategory }),
    new HttpImageFetcher(),
    { dryRun: !apply, trigger: opts.trigger, placeholderOnImageError: cfg.catalog.placeholderOnImageError, onlySkus: opts.onlySkus },
  );
}
