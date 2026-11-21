import type { Metadata } from "next";
import { LegacyPage } from "@/components/LegacyPage";
import { computeCheckout } from "@/lib/checkout";
import { cartPageHtml } from "@/lib/legacy/cart-view";
import { template } from "@/lib/legacy/templates";

export const metadata: Metadata = { title: { absolute: template("cart").title }, robots: { index: false, follow: true } };

/** /carrito/ con el markup de WooCommerce. Precios, stock y mayorista los calcula el servidor. */
export default async function CartPage() {
  const c = await computeCheckout({});
  const t = template("cart");
  const html = await cartPageHtml(c.totals, t.empty ?? "");
  return <LegacyPage name="cart" values={{ cart: html }} bodyClass={c.totals.lines.length ? t.bodyClass : t.bodyClass.replace("woocommerce-cart", "woocommerce-cart woocommerce-cart-empty")} />;
}
