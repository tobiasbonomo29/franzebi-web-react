/**
 * CLI de sincronización.
 *   npm run sync:dry-run                        -> lee Alegra, valida, NO escribe nada (store en memoria)
 *   node --env-file=.env.local --import tsx packages/sync/src/cli.ts --apply --target=supabase
 * El modo --apply exige SYNC_ALLOW_APPLY=true en el entorno (doble llave contra corridas accidentales).
 */
import { createClient } from "@supabase/supabase-js";
import { AlegraSource } from "./alegra.js";
import { runCatalogSync } from "./engine.js";
import { HttpImageFetcher } from "./http-image-fetcher.js";
import { MemoryCatalogStore } from "./memory-store.js";
import { SupabaseCatalogStore } from "./supabase-store.js";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Falta variable de entorno ${k}`);
  return v;
};

if (apply && process.env.SYNC_ALLOW_APPLY !== "true") {
  console.error("Bloqueado: --apply requiere SYNC_ALLOW_APPLY=true (y aprobación explícita del dueño).");
  process.exit(2);
}

const source = new AlegraSource({
  email: env("ALEGRA_API_EMAIL"),
  token: env("ALEGRA_API_TOKEN"),
  retailPriceListName: process.env.ALEGRA_RETAIL_PRICE_LIST ?? "General",
  wholesalePriceListName: process.env.ALEGRA_WHOLESALE_PRICE_LIST ?? "MAYORISTA",
});

const store = args.has("--target=supabase")
  ? new SupabaseCatalogStore(createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } }))
  : new MemoryCatalogStore();

const t0 = Date.now();
const res = await runCatalogSync(source, store, new HttpImageFetcher(), {
  dryRun: !apply,
  trigger: `cli:${apply ? "apply" : "dry-run"}`,
  placeholderOnImageError: true,
});
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ms: Date.now() - t0, jobId: res.jobId, stats: res.stats }, null, 2));
if (store instanceof MemoryCatalogStore) {
  const byCode = store.errors.reduce<Record<string, number>>((m, e) => ((m[e.code] = (m[e.code] ?? 0) + 1), m), {});
  console.log("errores por código:", byCode);
  console.log("muestra:", store.errors.slice(0, 20).map((e) => `${e.sku ?? e.sourceId ?? "-"} [${e.code}] ${e.message}`));
}
