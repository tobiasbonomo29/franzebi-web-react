import "server-only";
import type { CartTotals } from "@franzebi/domain";
import { adminClient } from "../supabase";
import { esc, miniCart, productUrl, wcPrice, type MiniCartLine } from "./render";

/** slug + miniatura por SKU (para mostrar las líneas del carrito como Woo). */
export async function lineMeta(skus: string[]) {
  const out = new Map<string, { slug: string; thumb: string | null; srcset: string | null; stock: number }>();
  if (!skus.length) return out;
  const { data } = await adminClient()
    .from("products")
    .select("sku, slug, stock_qty, product_images(thumb_url, source_url, srcset, position, status)")
    .in("sku", skus);
  for (const p of (data ?? []) as Array<{ sku: string; slug: string; stock_qty: number; product_images: Array<{ thumb_url: string | null; source_url: string | null; srcset: string | null; position: number; status: string }> }>) {
    const img = p.product_images.filter((i) => i.status === "ok").sort((a, b) => a.position - b.position)[0];
    out.set(p.sku, { slug: p.slug, thumb: img?.thumb_url ?? img?.source_url ?? null, srcset: img?.srcset ?? null, stock: p.stock_qty });
  }
  return out;
}

export async function cartFragments(t: CartTotals) {
  const meta = await lineMeta(t.lines.map((l) => l.sku));
  const lines: MiniCartLine[] = t.lines.map((l) => ({ sku: l.sku, name: l.name, slug: meta.get(l.sku)?.slug ?? null, quantity: l.quantity, unitPriceCents: l.unitPriceCents, thumb: meta.get(l.sku)?.thumb ?? null }));
  const count = t.lines.reduce((s, l) => s + l.quantity, 0);
  return { count, subtotal: wcPrice(t.subtotalCents), miniCart: miniCart(lines, t.subtotalCents) };
}

const removeIcon = `<i class="vamtam-remove-product"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 17 19" width="17px"><g fill="#BFBDBB" fill-rule="nonzero"><path d="M16.227 3.03h-5l-.433-1.87c-.086-.37-.394-.63-.749-.63h-3.09c-.355 0-.664.26-.75.632L5.771 3.03H.773c-.427 0-.773.373-.773.833v.834c0 .46.346.833.773.833h15.454c.427 0 .773-.373.773-.833v-.834c0-.46-.346-.833-.773-.833ZM15 6.53H3v9.75a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 15 16.28V6.53Z"/></g></svg></i>`;

/** Aviso mayorista por puntos (regla del negocio: 10 primera compra / 3 re-stock). */
export function wholesaleNotice(t: CartTotals) {
  const w = t.wholesale;
  if (!t.lines.length) return "";
  const pts = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 1 });
  const label = w.mode === "restock" ? "re-stock mayorista" : "precio mayorista (primera compra)";
  const msg = w.qualifies
    ? `¡Precio mayorista aplicado! Sumás ${pts(w.points)} puntos (mínimo ${pts(w.threshold)}). Ahorrás ${wcPrice(w.savingsCents)}.`
    : `Llevás ${pts(w.points)} de ${pts(w.threshold)} puntos para ${label}. Te faltan ${pts(w.missingPoints)}.`;
  return `<div class="woocommerce-info fz-wholesale" role="status">${msg}</div>`;
}

