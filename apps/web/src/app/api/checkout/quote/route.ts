import { NextResponse } from "next/server";
import { computeCheckout, quoteSchema } from "@/lib/checkout";

export const dynamic = "force-dynamic";

/**
 * Re-cotiza con destino + entrega + pago. Devuelve opciones válidas y la selección NORMALIZADA:
 * si el método de entrega cambia y el pago elegido deja de ser válido, el servidor lo corrige
 * y explica por qué (sin alternar ni ocultar en el cliente).
 */
export async function POST(req: Request) {
  const parsed = quoteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  const c = await computeCheckout(parsed.data);
  return NextResponse.json({
    totals: c.totals,
    shippingOptions: c.shippingOptions,
    paymentOptions: c.paymentOptions,
    selectedDeliveryOptionId: c.totals.shipping?.id ?? null,
    selectedPayment: c.totals.payment,
    paymentNotice: c.totals.paymentNotice ?? null,
    motoUnavailableReason: c.motoUnavailableReason ?? null,
    correoUnavailable: !!c.correoError,
    estimatedDelivery: c.estimatedDelivery ?? null,
  });
}
