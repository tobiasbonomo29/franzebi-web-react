import { NextResponse } from "next/server";
import { getCart, getCartRequest, setCartItem } from "@/lib/cart";
import { adminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** Compatibilidad sin JS con los links de Woo "/?add-to-cart=<id>" (el middleware redirige acá). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  const qty = Math.min(99, Math.max(1, Number(url.searchParams.get("quantity")) || 1));
  if (Number.isFinite(id) && id > 0) {
    const { data } = await adminClient().from("products").select("sku").eq("legacy_woo_id", id).maybeSingle();
    if (data) {
      const cart = (await getCart(true))!;
      const current = (await getCartRequest(cart.id)).find((l) => l.sku === data.sku)?.quantity ?? 0;
      await setCartItem(cart.id, data.sku, current + qty).catch(() => undefined);
    }
  }
  return NextResponse.redirect(new URL("/carrito/", url), 303);
}
