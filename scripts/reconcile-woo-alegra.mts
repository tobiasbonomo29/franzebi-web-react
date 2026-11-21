/**
 * Conciliación Woo ⇄ Alegra por SKU (sólo lectura en ambos lados).
 * Uso:
 *   node --env-file=.env.local --import tsx scripts/reconcile-woo-alegra.mts <woo-store-api-products.json> <dir-salida>
 * El JSON de Woo es el volcado de /wp-json/wc/store/v1/products (público). La salida va FUERA del repo (exports/ está git-ignored).
 */
import fs from "node:fs";
import path from "node:path";
import { AlegraSource, mapWooToAlegra, normalizeSku, type CatalogRecord } from "../packages/sync/src/index.js";

const [wooPath, outDir] = process.argv.slice(2);
if (!wooPath || !outDir) throw new Error("uso: reconcile-woo-alegra.ts <woo.json> <dir-salida>");
const env = (k: string) => process.env[k] ?? (() => { throw new Error(`Falta ${k}`); })();

interface WooP { id: number; sku: string; name: string; prices: { price: string }; is_in_stock: boolean; is_purchasable: boolean; categories: Array<{ slug: string }> }
const woo = JSON.parse(fs.readFileSync(wooPath, "utf8")) as WooP[];

const src = new AlegraSource({ email: env("ALEGRA_API_EMAIL"), token: env("ALEGRA_API_TOKEN"), retailPriceListName: env("ALEGRA_RETAIL_PRICE_LIST"), wholesalePriceListName: env("ALEGRA_WHOLESALE_PRICE_LIST") });
const alegra: CatalogRecord[] = [];
const rejects: Array<{ sourceId: string; code: string; message: string }> = [];
let cursor: string | null = null;
let pages = 0;
do {
  const p = await src.fetchPage(cursor);
  alegra.push(...p.records);
  rejects.push(...p.rejects);
  cursor = p.next;
  if (++pages % 10 === 0) process.stderr.write(`  ${alegra.length} ítems…\n`);
} while (cursor);

const aBySku = new Map<string, CatalogRecord[]>();
for (const r of alegra) aBySku.set(normalizeSku(r.sku), [...(aBySku.get(normalizeSku(r.sku)) ?? []), r]);
const wBySku = new Map(woo.map((p) => [normalizeSku(p.sku), p]));
const seg = (sku: string) => sku.split("_").slice(0, 2).join("_");
const count = <T>(xs: T[], f: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});

const dupInAlegra = [...aBySku].filter(([, v]) => v.length > 1).map(([sku, v]) => ({ sku, ids: v.map((r) => r.sourceId), names: v.map((r) => r.name) }));
const onlyWoo = woo.filter((p) => !aBySku.has(normalizeSku(p.sku))).map((p) => ({ sku: p.sku, name: p.name, woo_id: p.id }));
const onlyAlegra = alegra.filter((r) => !wBySku.has(normalizeSku(r.sku)));
const both = alegra.filter((r) => wBySku.has(normalizeSku(r.sku)));
const priceDiff = both
  .map((r) => ({ r, w: wBySku.get(normalizeSku(r.sku))! }))
  .filter(({ r, w }) => Number(w.prices.price) > 0 && r.retailPriceCents != null && Number(w.prices.price) !== r.retailPriceCents)
  .map(({ r, w }) => ({ sku: r.sku, name: r.name, woo: Number(w.prices.price) / 100, alegra: r.retailPriceCents! / 100 }));
const stockDiff = both
  .map((r) => ({ r, w: wBySku.get(normalizeSku(r.sku))! }))
  .filter(({ r, w }) => w.is_in_stock !== r.stock > 0)
  .map(({ r, w }) => ({ sku: r.sku, name: r.name, wooInStock: w.is_in_stock, alegraStock: r.stock }));

const mapping = mapWooToAlegra(woo, alegra);
const legacyMap = mapping.map((m) => ({ woo_id: m.woo.id, woo_sku: m.woo.sku, woo_name: m.woo.name, alegra_sku: m.alegra?.sku ?? null, rule: m.rule, candidates: m.candidates?.map((c) => c.sku) }));
const mappedAlegra = new Set(mapping.filter((m) => m.alegra).map((m) => normalizeSku(m.alegra!.sku)));
const alegraSinFichaWoo = alegra.filter((r) => !mappedAlegra.has(normalizeSku(r.sku)));

const summary = {
  mapeoWooAlegra: { porRegla: count(mapping, (m) => m.rule), sinMatch: mapping.filter((m) => m.rule === "unmatched").map((m) => m.woo.sku), ambiguos: mapping.filter((m) => m.rule === "ambiguous").length },
  alegraSinFichaWoo: { n: alegraSinFichaWoo.length, activosConStock: alegraSinFichaWoo.filter((r) => r.active && r.stock > 0).length, porSegmento: count(alegraSinFichaWoo, (r) => seg(r.sku).replace(/^(TESTER|KARSEELL|VS|DECANTFALSO)w*$/, "$1*")) },
  generado: new Date().toISOString(),
  alegra: { items: alegra.length, rechazados: rejects.length, rechazosPorCodigo: count(rejects, (x) => x.code), activos: alegra.filter((r) => r.active).length, porSegmento: count(alegra, (r) => seg(r.sku)) },
  woo: { productos: woo.length },
  skuDuplicadosEnAlegra: dupInAlegra.length,
  soloEnWoo: { n: onlyWoo.length, porSegmento: count(onlyWoo, (x) => (/^\d+$/.test(x.sku) ? "numérico" : seg(x.sku))) },
  soloEnAlegra: { n: onlyAlegra.length, activos: onlyAlegra.filter((r) => r.active).length, conStock: onlyAlegra.filter((r) => r.stock > 0).length, porSegmento: count(onlyAlegra, (r) => seg(r.sku)) },
  enAmbos: both.length,
  sinPrecioMinorista: alegra.filter((r) => r.active && r.retailPriceCents == null).length,
  sinPrecioMayorista: alegra.filter((r) => r.active && r.wholesalePriceCents == null).length,
  mayoristaMayorQueMinorista: alegra.filter((r) => r.wholesalePriceCents != null && r.retailPriceCents != null && r.wholesalePriceCents > r.retailPriceCents).length,
  diferenciasPrecio: { n: priceDiff.length, muestra: priceDiff.slice(0, 10) },
  diferenciasStock: { n: stockDiff.length, muestra: stockDiff.slice(0, 10) },
};
fs.mkdirSync(outDir, { recursive: true });
const w = (n: string, d: unknown) => fs.writeFileSync(path.join(outDir, n), JSON.stringify(d, null, 1));
w("resumen.json", summary);
w("solo-en-woo.json", onlyWoo);
w("solo-en-alegra.json", onlyAlegra.map((r) => ({ sku: r.sku, name: r.name, active: r.active, stock: r.stock, retail: r.retailPriceCents, cat: r.categoryPath })));
w("duplicados-alegra.json", dupInAlegra);
w("diferencias-precio.json", priceDiff);
w("diferencias-stock.json", stockDiff);
w("rechazos.json", rejects);
w("mapeo-woo-alegra.json", legacyMap);
w("alegra-sin-ficha-woo.json", alegraSinFichaWoo.map((r) => ({ sku: r.sku, name: r.name, active: r.active, stock: r.stock, retail: r.retailPriceCents })));
const { diferenciasPrecio: _p, diferenciasStock: _s, alegra: _a, soloEnAlegra: _sa, ...brief } = summary;
console.log(JSON.stringify({ ...brief, diferenciasPrecio: _p.n, diferenciasStock: _s.n }, null, 1));
