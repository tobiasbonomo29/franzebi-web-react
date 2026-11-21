import { NextResponse } from "next/server";
import { z } from "zod";
import { getCart, setCartItem } from "@/lib/cart";
import { computeCheckout } from "@/lib/checkout";

export const dynamic = "force-dynamic";

/** GET: carrito con totales calculados por el servidor (precios/stock/mayorista desde la base). */
export async function GET() {
  const c = await computeCheckout({});
  return NextResponse.json({ totals: c.totals, wholesale: c.totals.wholesale });
}

const body = z.object({ sku: z.string().trim().min(1).max(80), quantity: z.number().int().min(0).max(999) });

/** POST: fija la cantidad de un SKU (0 = quitar). El cliente nunca envía precios. */
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  try {
    const cart = await getCart(true);
    await setCartItem(cart!.id, parsed.data.sku.toUpperCase(), parsed.data.quantity);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: status === 404 ? "Producto inexistente" : "No pudimos actualizar el carrito" }, { status });
  }
  const c = await computeCheckout({});
  return NextResponse.json({ totals: c.totals, wholesale: c.totals.wholesale });
}
