import "server-only";
import { whatsappInquiryUrl } from "@franzebi/domain";

/**
 * Generadores de HTML con el MISMO markup que producía WooCommerce + VamTam Debebe en franzebi.ar,
 * para que el CSS heredado (theme, Elementor, snippets) lo pinte idéntico.
 * Todo texto dinámico pasa por esc() — nunca se interpola HTML de usuarios.
 */

export const esc = (s: string | null | undefined) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

/** "$ 41.900,00" con el markup de wc_price(). */
export function wcPrice(cents: number) {
  const v = (cents / 100).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `<span class="woocommerce-Price-amount amount"><bdi><span class="woocommerce-Price-currencySymbol">&#36;</span>&nbsp;${v}</bdi></span>`;
}

export interface LoopProduct {
  id: string;
  legacy_woo_id: number | null;
  sku: string;
  slug: string;
  name: string;
  sale_mode: "purchasable" | "on_request" | "hidden";
  in_stock: boolean;
  stock_qty: number;
  retail_price_cents: number | null;
  hide_price: boolean;
  thumb?: { src: string; srcset: string | null; alt: string | null } | null;
  catSlugs?: string[];
}

export const productUrl = (slug: string) => `/product/${slug}/`;
const postId = (p: LoopProduct) => p.legacy_woo_id ?? parseInt(p.id.replace(/-/g, "").slice(0, 7), 16);

const PLACEHOLDER = "/wp-content/uploads/woocommerce-placeholder-420x525.webp";

function loopImage(p: LoopProduct, lazy: boolean) {
  const src = p.thumb?.src ?? PLACEHOLDER;
  const srcset = p.thumb?.srcset ? ` srcset="${esc(p.thumb.srcset)}" sizes="(max-width: 420px) 100vw, 420px"` : "";
  const cls = p.thumb ? "attachment-woocommerce_thumbnail size-woocommerce_thumbnail" : "woocommerce-placeholder wp-post-image";
  return `<img${lazy ? ' loading="lazy"' : ""} decoding="async" width="420" height="525" src="${esc(src)}" class="${cls}" alt="${esc(p.thumb?.alt || p.name)}"${srcset} />`;
}

export function onRequestWhatsApp(p: { name: string; sku: string; slug: string }, siteUrl: string) {
  return whatsappInquiryUrl({ name: p.name, sku: p.sku, url: new URL(productUrl(p.slug), siteUrl).toString() });
}

/** <li> de la grilla (content-product.php del theme + snippet de cantidad). */
export function productLi(p: LoopProduct, index: number, columns: number, siteUrl: string, opts: { lazy?: boolean } = {}) {
  const id = postId(p);
  const url = productUrl(p.slug);
  const pos = index % columns === 0 ? " first" : index % columns === columns - 1 ? " last" : "";
  const purchasable = p.sale_mode === "purchasable" && p.retail_price_cents != null;
  const stock = p.in_stock ? "instock" : "outofstock";
  const cats = (p.catSlugs ?? []).map((c) => ` product_cat-${esc(c)}`).join("");
  const thumb = p.thumb ? " has-post-thumbnail" : "";
  const name = esc(p.name);
  const link = (inner: string) => `<a href="${url}" class="woocommerce-LoopProduct-link woocommerce-loop-product__link">${inner}</a>`;

  let price = "";
  let action = "";
  let qty = "";
  if (p.sale_mode === "on_request") {
    action = `<a class="button franzebi-whatsapp-consulta" href="${esc(onRequestWhatsApp(p, siteUrl))}" target="_blank" rel="noopener nofollow" aria-label="Consultar por WhatsApp por ${name}">Consultar por WhatsApp</a>`;
  } else {
    if (p.retail_price_cents != null && !p.hide_price) price = `\n\t<span class="price">${wcPrice(p.retail_price_cents)}</span>\n`;
    if (purchasable && p.in_stock) {
      action = `<div class="vamtam-add-to-cart-wrap"><a href="/?add-to-cart=${id}" aria-describedby="woocommerce_loop_add_to_cart_link_describedby_${id}" data-quantity="1" class="button product_type_simple add_to_cart_button ajax_add_to_cart" data-product_id="${id}" data-product_sku="${esc(p.sku)}" aria-label="Añadir al carrito: &ldquo;${name}&rdquo;" rel="nofollow" data-success_message="«${name}» se ha añadido a tu carrito" role="button">Añadir al carrito</a></div>`;
      qty = `
        <div class="custom-quantity-wrapper" data-product-id="${id}">
            <div class="quantity-selector">
                <button type="button" class="qty-btn minus">&#8211;</button>
                <input type="number" class="qty-input" value="1" min="1" max="${Math.max(1, p.stock_qty)}" data-product-id="${id}" />
                <button type="button" class="qty-btn plus">+</button>
            </div>
        </div>`;
    } else {
      action = `<div class="vamtam-add-to-cart-wrap"><a href="${url}" aria-describedby="woocommerce_loop_add_to_cart_link_describedby_${id}" data-quantity="1" class="button product_type_simple" data-product_id="${id}" data-product_sku="${esc(p.sku)}" aria-label="Lee más sobre &ldquo;${name}&rdquo;" rel="nofollow" data-success_message="">Leer más</a></div>`;
    }
  }

  return `<li class="product type-product post-${id} status-publish${pos} ${stock}${cats}${thumb} shipping-taxable${purchasable ? " purchasable" : ""} product-type-simple">
\t${link(`\t\t\t\t\t\t${loopImage(p, opts.lazy ?? index > 3)}\t\t\t\t\t`)}\t\t\t\t\t<div class="vamtam-product-content">
\t\t\t\t\t${link(`<h2 class="woocommerce-loop-product__title">${name}</h2>\t\t\t\t\t\t\t\t\t`)}${price}\t\t\t\t\t</div>
\t\t\t\t\t${action}\t<span id="woocommerce_loop_add_to_cart_link_describedby_${id}" class="screen-reader-text">
\t\t\t</span>
\t\t\t\t${qty}
        </li>`;
}

