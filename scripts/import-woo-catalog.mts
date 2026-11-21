/**
 * Importa la ficha de WooCommerce (slug/URL, nombre, descripciones, fotos, categorías, "a pedido", destacados)
 * sobre los productos que el sync de Alegra ya creó en Supabase. Alegra sigue mandando en precio, stock y estado.
 *
 *   node --env-file=.env.local --import tsx scripts/import-woo-catalog.mts            -> dry-run (no escribe)
 *   IMPORT_ALLOW_APPLY=true node --env-file=.env.local --import tsx scripts/import-woo-catalog.mts --apply
 *
 * Lee la Store API pública de franzebi.ar (sólo GET). No escribe nada en WordPress.
 * Mapeo Woo→Alegra con mapWooToAlegra (exact → entities → suffix → wildcard → name; ambiguos se saltean).
 * Idempotente: se puede correr de nuevo en el cutover para tomar los últimos cambios de fichas.
 */
import { createClient } from "@supabase/supabase-js";
import { decodeEntities, mapWooToAlegra } from "../packages/sync/src/index.js";

const ORIGIN = process.env.LEGACY_BASE_URL ?? "https://franzebi.ar";
const apply = process.argv.includes("--apply");
if (apply && process.env.IMPORT_ALLOW_APPLY !== "true") {
  console.error("Bloqueado: --apply requiere IMPORT_ALLOW_APPLY=true");
  process.exit(2);
}
const need = (k: string) => process.env[k] ?? (() => { throw new Error(`Falta ${k}`); })();
const db = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

type WooImage = { id: number; src: string; thumbnail: string; srcset: string; alt: string; name: string };
type WooProduct = {
  id: number; name: string; slug: string; permalink: string; sku: string; short_description: string; description: string;
  prices: { price: string }; price_html: string; images: WooImage[]; categories: Array<{ id: number }>;
  is_purchasable: boolean; is_in_stock: boolean;
};

async function storeApi<T>(q: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    let r: Response | null = null;
    for (let i = 0; i < 4; i++) {
      r = await fetch(`${ORIGIN}/wp-json/wc/store/v1/products?per_page=100&page=${page}&${q}`, { headers: { "user-agent": "franzebi-migration/1.0" } });
      if (r.ok) break;
      await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
    }
    if (!r?.ok) throw new Error(`Store API ${r?.status} page ${page}`);
    const rows = (await r.json()) as T[];
    out.push(...rows);
    const total = Number(r.headers.get("x-wp-totalpages") ?? 1);
    if (page >= total || rows.length === 0) break;
  }
  return out;
}

async function all<T>(table: string, cols: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data as T[]));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

const plain = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, "")).trim();
const pathOf = (u: string) => new URL(u).pathname;

const woo = await storeApi<WooProduct>("orderby=id&order=asc");
const featuredIds = new Set((await storeApi<{ id: number }>("featured=true")).map((p) => p.id));
console.log(`Woo: ${woo.length} fichas, ${featuredIds.size} destacadas`);

const products = await all<{ id: string; sku: string; name: string; slug: string; legacy_woo_id: number | null }>("products", "id, sku, name, slug, legacy_woo_id");
const cats = await all<{ id: string; legacy_woo_id: number | null; path: string }>("categories", "id, legacy_woo_id, path");
const catByWoo = new Map(cats.filter((c) => c.legacy_woo_id).map((c) => [Number(c.legacy_woo_id), c]));
console.log(`Supabase: ${products.length} productos (de Alegra), ${cats.length} categorías`);

const matches = mapWooToAlegra(woo.map((w) => ({ ...w, sku: w.sku || String(w.id) })), products);
const byRule = matches.reduce<Record<string, number>>((m, x) => ((m[x.rule] = (m[x.rule] ?? 0) + 1), m), {});
console.log("mapeo:", byRule);

const slugOwner = new Map(products.map((p) => [p.slug, p.id]));
const stats = { updated: 0, images: 0, categories: 0, slugMoved: 0, onRequest: 0, skipped: 0, errors: [] as string[] };