/** Contenido de .woocommerce en /carrito/ (cart.php + cart-totals.php). */
export async function cartPageHtml(t: CartTotals, emptyHtml: string) {
  if (!t.lines.length) return emptyHtml;
  const meta = await lineMeta(t.lines.map((l) => l.sku));
  const issues = t.issues.map((i) => `<li>${esc(i.message)}</li>`).join("");
  const rows = t.lines
    .map((l) => {
      const m = meta.get(l.sku);
      const url = m ? productUrl(m.slug) : "#";
      const qid = `quantity_${l.sku.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
      const img = m?.thumb
        ? `<img decoding="async" width="420" height="525" src="${esc(m.thumb)}" class="attachment-woocommerce_thumbnail size-woocommerce_thumbnail" alt="${esc(l.name)}"${m.srcset ? ` srcset="${esc(m.srcset)}" sizes="(max-width: 420px) 100vw, 420px"` : ""} />`
        : `<img decoding="async" width="420" height="525" src="/wp-content/uploads/woocommerce-placeholder-420x525.webp" class="woocommerce-placeholder wp-post-image" alt="${esc(l.name)}" />`;
      return `<tr class="woocommerce-cart-form__cart-item cart_item">
\t<td class="product-thumbnail"><a href="${url}">${img}</a></td>
\t<td scope="row" class="product-name" data-title="Producto"><a href="${url}">${esc(l.name)}</a>${l.wholesaleApplied ? `<p class="fz-wholesale-line"><small>Precio mayorista</small></p>` : ""}</td>
\t<td class="product-price" data-title="Price">${wcPrice(l.unitPriceCents)}</td>
\t<td class="product-quantity" data-title="Cantidad"><div class="quantity vamtam-quantity">
\t\t<label class="screen-reader-text" for="${qid}">${esc(l.name)} cantidad</label>
\t\t<input type="number" id="${qid}" class="input-text qty text" name="qty[${esc(l.sku)}]" data-sku="${esc(l.sku)}" value="${l.quantity}" aria-label="Cantidad de productos" min="0" max="${m?.stock ?? 999}" step="1" inputmode="numeric" autocomplete="off" />
\t</div></td>
\t<td class="product-subtotal" data-title="Subtotal">${wcPrice(l.lineTotalCents)}</td>
\t<td class="product-remove"><a role="button" href="/carrito/" class="remove" aria-label="Remove ${esc(l.name)} from cart" data-product_sku="${esc(l.sku)}">${removeIcon}</a></td>
</tr>`;
    })
    .join("\n");
  return `<div class="woocommerce-notices-wrapper">${issues ? `<ul class="woocommerce-error" role="alert">${issues}</ul>` : ""}${wholesaleNotice(t)}</div><h3>Carrito</h3>
<form class="woocommerce-cart-form" action="/carrito/" method="post" data-fz-cart-form>
\t<table class="shop_table shop_table_responsive cart woocommerce-cart-form__contents" cellspacing="0">
\t\t<thead><tr>
\t\t\t<th scope="col" class="product-thumbnail"><span class="screen-reader-text">Thumbnail image</span></th>
\t\t\t<th scope="col" class="product-name">Producto</th>
\t\t\t<th scope="col" class="product-quantity">Cantidad</th>
\t\t\t<th scope="col" class="product-subtotal">Subtotal</th>
\t\t\t<th scope="col" class="product-remove"><span class="screen-reader-text">Quitar producto</span></th>
\t\t</tr></thead>
\t\t<tbody>
${rows}
\t\t<tr><td colspan="6" class="actions"><button type="submit" class="button" name="update_cart" value="Actualizar carrito">Actualizar carrito</button></td></tr>
\t\t</tbody>
\t</table>
</form>
<div class="cart-collaterals">
\t<div class="cart_totals ">
\t\t<h2>Totales del carrito</h2>
\t\t<table cellspacing="0" class="shop_table shop_table_responsive">
\t\t\t<tr class="cart-subtotal"><th>Subtotal</th><td data-title="Subtotal">${wcPrice(t.subtotalCents)}</td></tr>
\t\t\t<tr class="woocommerce-shipping-totals shipping"><th>Envío</th><td data-title="Envío"><p class="woocommerce-shipping-destination">Las opciones de envío se calculan en el checkout con tu código postal.</p></td></tr>
\t\t\t<tr class="order-total"><th>Total</th><td data-title="Total"><strong>${wcPrice(t.subtotalCents)}</strong> </td></tr>
\t\t</table>
\t\t<div class="wc-proceed-to-checkout"><a href="/checkout/" class="checkout-button button alt wc-forward">Finalizar compra</a></div>
\t</div>
</div>`;
}