export function productGrid(list: LoopProduct[], columns: number, siteUrl: string) {
  return list.map((p, i) => productLi(p, i, columns, siteUrl)).join("\n");
}

export function breadcrumb(items: Array<{ name: string; href?: string }>) {
  const parts = [`<a href="/">Inicio</a>`, ...items.map((x) => (x.href ? `<a href="${esc(x.href)}">${esc(x.name)}</a>` : esc(x.name)))];
  return `<nav class="woocommerce-breadcrumb" aria-label="Breadcrumb">${parts.join("&nbsp;&#47;&nbsp;")}</nav>`;
}

/** paginate_links() de WP (end_size=3, mid_size=3 como en el sitio). */
export function pagination(page: number, total: number, href: (n: number) => string) {
  if (total <= 1) return "";
  const end = 3;
  const mid = 3;
  const out: string[] = [];
  let dots = false;
  if (page > 1) out.push(`<li><a class="prev page-numbers" href="${href(page - 1)}">&larr;</a></li>`);
  for (let n = 1; n <= total; n++) {
    if (n === page) {
      out.push(`<li><span aria-label="Página ${n}" aria-current="page" class="page-numbers current">${n}</span></li>`);
      dots = true;
    } else if (n <= end || (n >= page - mid && n <= page + mid) || n > total - end) {
      out.push(`<li><a aria-label="Página ${n}" class="page-numbers" href="${href(n)}">${n}</a></li>`);
      dots = true;
    } else if (dots) {
      out.push(`<li><span class="page-numbers dots">&hellip;</span></li>`);
      dots = false;
    }
  }
  if (page < total) out.push(`<li><a class="next page-numbers" href="${href(page + 1)}">&rarr;</a></li>`);
  return `<nav class="woocommerce-pagination" aria-label="Paginación de producto">\n\t<ul class='page-numbers'>\n\t${out.join("\n\t")}\n</ul>\n</nav>\n`;
}

export function resultCount(page: number, perPage: number, total: number) {
  if (total === 0) return "";
  const text =
    total === 1 ? "Mostrando el único resultado" : total <= perPage ? `Mostrando los ${total} resultados` : `Mostrando ${(page - 1) * perPage + 1}&ndash;${Math.min(total, page * perPage)} de ${total} resultados`;
  return `<p class="woocommerce-result-count" role="alert" aria-relevant="all" >\n\t${text}</p>\n`;
}

export const ORDERINGS: Array<[string, string]> = [
  ["menu_order", "Orden predeterminado"],
  ["popularity", "Más populares"],
  ["rating", "Mejor valorados"],
  ["date", "Más recientes"],
  ["price", "Precio: menor a mayor"],
  ["price-desc", "Precio: mayor a menor"],
];

