/**
 * Convierte las capturas de scripts/mirror-legacy.mjs (apps/web/src/legacy/pages/*.json) en plantillas con
 * marcadores <!--fz:nombre--> que la app completa con datos de Supabase.
 *
 *   node scripts/build-legacy-templates.mjs
 *
 * Además aplica las reglas de negocio del brief sobre el markup heredado:
 *  - Electrónica oculta (menú, footer "Tecnología", H1 SEO).
 *  - Ningún href="#" en el menú (los padres apuntan a su categoría).
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const IN = path.join(ROOT, "apps/web/src/legacy/pages");
const OUT = path.join(ROOT, "apps/web/src/legacy/templates");
const page = (n) => JSON.parse(fs.readFileSync(path.join(IN, `${n}.json`), "utf8"));

/** Elemento balanceado que empieza en `start` (índice del '<'). Devuelve [start, end, openEnd]. */
function bounds(html, start) {
  const tag = html.slice(start + 1).match(/^([a-zA-Z0-9-]+)/)[1];
  const re = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, "g");
  re.lastIndex = start;
  let d = 0;
  let m;
  let openEnd = -1;
  const voids = /^(img|input|br|hr|meta|link|source)$/i;
  while ((m = re.exec(html))) {
    if (openEnd < 0) openEnd = re.lastIndex;
    if (m[2] === "/" || voids.test(tag)) {
      if (d === 0) return [start, re.lastIndex, re.lastIndex];
      continue;
    }
    d += m[1] ? -1 : 1;
    if (d === 0) return [start, re.lastIndex, openEnd];
  }
  throw new Error(`elemento sin cierre en ${start}`);
}
/** Índice del '<' del elemento cuyo tag de apertura contiene `needle` (desde `from`). */
function startOf(html, needle, from = 0) {
  const i = html.indexOf(needle, from);
  if (i < 0) return -1;
  return html.lastIndexOf("<", i);
}
function must(i, what) {
  if (i < 0) throw new Error(`no encontrado: ${what}`);
  return i;
}
function replaceInner(html, needle, marker, from = 0) {
  const s = must(startOf(html, needle, from), needle);
  const [, end, openEnd] = bounds(html, s);
  const closeStart = html.lastIndexOf("</", end - 1);
  return html.slice(0, openEnd) + marker + html.slice(closeStart);
}
function replaceOuter(html, needle, marker, from = 0) {
  const s = must(startOf(html, needle, from), needle);
  const [, end] = bounds(html, s);
  return html.slice(0, s) + marker + html.slice(end);
}
function replaceAllInner(html, needle, markerFn) {
  let i = 0;
  let n = 0;
  for (;;) {
    const s = startOf(html, needle, i);
    if (s < 0 || html.indexOf(needle, i) < 0) break;
    const [, end, openEnd] = bounds(html, s);
    const closeStart = html.lastIndexOf("</", end - 1);
    const marker = markerFn(n++);
    html = html.slice(0, openEnd) + marker + html.slice(closeStart);
    i = openEnd + marker.length + 1;
  }
  return html;
}
/** Quita el <li> que contiene `needle` (el más cercano hacia arriba). */
function removeLi(html, needle) {
  let count = 0;
  for (;;) {
    const i = html.indexOf(needle);
    if (i < 0) return { html, count };
    const s = html.lastIndexOf("<li", i);
    const [, end] = bounds(html, s);
    html = html.slice(0, s) + html.slice(end);
    count++;
  }
}

const MENU_PARENTS = {
  "Fragancias Masculinas": "/product-category/perfumeria/fragancias-masculinas/",
  "Fragancias Femeninas": "/product-category/perfumeria/fragancias-femeninas/",
  "Fragancias Kids": "/product-category/perfumeria/fragancias-kids/",
  ARABES: null, // los hijos ya tienen URL; se resuelve abajo por contexto
};

