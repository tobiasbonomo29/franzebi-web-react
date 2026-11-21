import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { LegacyPage } from "@/components/LegacyPage";
import { getSessionProfile } from "@/lib/auth";
import { env } from "@/lib/env";
import { esc, wcPrice } from "@/lib/legacy/render";
import { ORDER_STATUS, orderDetailsHtml, type OrderItemRow, type OrderRow } from "@/lib/legacy/order-view";
import { template } from "@/lib/legacy/templates";
import { userClient } from "@/lib/supabase";

export const metadata: Metadata = { title: { absolute: template("account").title }, robots: { index: false, follow: true } };

type Props = { params: Promise<{ section?: string[] }> };

const NAV: Array<[string, string, string]> = [
  ["dashboard", "/mi-cuenta/", "Escritorio"],
  ["orders", "/mi-cuenta/orders/", "Pedidos"],
  ["customer-logout", "/mi-cuenta/customer-logout/", "Salir"],
];

function accountShell(active: string, content: string) {
  const nav = NAV.map(
    ([k, href, label]) =>
      `<li class="woocommerce-MyAccount-navigation-link woocommerce-MyAccount-navigation-link--${k}${k === active ? " is-active" : ""}"><a href="${href}"${k === active ? ' aria-current="page"' : ""}>${label}</a></li>`,
  ).join("\n");
  return `<div class="woocommerce-notices-wrapper"></div><nav class="woocommerce-MyAccount-navigation" aria-label="Páginas de la cuenta"><ul>${nav}</ul></nav>
<div class="woocommerce-MyAccount-content"><div class="woocommerce-notices-wrapper"></div>${content}</div>`;
}

const LOST = `<div class="woocommerce-notices-wrapper"></div><form method="post" class="woocommerce-ResetPassword lost_reset_password">
<p>¿Perdiste tu contraseña? Por favor, introduce tu correo electrónico. Recibirás un enlace para crear una contraseña nueva por correo electrónico.</p>
<p class="woocommerce-form-row woocommerce-form-row--first form-row form-row-first"><label for="user_login">Correo electrónico&nbsp;<span class="required" aria-hidden="true">*</span><span class="screen-reader-text">Obligatorio</span></label><input class="woocommerce-Input woocommerce-Input--text input-text" type="email" name="user_login" id="user_login" autocomplete="email" required aria-required="true" /></p>
<div class="clear"></div>
<p class="woocommerce-form-row form-row"><button type="submit" class="woocommerce-Button button" value="Restablecer contraseña">Restablecer contraseña</button></p>
</form>`;

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "long", year: "numeric" });