export function orderingLinks(current: string, query: (orderby: string) => string) {
  return ORDERINGS.map(([k, label]) => `<li><a href="${esc(query(k))}" class="woocommerce-ordering__link ${k === current ? "active" : ""}">${label}</a></li>`).join("");
}

/** Reemplazo del filtro "Rango de precios" (BeRocket): mismo markup de cabecera, formulario GET simple. */
export function priceFilter(min: number, max: number, cur: { min?: number; max?: number }, keep: Record<string, string>) {
  const hidden = Object.entries(keep).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("");
  const active = cur.min != null || cur.max != null;
  return `<div class="berocket_single_filter_widget"><div class="bapf_sfilter"><div class="bapf_body">${active ? `<a class="bapf_button bapf_reset" href="?${new URLSearchParams(keep)}">Borrar filtro</a>` : `<button class="bapf_button bapf_reset" type="button">Borrar filtro</button>`}</div></div></div>
<div class="berocket_single_filter_widget"><div class="bapf_sfilter bapf_slidr ${active ? "" : "bapf_ocolaps"}" data-fz-price-filter><div class="bapf_head bapf_colaps_togl"><h3 tabindex="0" class="bapf_hascolarr">Rango de precios<i class="bapf_colaps_smb fa fa-chevron-${active ? "up" : "down"}"></i></h3></div>
<div class="bapf_body"${active ? "" : ' style="display:none;"'}><form method="get" class="fz-price-filter">${hidden}
<div class="bapf_slidr_all"><span class="bapf_from"><span class="bapf_tbprice">&#36;</span><input type="number" name="min_price" min="0" step="100" placeholder="${Math.floor(min)}" value="${cur.min ?? ""}" aria-label="Precio mínimo"></span>
<span class="bapf_to"><span class="bapf_tbprice">&#36;</span><input type="number" name="max_price" min="0" step="100" placeholder="${Math.ceil(max)}" value="${cur.max ?? ""}" aria-label="Precio máximo"></span></div>
<button type="submit" class="bapf_button">Filtrar</button></form></div></div></div>`;
}

export function noProducts() {
  return `<div class="woocommerce-no-products-found">\n\t<div class="woocommerce-info" role="status">\n\t\tNo se encontraron productos que concuerden con la selección.\t</div>\n</div>\n`;
}

export interface GalleryImage {
  src: string;
  srcset: string | null;
  alt: string | null;
  thumb: string | null;
}

/** Galería "full sized" de VamTam (todas las imágenes apiladas, sin slider). */
export function gallery(images: GalleryImage[], name: string) {
  if (!images.length) {
    return `<div class="woocommerce-product-gallery woocommerce-product-gallery--without-images woocommerce-product-gallery--columns-1 images" data-columns="1">
\t<div class="woocommerce-product-gallery__wrapper">
\t\t<div class="woocommerce-product-gallery__image--placeholder"><img src="/wp-content/uploads/woocommerce-placeholder-420x525.webp" alt="Esperando la imagen del producto" class="wp-post-image" /></div>\t</div>
</div>`;
  }
  const items = images
    .map((img, i) => {
      const s630 = img.src.replace(/(\.\w+)$/, "-630x630$1");
      const alt = esc(img.alt || name);
      const srcset = img.srcset ? ` srcset="${esc(img.srcset)}" sizes="(max-width: 630px) 100vw, 630px"` : "";
      return `<div data-thumb="${esc(img.thumb ?? img.src)}" data-thumb-alt="${alt}" class="woocommerce-product-gallery__image"><a href="${esc(img.src)}"><img width="630" height="630" src="${esc(img.srcset ? s630 : img.src)}" class="${i === 0 ? "wp-post-image" : ""}" alt="${alt}" data-src="${esc(img.src)}" data-large_image="${esc(img.src)}" decoding="async"${i ? ' loading="lazy"' : ""}${srcset} /></a></div>`;
    })
    .join("");
  return `<div class="woocommerce-product-gallery woocommerce-product-gallery--with-images woocommerce-product-gallery--columns-1 images" data-columns="1" style="opacity: 1;">
\t<div class="woocommerce-product-gallery__wrapper">
${items}\t</div>
</div>`;
}

