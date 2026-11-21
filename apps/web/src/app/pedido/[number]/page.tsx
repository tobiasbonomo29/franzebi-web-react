import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegacyPage } from "@/components/LegacyPage";
import { getSessionProfile } from "@/lib/auth";
import { env } from "@/lib/env";
import { orderDetailsHtml, type OrderItemRow, type OrderRow } from "@/lib/legacy/order-view";
import { verifyOrderAccessToken } from "@/lib/order-token";
import { adminClient } from "@/lib/supabase";

export const metadata: Metadata = { title: { absolute: "Checkout – Franzebi Imports – Los Mejores Precios" }, robots: { index: false, follow: false } };

/** "Pedido recibido" (thankyou.php de Woo). Sólo dueño logueado, staff, o quien trae el token HMAC emitido al confirmar. */
export default async function OrderThanks({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ t?: string }> }) {
  const n = Number((await params).number);
  const token = (await searchParams).t;
  if (!Number.isInteger(n)) notFound();
  const db = adminClient();
  const { data: o } = await db.from("orders").select("*").eq("number", n).maybeSingle();
  if (!o) notFound();
  const profile = await getSessionProfile();
  const allowed = (profile && o.user_id === profile.id) || profile?.role === "admin" || profile?.role === "operator" || verifyOrderAccessToken(o.id, token);
  if (!allowed) notFound();
  const { data: items } = await db.from("order_items").select("name, sku, quantity, line_total_cents").eq("order_id", o.id);
  const html = orderDetailsHtml(o as OrderRow, (items ?? []) as OrderItemRow[], { thankyou: true, bankDetails: env().BANK_TRANSFER_DETAILS });
  return <LegacyPage name="checkout" values={{ checkout: html }} bodyClass="woocommerce-order-received woocommerce-checkout woocommerce-page woocommerce woocommerce-js page-template-default page wp-theme-vamtam-debebe wp-child-theme-debebe-child theme-vamtam-debebe full header-layout-logo-menu has-page-header no-middle-header responsive-layout vamtam-is-elementor elementor-active elementor-pro-active layout-full elementor-default elementor-kit-4 elementor-page elementor-page-16675" />;
}