/** /mi-cuenta/ con el widget "My Account" de Elementor (pestañas Sign In / Registrarse de VamTam). */
export default async function Account({ params }: Props) {
  const section = (await params).section ?? [];
  const [first, second] = section;
  const t = template("account");
  const profile = await getSessionProfile();

  if (first === "customer-logout") {
    const sb = await userClient();
    await sb.auth.signOut();
    redirect("/mi-cuenta/");
  }
  if (!profile) {
    if (first === "lost-password") return <LegacyPage name="account" values={{ account: LOST }} />;
    if (first) redirect("/mi-cuenta/");
    return <LegacyPage name="account" values={{ account: t.loginForm ?? "" }} />;
  }

  const sb = await userClient(); // RLS: sólo sus pedidos
  const name = esc(profile.fullName ?? profile.email);
  let content: string;
  let active = "dashboard";
  if (!first) {
    content = `<p>Hola <strong>${name}</strong> (¿no eres <strong>${name}</strong>? <a href="/mi-cuenta/customer-logout/">Cerrar sesión</a>)</p>
<p>Desde el escritorio de tu cuenta puedes ver tus <a href="/mi-cuenta/orders/">pedidos recientes</a> y <a href="/mi-cuenta/restablecer/">cambiar tu contraseña</a>.</p>
${profile.role === "wholesale" ? `<div class="woocommerce-info">Tu cuenta es <strong>mayorista</strong>: en el carrito vas a ver los precios mayoristas al sumar los puntos de re-stock.</div>` : ""}
${profile.role === "admin" || profile.role === "operator" ? `<p><a class="button" href="/admin/">Panel de administración</a></p>` : ""}`;
  } else if (first === "orders") {
    active = "orders";
    const { data: orders } = await sb.from("orders").select("number, status, total_cents, placed_at, order_items(quantity)").order("placed_at", { ascending: false }).limit(100);
    content = !orders?.length
      ? `<div class="woocommerce-message woocommerce-message--info woocommerce-Message woocommerce-Message--info woocommerce-info">Todavía no se ha hecho ningún pedido. <a class="woocommerce-Button button" href="/shop/">Explorar productos</a></div>`
      : `<table class="woocommerce-orders-table woocommerce-MyAccount-orders shop_table shop_table_responsive my_account_orders account-orders-table">
<thead><tr><th class="woocommerce-orders-table__header woocommerce-orders-table__header-order-number"><span class="nobr">Pedido</span></th><th class="woocommerce-orders-table__header woocommerce-orders-table__header-order-date"><span class="nobr">Fecha</span></th><th class="woocommerce-orders-table__header woocommerce-orders-table__header-order-status"><span class="nobr">Estado</span></th><th class="woocommerce-orders-table__header woocommerce-orders-table__header-order-total"><span class="nobr">Total</span></th><th class="woocommerce-orders-table__header woocommerce-orders-table__header-order-actions"><span class="nobr">Acciones</span></th></tr></thead>
<tbody>${orders
          .map((o) => {
            const n = (o.order_items as Array<{ quantity: number }>).reduce((s, i) => s + i.quantity, 0);
            return `<tr class="woocommerce-orders-table__row woocommerce-orders-table__row--status-${o.status} order">
<th class="woocommerce-orders-table__cell woocommerce-orders-table__cell-order-number" data-title="Pedido" scope="row"><a href="/mi-cuenta/view-order/${o.number}/">#${o.number}</a></th>
<td class="woocommerce-orders-table__cell woocommerce-orders-table__cell-order-date" data-title="Fecha"><time datetime="${o.placed_at}">${fmtDate(o.placed_at)}</time></td>
<td class="woocommerce-orders-table__cell woocommerce-orders-table__cell-order-status" data-title="Estado">${ORDER_STATUS[o.status] ?? o.status}</td>
<td class="woocommerce-orders-table__cell woocommerce-orders-table__cell-order-total" data-title="Total">${wcPrice(Number(o.total_cents))} por ${n} ${n === 1 ? "artículo" : "artículos"}</td>
<td class="woocommerce-orders-table__cell woocommerce-orders-table__cell-order-actions" data-title="Acciones"><a href="/mi-cuenta/view-order/${o.number}/" class="woocommerce-button button view">Ver</a></td></tr>`;
          })
          .join("")}</tbody></table>`;
  } else if (first === "view-order" && second && /^\d+$/.test(second)) {
    active = "orders";
    const { data: o } = await sb.from("orders").select("*").eq("number", Number(second)).maybeSingle();
    if (!o) notFound();
    const { data: items } = await sb.from("order_items").select("name, sku, quantity, line_total_cents").eq("order_id", o.id);
    const { data: notes } = await sb.from("order_notes").select("note, created_at").eq("order_id", o.id).eq("customer_visible", true).order("created_at", { ascending: false });
    const updates = notes?.length
      ? `<h2>Actualizaciones del pedido</h2><ol class="woocommerce-OrderUpdates commentlist notes">${notes
          .map((x) => `<li class="woocommerce-OrderUpdate comment note"><div class="woocommerce-OrderUpdate-inner comment_container"><div class="woocommerce-OrderUpdate-text comment-text"><p class="woocommerce-OrderUpdate-meta meta">${fmtDate(x.created_at)}</p><div class="woocommerce-OrderUpdate-description description"><p>${esc(x.note)}</p></div><div class="clear"></div></div><div class="clear"></div></div></li>`)
          .join("")}</ol>`
      : "";
    content = updates + orderDetailsHtml(o as OrderRow, (items ?? []) as OrderItemRow[], { thankyou: false, bankDetails: o.status === "on_hold" ? env().BANK_TRANSFER_DETAILS : null });
  } else {
    notFound();
  }
  return <LegacyPage name="account" values={{ account: accountShell(active, content) }} bodyClass={`${t.bodyClass} logged-in`} />;
}
