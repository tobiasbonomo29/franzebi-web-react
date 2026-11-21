import { NextResponse } from "next/server";
import { CheckoutError, placeOrder, placeSchema } from "@/lib/checkout";
import { orderAccessToken } from "@/lib/order-token";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const parsed = placeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Revisá los datos del formulario", fields: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 422 });
  }
  try {
    const r = await placeOrder(parsed.data);
    return NextResponse.json({ ok: true, number: r.number, redirect: `/pedido/${r.number}/?t=${orderAccessToken(r.orderId)}` });
  } catch (e) {
    if (e instanceof CheckoutError) return NextResponse.json({ error: e.message, code: e.code, detail: e.detail ?? null }, { status: e.status });
    console.error("[checkout] error inesperado", (e as Error).name);
    return NextResponse.json({ error: "Error inesperado. Intentá nuevamente." }, { status: 500 });
  }
}