function fixHeader(h) {
  // Electrónica: fuera del menú (desktop y mobile)
  let r = removeLi(h, 'href="/product-category/electronica/"');
  h = r.html;
  // Wishlist (plugin WPC Smart Wishlist): no se migra; se quita el acceso para no dejar un link roto
  h = removeLi(h, 'href="/mi-cuenta/wishlist/"').html;
  // href="#" en padres del menú -> su categoría
  h = h.replace(/<a href="#" class="elementor-(item|sub-item) elementor-item-anchor"([^>]*)>([^<]+)<\/a>/g, (all, kind, rest, text) => {
    const to = MENU_PARENTS[text.trim()];
    return to ? `<a href="${to}" class="elementor-${kind}"${rest}>${text}</a>` : all;
  });
  // Botón del mini-carrito: sin JS lleva al carrito
  h = h.replace(/id="elementor-menu-cart__toggle_button" href="#"/g, 'id="elementor-menu-cart__toggle_button" href="/carrito/"');
  const left = (h.match(/href="#"/g) || []).length;
  // Mini-carrito: los contadores se completan con JS (igual que los "cart fragments" de Woo)
  h = h.replace(/<span class="font-h4 item-count">\(\d+\)<\/span>/g, '<span class="font-h4 item-count">(0)</span>');
  return { h, removedElectronica: r.count, hashLeft: left };
}

function fixFooter(f) {
  const r = removeLi(f, ">Tecnología<");
  return { f: r.html, removed: r.count };
}

