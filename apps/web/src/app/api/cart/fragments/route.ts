import { NextResponse } from "next/server";
import { z } from "zod";
import { getCart, getCartRequest, setCartItem } from "@/lib/cart";
import { computeCheckout } from "@/lib/checkout";
import { cartFragments } from "@/lib/legacy/cart-view";

export const dynamic = "force-dynamic";

/** GET: fragmentos del mini-carrito (contador, subtotal, contenido), como los "cart fragments" de Woo. */
export async function GET() {
  const c = await computeCheckout({});
  return NextResponse.json(await cartFragments(c.totals), { headers: { "Cache-Control": "no-store" } });
}

const body = z.object({
  action: z.enum(["add", "set"]),
  sku: z.string().trim().min(1).max(80),
  quantity: z.number().int().min(0).max(999),
});

/** POST: agrega (add) o fija (set) la cantidad de un SKU. El cliente nunca envía precios. */
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  const sku = parsed.data.sku.toUpperCase();
  try {
    const cart = (await getCart(true))!;
    let qty = parsed.data.quantity;
    if (parsed.data.action === "add") {
      const current = (await getCartRequest(cart.id)).find((l) => l.sku === sku)?.quantity ?? 0;
      qty = current + Math.max(1, qty);
    }
    await setCartItem(cart.id, sku, qty);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: status === 404 ? "Producto inexistente" : "No pudimos actualizar el carrito" }, { status });
  }
  const c = await computeCheckout({});
  const issue = c.totals.issues.find((i) => i.sku === sku);
  return NextResponse.json({ ...(await cartFragments(c.totals)), notice: issue?.message ?? null });
}