for (const m of matches) {
  const w = m.woo as unknown as WooProduct;
  const p = m.alegra as (typeof products)[number] | null;
  if (!p) { stats.skipped++; continue; }

  // Diseñador en Woo: sin precio y no comprable => "a pedido" con precio oculto (D-08)
  const onRequest = !w.price_html && !w.is_purchasable;
  if (onRequest) stats.onRequest++;

  // Categoría principal: la más profunda de las que tiene la ficha
  const wcats = w.categories.map((c) => catByWoo.get(c.id)).filter(Boolean) as Array<(typeof cats)[number]>;
  const primary = [...wcats].sort((a, b) => b.path.split("/").length - a.path.split("/").length)[0];

  const row = {
    slug: w.slug,
    name: decodeEntities(w.name),
    short_description: w.short_description || null,
    description: w.description || null,
    primary_category_id: primary?.id ?? null,
    legacy_woo_id: w.id,
    legacy_url: pathOf(w.permalink),
    published: true,
    featured: featuredIds.has(w.id),
    ...(onRequest ? { sale_mode: "on_request", hide_price: true } : { hide_price: false }),
    seo_description: plain(w.short_description || w.description).slice(0, 155) || null,
  };

  if (!apply) { stats.updated++; continue; }
  try {
    // Si otro producto (creado por el sync con el slug del nombre) ocupa el slug de Woo, se le corre el suyo.
    const owner = slugOwner.get(w.slug);
    if (owner && owner !== p.id) {
      const other = products.find((x) => x.id === owner)!;
      const alt = `${w.slug}-${other.sku.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`.slice(0, 160);
      const { error } = await db.from("products").update({ slug: alt }).eq("id", owner);
      if (error) throw new Error(`slug ${alt}: ${error.message}`);
      slugOwner.set(alt, owner);
      stats.slugMoved++;
    }
    const { error } = await db.from("products").update(row).eq("id", p.id);
    if (error) throw new Error(`update: ${error.message}`);
    slugOwner.set(w.slug, p.id);

    // Categorías (reemplazo completo por las de la ficha)
    await db.from("product_categories").delete().eq("product_id", p.id);
    if (wcats.length) {
      const { error: ce } = await db.from("product_categories").insert(wcats.map((c) => ({ product_id: p.id, category_id: c.id })));
      if (ce) throw new Error(`cats: ${ce.message}`);
      stats.categories += wcats.length;
    }

    // Imágenes: mismas URLs de /wp-content/uploads/ (se espejan al dominio en el cutover)
    await db.from("product_images").delete().eq("product_id", p.id).is("storage_path", null);
    if (w.images.length) {
      const { error: ie } = await db.from("product_images").upsert(
        w.images.map((img, i) => ({
          product_id: p.id, position: i, source_url: pathOf(img.src), legacy_url: pathOf(img.src), thumb_url: pathOf(img.thumbnail),
          srcset: img.srcset.replace(/https?:\/\/(www\.)?franzebi\.ar/g, ""), alt: decodeEntities(img.alt || w.name), status: "ok",
          mime: /\.png$/i.test(img.src) ? "image/png" : /\.webp$/i.test(img.src) ? "image/webp" : "image/jpeg",
        })),
        { onConflict: "product_id,position" },
      );
      if (ie) throw new Error(`images: ${ie.message}`);
      stats.images += w.images.length;
      await db.from("products").update({ has_placeholder_image: false }).eq("id", p.id);
    } else {
      await db.from("products").update({ has_placeholder_image: true }).eq("id", p.id);
    }
    stats.updated++;
    if (stats.updated % 200 === 0) console.log(`  ${stats.updated}…`);
  } catch (e) {
    stats.errors.push(`${w.sku} → ${p.sku}: ${(e as Error).message}`);
  }
}

console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...stats, errors: stats.errors.length, sampleErrors: stats.errors.slice(0, 15) }, null, 2));