export function singleAddToCart(p: LoopProduct, siteUrl: string) {
  const id = postId(p);
  if (p.sale_mode === "on_request") {
    return `<div class="franzebi-consulta-a-pedido"><p>Producto disponible a pedido.</p><a class="button alt franzebi-whatsapp-consulta" href="${esc(onRequestWhatsApp(p, siteUrl))}" target="_blank" rel="noopener nofollow" aria-label="Consultar por WhatsApp por ${esc(p.name)}">Consultar por WhatsApp</a></div>`;
  }
  if (!p.in_stock || p.retail_price_cents == null) {
    return `\n\t\t<div class="elementor-add-to-cart elementor-product-simple">\n\t\t\t<p class="stock out-of-stock">Sin existencias</p>\n\t\t</div>\n`;
  }
  return `
\t\t<div class="elementor-add-to-cart elementor-product-simple">
\t\t\t<p class="stock in-stock">${p.stock_qty} disponibles</p>
\t<form class="cart" action="${productUrl(p.slug)}" method="post" enctype='multipart/form-data' data-fz-add-form data-sku="${esc(p.sku)}">
\t\t<div class="quantity">
\t\t<label class="screen-reader-text" for="quantity_${id}">${esc(p.name)} cantidad</label>
\t<input type="number" id="quantity_${id}" class="input-text qty text" name="quantity" value="1" aria-label="Cantidad de productos" min="1" max="${p.stock_qty}" step="1" placeholder="" inputmode="numeric" autocomplete="off" />
\t</div>
\t\t<button type="submit" name="add-to-cart" value="${id}" class="single_add_to_cart_button button alt">Añadir al carrito</button>
\t</form>
\t\t</div>
`;
}

/** Ítems del toggle de Elementor (FAQ). */
export function faqToggle(items: Array<{ q: string; a: string }>) {
  return items
    .map((it, i) => {
      const n = 7751 + i;
      const body = it.a.split("\n").map((l) => `<p>${esc(l)}</p>`).join("");
      return `<div class="elementor-toggle-item">
\t<div id="elementor-tab-title-${n}" class="elementor-tab-title" data-tab="${i + 1}" role="button" aria-controls="elementor-tab-content-${n}" aria-expanded="false">
\t\t<span class="elementor-toggle-icon elementor-toggle-icon-right" aria-hidden="true">
\t\t\t<span class="elementor-toggle-icon-closed"><i class="fas fa-chevron-down"></i></span>
\t\t\t<span class="elementor-toggle-icon-opened"><i class="elementor-toggle-icon-opened fas fa-chevron-up"></i></span>
\t\t</span>
\t\t<a class="elementor-toggle-title" tabindex="0">${esc(it.q)}</a>
\t</div>
\t<div id="elementor-tab-content-${n}" class="elementor-tab-content elementor-clearfix" data-tab="${i + 1}" role="region" aria-labelledby="elementor-tab-title-${n}">${body}</div>
</div>`;
    })
    .join("\n");
}

export interface MiniCartLine {
  sku: string;
  name: string;
  slug: string | null;
  quantity: number;
  unitPriceCents: number;
  thumb: string | null;
}

/** Contenido de .widget_shopping_cart_content (mini-cart.php). */
export function miniCart(lines: MiniCartLine[], subtotalCents: number) {
  if (!lines.length) return `\n\t<p class="woocommerce-mini-cart__empty-message">No hay productos en el carrito.</p>\n\n\n`;
  const items = lines
    .map(
      (l) => `<li class="woocommerce-mini-cart-item mini_cart_item">
\t<a role="button" href="/carrito/" class="remove remove_from_cart_button" aria-label="Eliminar ${esc(l.name)} del carrito" data-product_sku="${esc(l.sku)}">&times;</a>
\t<a href="${l.slug ? productUrl(l.slug) : "#"}"><img width="420" height="525" src="${esc(l.thumb ?? PLACEHOLDER)}" class="attachment-woocommerce_thumbnail size-woocommerce_thumbnail" alt="${esc(l.name)}" decoding="async" loading="lazy" />${esc(l.name)}</a>
\t<span class="quantity">${l.quantity} &times; ${wcPrice(l.unitPriceCents)}</span>
</li>`,
    )
    .join("\n");
  return `
\t<ul class="woocommerce-mini-cart cart_list product_list_widget ">
${items}
\t</ul>
\t<p class="woocommerce-mini-cart__total total">
\t\t<strong>Subtotal:</strong> ${wcPrice(subtotalCents)}\t</p>
\t<p class="woocommerce-mini-cart__buttons buttons"><a href="/carrito/" class="button wc-forward">Ver carrito</a><a href="/checkout/" class="button checkout wc-forward">Finalizar compra</a></p>
`;
}