function base(name, src) {
  const p = page(src);
  return {
    name,
    source: p.source,
    capturedAt: p.capturedAt,
    title: p.title.replace(/&#8211;/g, "–").replace(/&amp;/g, "&"),
    bodyClass: p.bodyClass.replace(/\bwoocommerce-no-js\b/, "woocommerce-js").replace(/\bpage-id-\d+\b/, (m) => m),
    styles: p.styles.map(({ href, media }) => ({ href, media })),
    scripts: p.scripts,
    inlineScripts: p.inlineScripts.map(({ code, after }) => ({ code, after })),
    before: p.fragments.before
      .replace("Franzebi Imports - Perfumería, Fragancias y Electrónica Importada", "Franzebi Imports - Perfumería y Fragancias Importadas"),
    main: p.fragments.main,
    after: p.fragments.after,
  };
}

const shellSrc = page("cart_empty");
const header = fixHeader(shellSrc.fragments.header);
const footer = fixFooter(shellSrc.fragments.footer);
const shell = { header: header.h, footer: footer.f, searchPopup: shellSrc.fragments.searchPopup ?? "" };
console.log(`header: electrónica quitada x${header.removedElectronica}, href="#" restantes=${header.hashLeft}; footer: tecnología x${footer.removed}`);

const T = {};

// HOME: 7 grillas de productos
{
  const t = base("home", "home");
  let n = 0;
  t.main = t.main.replace(/(<ul class="products elementor-grid vamtam-wc columns-\d+">)[\s\S]*?(<\/ul>)/g, (all, a, z) => `${a}<!--fz:grid:${n++}-->${z}`);
  t.grids = n;
  T.home = t;
}

// ARCHIVO (categoría, shop, búsqueda): mismo template Elementor 706
function archive(name, src) {
  const t = base(name, src);
  const cat = page("category").fragments.main; // misma estructura para las tres
  let m = cat;
  m = replaceOuter(m, 'class="woocommerce-breadcrumb"', "<!--fz:breadcrumb-->");
  m = replaceInner(m, 'class="elementor-heading-title elementor-size-default"', "<!--fz:title-->", m.indexOf("theme-archive-title"));
  m = replaceInner(m, 'class="elementor-widget-container"', "<!--fz:filters-->", m.indexOf("elementor-widget-wp-widget-berocket_aapf_group"));
  m = replaceOuter(m, 'class="woocommerce-result-count"', "<!--fz:count-->");
  m = replaceInner(m, 'class="woocommerce-ordering__submenu"', "<!--fz:ordering-->");
  m = m.replace(/(<ul class="products elementor-grid vamtam-wc columns-\d+">)[\s\S]*?(<\/ul>)/, "<!--fz:products-->");
  m = replaceOuter(m, 'class="woocommerce-pagination"', "<!--fz:pagination-->");
  t.main = m;
  T[name] = t;
}
archive("category", "category");
archive("shop", "shop");
archive("search", "search");

// PRODUCTO
function product(name, src) {
  const t = base(name, src);
  let m = t.main;
  m = m.replace(/(data-elementor-type="product" data-elementor-id="\d+" class=")[^"]*(")/, "$1elementor elementor-614 elementor-location-single <!--fz:product-classes-->$2");
  m = replaceOuter(m, 'class="woocommerce-breadcrumb"', "<!--fz:breadcrumb-->");
  m = replaceOuter(m, 'class="woocommerce-product-gallery ', "<!--fz:gallery-->");
  m = replaceInner(m, 'class="product_title entry-title', "<!--fz:title-->");
  m = replaceInner(m, 'class="elementor-heading-title elementor-size-default"', "<!--fz:sku-->", m.indexOf("elementor-element-58ac850"));
  m = replaceOuter(m, 'class="price"', "<!--fz:price-->", m.indexOf("elementor-widget-woocommerce-product-price"));
  m = replaceInner(m, 'class="elementor-widget-container"', "<!--fz:description-->", m.indexOf("elementor-widget-woocommerce-product-content"));
  m = replaceInner(m, 'class="elementor-widget-container"', "<!--fz:add-to-cart-->", m.indexOf("elementor-widget-woocommerce-product-add-to-cart"));
  m = m.replace(/(<ul class="products elementor-grid vamtam-wc columns-\d+">)[\s\S]*?(<\/ul>)/, "$1<!--fz:related-->$2");
  t.main = m;
  T[name] = t;
}
product("product", "product_instock");

// FAQ: ítems del toggle desde settings.faq (D-13)
{
  const t = base("faq", "faq");
  t.main = replaceInner(t.main, 'class="elementor-toggle"', "<!--fz:faq-->");
  T.faq = t;
}

// CONTACTO: el form de Elementor se envía a /api/contacto (fz.js)
{
  const t = base("contacto", "contacto");
  t.main = t.main.replace(/<form class="elementor-form" method="post"/, '<form class="elementor-form" method="post" action="/api/contacto/" data-fz-contact');
  T.contacto = t;
}

// MI CUENTA: login/registro (logueado se reemplaza el contenido de .woocommerce)
{
  const t = base("account", "account");
  const i = t.main.indexOf('class="woocommerce"');
  t.main = replaceInner(t.main, 'class="woocommerce"', "<!--fz:account-->", i - 5);
  t.loginForm = page("account").fragments.main.slice(...(() => { const s = startOf(page("account").fragments.main, 'class="woocommerce"'); const [a, b, o] = bounds(page("account").fragments.main, s); return [o, page("account").fragments.main.lastIndexOf("</", b - 1)]; })());
  T.account = t;
}

// CARRITO: contenido de .woocommerce
{
  const t = base("cart", "cart");
  t.main = replaceInner(t.main, 'class="woocommerce"', "<!--fz:cart-->");
  const em = page("cart_empty").fragments.main;
  const s = startOf(em, 'class="woocommerce"');
  const [, end, openEnd] = bounds(em, s);
  t.empty = em.slice(openEnd, em.lastIndexOf("</", end - 1));
  T.cart = t;
}

// CHECKOUT: contenido de .woocommerce -> React (portal)
{
  const t = base("checkout", "checkout");
  t.main = replaceInner(t.main, 'class="woocommerce"', '<div id="fz-checkout-root"><!--fz:checkout--></div>');
  T.checkout = t;
}

// 404
T.not_found = base("not_found", "not_found");

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "shell.json"), JSON.stringify(shell));
for (const [k, v] of Object.entries(T)) fs.writeFileSync(path.join(OUT, `${k}.json`), JSON.stringify(v));
for (const [k, v] of Object.entries(T)) {
  const markers = [...v.main.matchAll(/<!--fz:([a-z0-9:-]+)-->/g)].map((m) => m[1]);
  console.log(`✓ ${k.padEnd(10)} ${(JSON.stringify(v).length / 1024).toFixed(0)}KB  marcadores: ${markers.join(", ")}`);
}
