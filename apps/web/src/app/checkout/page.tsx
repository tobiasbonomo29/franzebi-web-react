import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LegacyPage } from "@/components/LegacyPage";
import { LegacyPortal } from "@/components/LegacyPortal";
import { computeCheckout } from "@/lib/checkout";
import { template } from "@/lib/legacy/templates";
import { CheckoutForm } from "./CheckoutForm";

export const metadata: Metadata = { title: { absolute: template("checkout").title }, robots: { index: false, follow: false } };

/** /checkout/ (Elementor 16675 + widget Checkout). Igual que Woo: con el carrito vacío vuelve al carrito. */
export default async function CheckoutPage() {
  const c = await computeCheckout({});
  if (!c.totals.lines.length) redirect("/carrito/");
  return (
    <LegacyPage name="checkout" values={{ checkout: `<p class="woocommerce-info">Cargando el checkout…</p>` }}>
      <LegacyPortal target="fz-checkout-root">
        <CheckoutForm />
      </LegacyPortal>
    </LegacyPage>
  );
}
