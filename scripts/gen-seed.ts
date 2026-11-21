/**
 * Genera supabase/seed.sql a partir de:
 *  - packages/domain/src/defaults.ts (config comercial = producción relevada)
 *  - data/woo-urls.json (árbol de categorías público relevado de franzebi.ar)
 * NO incluye productos, clientes ni pedidos: esos entran por sync (dry-run primero) y por importación controlada.
 * Uso: npx tsx scripts/gen-seed.ts
 */
import fs from "node:fs";
import { DEFAULT_PAYMENTS, DEFAULT_SAMEDAY, DEFAULT_SHIPPING, DEFAULT_WHOLESALE } from "../packages/domain/src/index.js";

const q = (s: string | null | undefined) => (s == null ? "null" : `'${String(s).replace(/'/g, "''")}'`);
const j = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`;

const woo = JSON.parse(fs.readFileSync("data/woo-urls.json", "utf8")) as {
  categories: Array<{ woo_id: number; parent: number; slug: string; name: string; url: string; count: number }>;
};

const out: string[] = [
  "-- GENERADO por scripts/gen-seed.ts — no editar a mano",
  "begin;",
  "insert into public.price_lists (code, name, currency) values ('retail','General','ARS'), ('wholesale','MAYORISTA','ARS') on conflict (code) do nothing;",
];

const settings: Record<string, { value: unknown; public: boolean }> = {
  payments: { value: DEFAULT_PAYMENTS, public: false },
  shipping: { value: { ...DEFAULT_SHIPPING, motoZones: undefined }, public: false },
  sameday: { value: DEFAULT_SAMEDAY, public: true },
  contact: { value: { whatsapp: "+54 9 11 2872-0954", email: "franzebi.imports@gmail.com", instagram: "@franzebi.imports" }, public: true },
  notifications: { value: { newOrderTo: ["Franzebi.imports@gmail.com"] }, public: false },
  // D-18 (2026-11-21): los pedidos salen hacia AstroSelling. Para dejar de usarlo, cambiar la lista de sinks.
  integrations: { value: { orderSinks: ["astroselling"] }, public: false },
  // D-13 aprobado (2026-11-21): FAQ reescrito según reglas confirmadas (sin crypto ni tecnología). Editable desde /admin/configuracion.
  faq: {
    public: true,
    value: {
      items: [
        {
          q: "¿Qué medios de pago aceptan?",
          a: "Transferencia bancaria y efectivo. El efectivo tiene 5% de descuento y es únicamente al retirar tu pedido por el local. Los pedidos con transferencia quedan En espera hasta que validamos el pago; podés enviarnos el comprobante por WhatsApp.",
        },
        {
          q: "¿Cómo se abonan los envíos?",
          a: "Todos los envíos (moto y Correo Argentino) se abonan por anticipado, por transferencia bancaria.",
        },
        {
          q: "¿Cuánto demoran los envíos?",
          a: "CABA y alrededores (moto): si el pago se acredita antes de las 11:30 hs, la entrega es en el día, de 16 a 22 hs. Si no, se entrega el siguiente día hábil.\nResto del país: por Correo Argentino, 2 a 4 días hábiles según la zona.",
        },
        {
          q: "¿Cuánto cuesta el envío en moto?",
          a: "CABA: $4.000 · Primer cordón: $6.000 · Zona azul: $8.000 · Zona roja: $9.500. El costo exacto se calcula en el checkout según tu código postal y localidad. Si tu zona no tiene cobertura de moto, podés elegir Correo Argentino o retirar por el local.",
        },
        {
          q: "¿Puedo retirar por el local?",
          a: "Sí, el retiro por el local está disponible para todas las zonas y no tiene costo.",
        },
        {
          q: "¿Cómo consigo precios mayoristas?",
          a: "Funciona por puntos. Cada perfume árabe suma 1 punto; cada perfume de diseñador suma 2 puntos en la primera compra y 1,5 en re-stock; cada producto de cosmética suma 0,5. Los decants no suman puntos.\nPrimera compra mayorista: 10 puntos. Al confirmarse esa compra, tu cuenta pasa a mayorista.\nRe-stock (cuentas mayoristas): 3 puntos.\nEn el carrito vas a ver cuántos puntos llevás y cuántos te faltan.",
        },
        {
          q: "¿Los perfumes de diseñador tienen stock?",
          a: "Los perfumes de diseñador se manejan a pedido. Consultanos por WhatsApp desde la ficha del producto y te pasamos disponibilidad y precio.",
        },
      ],
    },
  },
  catalog: {
    value: {
      hiddenRootCategories: ["electronica"],
      onRequestCategories: ["disenador-masculinas", "disenador-femeninas", "fragancias-femeninas-cosmetica"],
      hideDesignerPrices: true, // D-08
      placeholderOnImageError: true,
      menu: [
        { label: "Inicio", href: "/" },
        { label: "Fragancias Masculinas", href: "/product-category/perfumeria/fragancias-masculinas/" },
        { label: "Fragancias Femeninas", href: "/product-category/perfumeria/fragancias-femeninas/" },
        { label: "Fragancias Kids", href: "/product-category/perfumeria/fragancias-kids/" },
        { label: "FAQs", href: "/faq/" },
        { label: "Contacto", href: "/contacto/" },
      ],
    },
    public: true,
  },
};
for (const [k, v] of Object.entries(settings)) {
  out.push(`insert into public.settings (key, value, is_public) values (${q(k)}, ${j(v.value)}, ${v.public}) on conflict (key) do update set value = excluded.value, is_public = excluded.is_public;`);
}

DEFAULT_SHIPPING.motoZones.forEach((z, i) => {
  const ranges = `array[${(z.postcodeRanges ?? []).map(([a, b]) => `int4range(${a},${b},'[]')`).join(",")}]::int4range[]`;
  const cities = `array[${(z.cities ?? []).map(q).join(",")}]::text[]`;
  out.push(`insert into public.shipping_zones (id,label,price_cents,is_caba,cities,postcode_ranges,same_day_eligible,sort) values (${q(z.id)},${q(z.label)},${z.priceCents},${!!z.caba},${cities},${ranges},${z.sameDayEligible},${i}) on conflict (id) do nothing;`);
});

const W = DEFAULT_WHOLESALE;
out.push(
  `insert into public.wholesale_rules (version, active, first_purchase_threshold, restock_threshold, groups, notes) values (1, true, ${W.firstPurchaseThreshold}, ${W.restockThreshold}, ${j(W.groups)}, ${q("Réplica de snippets WP #6/#7/#31. D-04 y D-05 confirmados por el dueño (2026-11-21).")}) on conflict (version) do nothing;`,
);

// Categorías: orden padre->hijo. Se agregan las que la Store API oculta por estar vacías y son requeridas.
type Cat = { woo_id: number | null; parent: number; slug: string; name: string; url: string };
const cats: Cat[] = woo.categories.map((c) => ({ ...c }));
const has = (slug: string) => cats.some((c) => c.slug === slug);
if (!has("jo-milano-dis-masc"))
  cats.push({ woo_id: null, parent: 70, slug: "jo-milano-dis-masc", name: "Jo Milano – Dis Masc", url: "/product-category/perfumeria/fragancias-masculinas/disenador-masculinas/jo-milano-dis-masc/" });
if (!has("fragancias-femeninas-cosmetica"))
  cats.push({ woo_id: null, parent: 68, slug: "fragancias-femeninas-cosmetica", name: "Cosmética", url: "/product-category/perfumeria/fragancias-femeninas/fragancias-femeninas-cosmetica/" });

const path = (c: Cat) => c.url.replace(/^\/product-category\//, "").replace(/\/$/, "");
const depth = (c: Cat) => path(c).split("/").length;
cats.sort((a, b) => depth(a) - depth(b) || a.slug.localeCompare(b.slug));
for (const c of cats) {
  const p = path(c);
  const parentPath = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : null;
  const visible = !(p === "electronica" || p.startsWith("electronica/") || p === "sin-categoria");
  out.push(
    `insert into public.categories (parent_id, slug, name, path, legacy_woo_id, is_visible, show_in_menu) values (${parentPath ? `(select id from public.categories where path = ${q(parentPath)})` : "null"}, ${q(c.slug)}, ${q(c.name)}, ${q(p)}, ${c.woo_id ?? "null"}, ${visible}, ${visible}) on conflict (path) do nothing;`,
  );
}

// Redirects conocidos (las URLs de producto y categoría se conservan idénticas => sin 301 masivos)
const redirects: Array<[string, string, number]> = [
  ["/product-category/perfumeria/fragancias-masculinas/fragancias-masculinas-arabes/", "/product-category/perfumeria/fragancias-masculinas/arabes-masculinas/", 301], // snippet #48
  ["/contact/", "/contacto/", 301],
  ["/shop/", "/", 301],
  ["/wp-sitemap.xml", "/sitemap.xml", 301],
  ["/track-order/", "/mi-cuenta/", 301],
  ["/refund_returns/", "/faq/", 301],
  ["/returns-cancellations/", "/faq/", 301],
  ["/terms-conditions/", "/faq/", 301], // D-12: hasta que exista página de términos propia
  // Contenido demo del theme VamTam "Debebe" publicado e indexable: 410 (D-12, confirmar)
  ...["/our-difference/", "/our-blog/", "/look-books/", "/multi-brand/", "/hand-made/", "/shop-by-brands/", "/look-book-chapter-1/", "/look-book-chapter-2/", "/look-book-chapter-3/",
    "/landing-page/", "/classes-events/", "/about/", "/wishlist/", "/purchase-summary/", "/category/lookbooks/", "/category/news/",
    "/bobo-choses-spring-summer-2020-lookbook-a-dance-romance/", "/prepping-for-a-new-school-year/", "/keep-your-childs-mind-active-this-summer/", "/summer-swim-lookbook/",
    "/tinycottons-tiny-explorers/", "/bobo-choses-iconic-collection/", "/can-you-spoil-a-newborn/", "/stephanie-minkoffs-style-favorites/",
    "/the-animals-observatory-pre-fall-2022-collection/", "/baby-clothes-tredns-for-2021-and-beyond/", "/winter-indoor-activities-for-babies-and-children/",
    "/author/alejandrolader-com-ar/", "/author/franzebi/", "/product-category/standard-shop/"].map((p) => [p, "/", 410] as [string, string, number]),
];
for (const [from, to, code] of redirects) out.push(`insert into public.redirects (from_path,to_path,status_code,source) values (${q(from)},${q(to)},${code},'seed') on conflict do nothing;`);

out.push("commit;");
fs.writeFileSync("supabase/seed.sql", out.join("\n") + "\n");
console.log(`seed.sql: ${cats.length} categorías, ${DEFAULT_SHIPPING.motoZones.length} zonas, ${redirects.length} redirects`);
