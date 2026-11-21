import "server-only";
import { whatsappReceiptUrl } from "@franzebi/domain";
import { esc, wcPrice } from "./render";

export const ORDER_STATUS: Record<string, string> = {
  pending: "Pendiente de pago", on_hold: "En espera", processing: "Procesando", completed: "Completado",
  cancelled: "Cancelado", refunded: "Reembolsado", failed: "Fallido",
};
export const PAYMENT_LABEL: Record<string, string> = { bank_transfer: "Transferencia bancaria directa", cash: "Efectivo al retirar (5% OFF)" };

export interface OrderRow {
  id: string; number: number; status: string; payment_method: string; delivery_label: string | null; estimated_delivery: string | null;
  placed_at: string; email: string; subtotal_cents: number; shipping_cents: number; cash_discount_cents: number; total_cents: number;
  billing: Record<string, string> | null; shipping_address: Record<string, unknown> | null; customer_note: string | null;
  tracking_number?: string | null;
}
export interface OrderItemRow { name: string; sku: string; quantity: number; line_total_cents: number }

const date = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "long", year: "numeric" });

/** Markup de thankyou.php / order-details.php de Woo. */
export function orderDetailsHtml(o: OrderRow, items: OrderItemRow[], opts: { thankyou: boolean; bankDetails?: string | null }) {
  const b = o.billing ?? {};
  const s = (o.shipping_address ?? {}) as Record<string, string>;
  const agency = (o.shipping_address as { agency?: { code: string; name: string } } | null)?.agency;
  const rows = items
    .map((i) => `<tr class="woocommerce-table__line-item order_item">
\t<td class="woocommerce-table__product-name product-name">${esc(i.name)} <strong class="product-quantity">&times;&nbsp;${i.quantity}</strong></td>
\t<td class="woocommerce-table__product-total product-total">${wcPrice(Number(i.line_total_cents))}</td>
</tr>`)
    .join("\n");
  const bank =
    o.payment_method === "bank_transfer"
      ? `<section class="woocommerce-bacs-bank-details"><h2 class="wc-bacs-bank-details-heading">Nuestros detalles bancarios</h2>
${opts.bankDetails ? `<p>${esc(opts.bankDetails).replace(/\n/g, "<br>")}</p>` : ""}
<p>Usá el número de pedido <strong>#${o.number}</strong> como referencia. Tu pedido queda <strong>En espera</strong> hasta validar el pago.</p>
<p><a class="button alt" href="${esc(whatsappReceiptUrl(o.number))}" target="_blank" rel="noopener">Enviar comprobante por WhatsApp</a></p></section>`
      : "";
  const head = opts.thankyou
    ? `<p class="woocommerce-notice woocommerce-notice--success woocommerce-thankyou-order-received">Gracias. Tu pedido ha sido recibido.</p>
<ul class="woocommerce-order-overview woocommerce-thankyou-order-details order_details">
\t<li class="woocommerce-order-overview__order order">Número del pedido: <strong>${o.number}</strong></li>
\t<li class="woocommerce-order-overview__date date">Fecha: <strong>${date(o.placed_at)}</strong></li>
\t<li class="woocommerce-order-overview__email email">Correo electrónico: <strong>${esc(o.email)}</strong></li>
\t<li class="woocommerce-order-overview__total total">Total: <strong>${wcPrice(Number(o.total_cents))}</strong></li>
\t<li class="woocommerce-order-overview__payment-method method">Método de pago: <strong>${esc(PAYMENT_LABEL[o.payment_method] ?? o.payment_method)}</strong></li>
</ul>`
    : `<p>El pedido #<mark class="order-number">${o.number}</mark> se realizó el <mark class="order-date">${date(o.placed_at)}</mark> y está actualmente <mark class="order-status">${esc(ORDER_STATUS[o.status] ?? o.status)}</mark>.</p>`;
  const addr = (a: Record<string, string>) =>
    [[a.firstName ?? a.first_name, a.lastName ?? a.last_name].filter(Boolean).join(" "), [a.street, a.number].filter(Boolean).join(" "), a.apartment, [a.city, a.state, a.postcode].filter(Boolean).join(", ")]
      .filter(Boolean)
      .map((x) => esc(String(x)))
      .join("<br>");
  return `<div class="woocommerce-order">
${head}
${bank}
${o.estimated_delivery ? `<p class="fz-eta"><strong>Entrega estimada:</strong> ${esc(o.estimated_delivery)}</p>` : ""}
${o.tracking_number ? `<p class="fz-tracking"><strong>Seguimiento Correo Argentino:</strong> ${esc(o.tracking_number)} — <a href="https://www.correoargentino.com.ar/formularios/e-commerce" target="_blank" rel="noopener">Ver envío</a></p>` : ""}
<section class="woocommerce-order-details">
\t<h2 class="woocommerce-order-details__title">Detalles del pedido</h2>
\t<table class="woocommerce-table woocommerce-table--order-details shop_table order_details">
\t\t<thead><tr><th class="woocommerce-table__product-name product-name">Producto</th><th class="woocommerce-table__product-table product-total">Total</th></tr></thead>
\t\t<tbody>${rows}</tbody>
\t\t<tfoot>
\t\t\t<tr><th scope="row">Subtotal:</th><td>${wcPrice(Number(o.subtotal_cents))}</td></tr>
\t\t\t<tr><th scope="row">Envío:</th><td>${Number(o.shipping_cents) ? wcPrice(Number(o.shipping_cents)) : ""} <small class="shipped_via">${esc(o.delivery_label ?? "")}</small></td></tr>
${Number(o.cash_discount_cents) ? `\t\t\t<tr><th scope="row">Descuento efectivo:</th><td>-${wcPrice(Number(o.cash_discount_cents))}</td></tr>` : ""}
\t\t\t<tr><th scope="row">Método de pago:</th><td>${esc(PAYMENT_LABEL[o.payment_method] ?? o.payment_method)}</td></tr>
\t\t\t<tr><th scope="row">Total:</th><td>${wcPrice(Number(o.total_cents))}</td></tr>
${o.customer_note ? `\t\t\t<tr><th>Nota:</th><td>${esc(o.customer_note)}</td></tr>` : ""}
\t\t</tfoot>
\t</table>
</section>
<section class="woocommerce-customer-details">
\t<section class="woocommerce-columns woocommerce-columns--2 woocommerce-columns--addresses col2-set addresses">
\t\t<div class="woocommerce-column woocommerce-column--1 woocommerce-column--billing-address col-1">
\t\t\t<h2 class="woocommerce-column__title">Dirección de facturación</h2>
\t\t\t<address>${addr(b)}${b.phone ? `<p class="woocommerce-customer-details--phone">${esc(b.phone)}</p>` : ""}<p class="woocommerce-customer-details--email">${esc(o.email)}</p></address>
\t\t</div>
${agency ? `		<div class="woocommerce-column woocommerce-column--2 woocommerce-column--shipping-address col-2"><h2 class="woocommerce-column__title">Sucursal de Correo Argentino</h2><address>${esc(agency.name)} (${esc(agency.code)})</address></div>` : ""}
${s.street ? `\t\t<div class="woocommerce-column woocommerce-column--2 woocommerce-column--shipping-address col-2"><h2 class="woocommerce-column__title">Dirección de envío</h2><address>${addr(s)}</address></div>` : ""}
\t</section>
</section>
</div>`;
}
