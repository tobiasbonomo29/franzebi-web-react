import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { ProductSnapshot, SaleMode, WholesaleGroup } from "@franzebi/domain";
import { env } from "./env";
import { adminClient } from "./supabase";
import { getSessionProfile } from "./auth";

const COOKIE = "fz_cart";

function hashToken(token: string) {
  return createHmac("sha256", env().CART_TOKEN_SECRET).update(token).digest("hex");
}

/** Devuelve el carrito abierto del usuario o del invitado (cookie httpOnly con token aleatorio; en DB sólo su hash). */
export async function getCart(create: boolean): Promise<{ id: string } | null> {
  const db = adminClient();
  const profile = await getSessionProfile();
  const jar = await cookies();
  if (profile) {
    const { data } = await db.from("carts").select("id").eq("user_id", profile.id).eq("status", "open").maybeSingle();
    if (data) return data;
    // fusionar carrito invitado al loguearse
    const token = jar.get(COOKIE)?.value;
    if (token) {
      const { data: guest } = await db.from("carts").update({ user_id: profile.id, anonymous_token_hash: null }).eq("anonymous_token_hash", hashToken(token)).eq("status", "open").select("id").maybeSingle();
      if (guest) return guest;
    }
    if (!create) return null;
    const { data: c, error } = await db.from("carts").insert({ user_id: profile.id }).select("id").single();
    if (error) throw error;
    return c;
  }
  let token = jar.get(COOKIE)?.value;
  if (token) {
    const { data } = await db.from("carts").select("id").eq("anonymous_token_hash", hashToken(token)).eq("status", "open").maybeSingle();
    if (data) return data;
  }
  if (!create) return null;
  token = randomBytes(32).toString("base64url");
  jar.set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  const { data: c, error } = await db.from("carts").insert({ anonymous_token_hash: hashToken(token) }).select("id").single();
  if (error) throw error;
  return c;
}

export async function getCartRequest(cartId: string) {
  const { data, error } = await adminClient().from("cart_items").select("quantity, products(sku)").eq("cart_id", cartId);
  if (error) throw error;
  return (data ?? []).map((r) => ({ sku: (r.products as unknown as { sku: string }).sku, quantity: r.quantity }));
}

export async function setCartItem(cartId: string, sku: string, quantity: number) {
  const db = adminClient();
  const { data: p } = await db.from("products").select("id").eq("sku", sku).maybeSingle();
  if (!p) throw Object.assign(new Error("Producto inexistente"), { status: 404 });
  if (quantity <= 0) {
    await db.from("cart_items").delete().eq("cart_id", cartId).eq("product_id", p.id);
  } else {
    const { error } = await db.from("cart_items").upsert({ cart_id: cartId, product_id: p.id, quantity: Math.min(999, Math.floor(quantity)) });
    if (error) throw error;
  }
}

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  status: "active" | "inactive" | "draft";
  sale_mode: SaleMode;
  stock_qty: number;
  wholesale_group: WholesaleGroup | null;
  weight_kg: number | null; length_cm: number | null; width_cm: number | null; height_cm: number | null;
  product_prices: Array<{ amount_cents: number; price_lists: { code: string } }>;
}

/** Lee precio/stock/grupo DESDE LA BASE para el cálculo del servidor. */
export async function loadSnapshots(skus: string[]) {
  const map = new Map<string, ProductSnapshot & { id: string }>();
  if (!skus.length) return map;
  const { data, error } = await adminClient()
    .from("products")
    .select("id, sku, name, status, sale_mode, stock_qty, wholesale_group, weight_kg, length_cm, width_cm, height_cm, product_prices(amount_cents, price_lists(code))")
    .in("sku", skus);
  if (error) throw error;
  const { data: hidden } = await adminClient().rpc("hidden_product_ids", { ids: (data ?? []).map((p) => p.id) });
  const hiddenSet = new Set<string>((hidden ?? []) as string[]);
  for (const p of (data ?? []) as unknown as ProductRow[]) {
    const price = (code: string) => p.product_prices.find((x) => x.price_lists.code === code)?.amount_cents ?? null;
    map.set(p.sku, {
      id: p.id,
      sku: p.sku,
      name: p.name,
      status: p.status === "active" ? "active" : "inactive",
      saleMode: hiddenSet.has(p.id) ? "hidden" : p.sale_mode,
      retailPriceCents: price("retail"),
      wholesalePriceCents: price("wholesale"),
      stock: p.stock_qty,
      wholesaleGroup: p.wholesale_group,
      weightKg: p.weight_kg, lengthCm: p.length_cm, widthCm: p.width_cm, heightCm: p.height_cm,
    });
  }
  return map;
}
