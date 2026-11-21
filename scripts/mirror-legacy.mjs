/**
 * Espejo del diseño de franzebi.ar (WordPress + Elementor + VamTam) para la app Next.
 *
 *   node scripts/mirror-legacy.mjs            -> descarga y regenera todo
 *
 * Sólo hace GET públicos (más una sesión de carrito anónima para capturar el markup de carrito/checkout).
 * No escribe nada en WordPress.
 *
 * Salidas:
 *   apps/web/public/wp-content/**, wp-includes/**   CSS, JS, fuentes e imágenes de diseño (mismas rutas que WP)
 *   apps/web/public/legacy/inline/<hash>.css        bloques <style> inline de cada página
 *   apps/web/src/legacy/pages/<tipo>.json           { bodyClass, styles[], scripts[], inlineScripts[], fragments{} }
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ORIGIN = "https://franzebi.ar";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const PUB = path.join(ROOT, "apps/web/public");
const OUT = path.join(ROOT, "apps/web/src/legacy/pages");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

const PAGES = {
  home: "/",
  shop: "/shop/",
  category: "/product-category/perfumeria/fragancias-masculinas/arabes-masculinas/",
  product: "/product/maison-alhambra-baroque-rouge-540-100ml/",
  product_on_request: "/product/ysl-mon-paris-edp-90ml/",
  product_instock: "/product/decant-maison-alhambra-terra-10ml/",
  search: "/?s=lattafa&post_type=product",
  faq: "/faq/",
  contacto: "/contacto/",
  account: "/mi-cuenta/",
  cart_empty: "/carrito/",
  cart: "/carrito/",
  checkout: "/checkout/",
  not_found: "/esta-pagina-no-existe-xyz/",
};

// Scripts que replican el comportamiento del diseño (menú, sticky, carruseles, pestañas, contador, popups).
// Se excluyen los de WooCommerce/píxeles/plugins cuya función reemplaza la app.
const KEEP_JS = [
  /wp-includes\/js\/jquery\/jquery(\.min|-migrate\.min)\.js/,
  /wp-includes\/js\/jquery\/ui\/core\.min\.js/,
  /wp-includes\/js\/dist\/(hooks|i18n)\.min\.js/,
  /themes\/vamtam-debebe\/vamtam\/assets\/js\/all\.min\.js/,
  /plugins\/elementor\/assets\/js\/(webpack\.runtime|frontend-modules|frontend)\.min\.js/,
  /plugins\/elementor\/assets\/lib\/swiper\//,
  /plugins\/elementor-pro\/assets\/lib\/(smartmenus|sticky)\//,
  /plugins\/elementor-pro\/assets\/js\/(webpack-pro\.runtime|frontend|elements-handlers)\.min\.js/,
  /plugins\/vamtam-elementor-integration-debebe\//,
  /plugins\/wp-whatsapp\/assets\/(dist\/js\/njt-whatsapp|js\/whatsapp-popup)\.js/, // botón flotante "¿Necesitas ayuda?"
];
const KEEP_INLINE_JS = /elementorFrontendConfig|ElementorProFrontendConfig|VAMTAM_FRONT|vamtam_|wp\.i18n\.setLocaleData|var\s+elementor|ElementorProFrontend/;
// Configuraciones imprescindibles para que arranquen Elementor/VamTam (se conservan aunque mencionen plugins descartados).
// El AJAX add-to-cart propio del theme llama a admin-ajax de WP: se desactiva y lo reemplaza fz.js.
const MUST_INLINE_JS = /var\s+(elementorFrontendConfig|VAMTAM_FRONT|ElementorProFrontendConfig|njt_wa_global|njt_wa)\s*=|VAMTAM_FRONT\.theme_supports|wp\.i18n\.setLocaleData/;
const DROP_INLINE_JS = /fbq|gtag|sbjs|wc_order_attribution|wc_add_to_cart|woocommerce_params|dgwt|woosw|awdr|njt|revslider|SR7/;

const seen = new Set();
const stats = { files: 0, bytes: 0, failed: [] };
let cookie = "";

async function get(url, { binary = false, keepCookie = false, allowError = false } = {}) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA, ...(keepCookie && cookie ? { cookie } : {}) }, redirect: "follow" });
      if (keepCookie) {
        const sc = r.headers.getSetCookie?.() ?? [];
        if (sc.length) cookie = [...new Set([...cookie.split("; ").filter(Boolean), ...sc.map((c) => c.split(";")[0])])].join("; ");
      }
      if (!r.ok && !(allowError && !binary)) return { status: r.status, body: null };
      return { status: r.status, body: binary ? Buffer.from(await r.arrayBuffer()) : await r.text() };
    } catch (e) {
      if (i === 3) return { status: 0, body: null, error: String(e) };
      await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
    }
  }
}

/** URL absoluta de franzebi.ar -> ruta local servida por Next (misma ruta). */
function localPath(u) {
  try {
    const x = new URL(u, ORIGIN);
    if (x.hostname !== "franzebi.ar") return null;
    if (!/^\/(wp-content|wp-includes)\//.test(x.pathname)) return null;
    return decodeURIComponent(x.pathname);
  } catch {
    return null;
  }
}

async function mirrorFile(u, depth = 0) {
  const lp = localPath(u);
  if (!lp || seen.has(lp)) return lp;
  seen.add(lp);
  const dest = path.join(PUB, lp);
  if (fs.existsSync(dest) && !/\.css$/.test(lp)) return lp;
  const isCss = /\.css$/.test(lp);
  const res = await get(new URL(u, ORIGIN).href.replace(/\?.*$/, "") + (isCss ? "" : ""), { binary: !isCss });
  if (!res?.body) {
    stats.failed.push(`${res?.status} ${lp}`);
    return lp;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (isCss) {
    const css = await rewriteCss(res.body, new URL(u, ORIGIN).href, depth);
    fs.writeFileSync(dest, css);
    stats.bytes += css.length;
  } else {
    fs.writeFileSync(dest, res.body);
    stats.bytes += res.body.length;
  }
  stats.files++;
  return lp;
}

async function rewriteCss(css, baseUrl, depth) {
  const urls = new Set();
  for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
    if (m[2].startsWith("data:")) continue;
    urls.add(m[2]);
  }
  for (const m of css.matchAll(/@import\s+(?:url\()?['"]([^'"]+)['"]/g)) urls.add(m[1]);
  const map = new Map();
  for (const raw of urls) {
    const abs = new URL(raw, baseUrl).href;
    const lp = localPath(abs);
    if (lp && depth < 3) {
      await mirrorFile(abs, depth + 1);
      map.set(raw, lp + (new URL(abs).hash || ""));
    } else if (/^https?:\/\/franzebi\.ar\//.test(abs)) {
      map.set(raw, abs.replace(ORIGIN, ""));
    }
  }
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (all, q, raw) => (map.has(raw) ? `url("${map.get(raw)}")` : all));
}

const decode = (s) => s.replace(/&#038;|&amp;/g, "&");

function hrefOf(tag, attr) {
  const m = tag.match(new RegExp(`${attr}=(["'])([^"']+)\\1`));
  return m ? decode(m[2]) : null;
}

/** Saca scripts, handlers inline y referencias a franzebi.ar; deja rutas relativas. */
function cleanHtml(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "")
    .replace(/\son[a-z]+=("[^"]*"|'[^']*')/gi, "")
    .replace(/https?:\/\/(www\.)?franzebi\.ar(?=\/|["'])/g, "")
    .replace(/(["'(])\/\/franzebi\.ar\//g, "$1/")
    .replace(/<input[^>]+name=["'](woocommerce-[a-z-]+-nonce|_wpnonce|_wp_http_referer|security)["'][^>]*>/gi, "");
}

/** Elemento balanceado que empieza en `start` (índice del '<'). */
function outerElement(html, start) {
  const tag = html.slice(start + 1).match(/^([a-zA-Z0-9-]+)/)[1];
  const re = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, "g");
  re.lastIndex = start;
  let d = 0;
  let m;
  while ((m = re.exec(html))) {
    if (m[2] === "/") continue;
    d += m[1] ? -1 : 1;
    if (d === 0) return html.slice(start, re.lastIndex);
  }
  return html.slice(start);
}

function findElement(html, needle) {
  const i = html.indexOf(needle);
  if (i < 0) return null;
  const s = html.lastIndexOf("<", i);
  return outerElement(html, s);
}

async function mirrorUploads(html) {
  const refs = new Set();
  for (const m of html.matchAll(/(?:src|href|data-src|srcset|data-srcset|content)=["']([^"']+)["']/g)) {
    for (const part of m[1].split(",")) {
      const u = part.trim().split(/\s+/)[0];
      if (/\/wp-content\/uploads\//.test(u) && /\.(png|jpe?g|webp|gif|svg|avif|mp4|webm)$/i.test(u)) refs.add(u);
    }
  }
  for (const m of html.matchAll(/url\(\s*['"]?([^'")]+\/wp-content\/uploads\/[^'")]+)['"]?\s*\)/g)) refs.add(m[1]);
  for (const u of refs) await mirrorFile(new URL(u, ORIGIN).href);
}

async function processPage(type, urlPath) {
  const keep = type === "cart" || type === "checkout";
  const res = await get(ORIGIN + urlPath, { keepCookie: keep, allowError: type === "not_found" });
  if (!res?.body) {
    console.warn(`! ${type}: HTTP ${res?.status}`);
    return;
  }
  const html = res.body;
  const head = html.slice(0, html.indexOf("<body"));
  const bodyTag = html.match(/<body[^>]*>/)[0];
  const body = html.slice(html.indexOf("<body"));

  // Estilos en orden (links + inline)
  const styles = [];
  for (const m of html.matchAll(/<link[^>]+rel=['"]stylesheet['"][^>]*>|<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
    if (m[0].startsWith("<link")) {
      const href = hrefOf(m[0], "href");
      if (!href) continue;
      if (/fonts\.googleapis\.com/.test(href)) {
        styles.push({ href: href.replace(/^\/\//, "https://"), media: hrefOf(m[0], "media") ?? "all" });
        continue;
      }
      const lp = await mirrorFile(new URL(href, ORIGIN).href);
      if (lp) styles.push({ href: lp, media: hrefOf(m[0], "media") ?? "all", id: hrefOf(m[0], "id") });
    } else {
      const css = m[1].trim();
      if (!css) continue;
      const rewritten = await rewriteCss(cleanHtml(css), ORIGIN + urlPath, 0);
      const h = crypto.createHash("sha1").update(rewritten).digest("hex").slice(0, 12);
      const dest = path.join(PUB, "legacy/inline", `${h}.css`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, rewritten);
      styles.push({ href: `/legacy/inline/${h}.css`, media: (m[0].match(/media=['"]([^'"]+)/) || [])[1] ?? "all", inline: true });
    }
  }

  // Scripts de diseño
  const scripts = [];
  const inlineScripts = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const src = hrefOf(m[1], "src");
    if (src) {
      const abs = new URL(src, ORIGIN).href;
      if (KEEP_JS.some((r) => r.test(abs))) {
        const lp = await mirrorFile(abs);
        if (lp && !scripts.includes(lp)) scripts.push(lp);
      }
    } else if (MUST_INLINE_JS.test(m[2]) || (KEEP_INLINE_JS.test(m[2]) && !DROP_INLINE_JS.test(m[2]) && !/application\/ld\+json|speculationrules/.test(m[1]))) {
      inlineScripts.push({ position: head.includes(m[0]) ? "head" : "body", after: scripts.at(-1) ?? null, code: m[2].replace(/https?:\\?\/\\?\/franzebi\.ar/g, "").replace(/"enable_ajax_add_to_cart":"yes"/, '"enable_ajax_add_to_cart":"no"') });
    }
  }

  // Fragmentos
  const fragments = {};
  const header = findElement(body, 'data-elementor-type="header"');
  const footer = findElement(body, 'data-elementor-type="footer"');
  if (header) fragments.header = cleanHtml(header);
  if (footer) fragments.footer = cleanHtml(footer);
  const search = findElement(body, 'data-elementor-id="10600"');
  if (search) fragments.searchPopup = cleanHtml(search);
  // Contenido principal: entre el header y el footer
  if (header && footer) {
    const a = body.indexOf(header) + header.length;
    const z = body.indexOf(footer);
    fragments.main = cleanHtml(body.slice(a, z)).trim();
  }
  // Wrapper del sitio (lo que abre antes del header)
  if (header) fragments.before = cleanHtml(body.slice(bodyTag.length, body.indexOf(header))).trim();
  // WhatsApp flotante y "volver arriba", después del footer y antes de los popups
  if (footer) {
    const after = body.slice(body.indexOf(footer) + footer.length);
    const firstPopup = after.search(/<div[^>]+data-elementor-type="popup"/);
    fragments.after = cleanHtml(firstPopup > 0 ? after.slice(0, firstPopup) : after).replace(/<\/body>[\s\S]*$/, "").trim();
  }

  await mirrorUploads(Object.values(fragments).join("\n"));

  const bodyClass = (bodyTag.match(/class=["']([^"']*)["']/) || [])[1] ?? "";
  const title = (head.match(/<title>([^<]*)<\/title>/) || [])[1] ?? "";
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${type}.json`), JSON.stringify({ source: urlPath, capturedAt: new Date().toISOString(), title, bodyClass, styles, scripts, inlineScripts, fragments }, null, 1));
  console.log(`✓ ${type.padEnd(20)} styles=${styles.length} scripts=${scripts.length} inline=${inlineScripts.length} main=${fragments.main?.length ?? 0}`);
}

// Carrito con un producto (sesión anónima; no crea pedidos) para capturar el markup de carrito y checkout.
async function seedCart() {
  await get(`${ORIGIN}/?add-to-cart=991773`, { keepCookie: true }); // en stock = 0 => fallback a un decant con stock
  const store = await get(`${ORIGIN}/wp-json/wc/store/v1/products?per_page=20&stock_status=instock&search=decant`, {});
  const first = store?.body ? JSON.parse(store.body)[0] : null;
  if (first) await get(`${ORIGIN}/?add-to-cart=${first.id}`, { keepCookie: true });
}

/** Chunks que webpack de Elementor/Elementor Pro carga bajo demanda (toggle, countdown, nested-carousel, ...). */
async function mirrorWebpackChunks() {
  const dirs = new Set();
  for (const lp of seen) if (/\.js$/.test(lp)) dirs.add(lp);
  let n = 0;
  for (const lp of dirs) {
    const file = path.join(PUB, lp);
    if (!fs.existsSync(file)) continue;
    const js = fs.readFileSync(file, "utf8");
    const dir = lp.slice(0, lp.lastIndexOf("/") + 1);
    for (const m of js.matchAll(/"([\w.-]+\.bundle(?:\.min)?\.js)"/g)) {
      const before = stats.files;
      await mirrorFile(`${ORIGIN}${dir}${m[1]}`);
      n += stats.files - before;
    }
    // Elementor 4: loadChunk(`toggle`) -> assets/js/chunks/toggle.min.js
    for (const m of js.matchAll(/Chunk\(`([\w-]+)`\)/g)) {
      const before = stats.files;
      await mirrorFile(`${ORIGIN}${dir}chunks/${m[1]}.min.js`);
      n += stats.files - before;
    }
  }
  console.log(`chunks webpack: ${n} nuevos`);
}

const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
for (const [type, p] of Object.entries(PAGES)) {
  if (only.length && !only.includes(type)) continue;
  if (type === "cart") await seedCart();
  await processPage(type, p);
}
console.log(`archivos=${stats.files} bytes=${(stats.bytes / 1e6).toFixed(1)}MB fallidos=${stats.failed.length}`);
if (stats.failed.length) console.log(stats.failed.slice(0, 40).join("\n"));
await mirrorWebpackChunks();
// Archivos que los scripts cargan por nombre en runtime (no aparecen en el HTML)
for (const p of ["/wp-content/themes/vamtam-debebe/vamtam/assets/js/low-priority.js", "/wp-content/plugins/elementor/assets/lib/dialog/dialog.min.js", "/wp-content/plugins/elementor/assets/css/conditionals/dialog.min.css", "/wp-content/plugins/elementor/assets/lib/share-link/share-link.min.js"]) await mirrorFile(ORIGIN + p);
if (stats.failed.length) console.log(stats.failed.slice(-40).join("\n"));
