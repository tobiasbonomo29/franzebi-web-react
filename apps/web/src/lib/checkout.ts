import "server-only";
import {
  availablePaymentMethods,
  estimateMotoDelivery,
  initialOrderStatus,
  priceCart,
  quoteShipping,
  shouldGrantWholesaleRole,
  type CartTotals,
  type Destination,
  type PaymentMethodId,
  type ShippingOption,
} from "@franzebi/domain";
import { z } from "zod";
import { getSessionProfile, type SessionProfile } from "./auth";
import { getCart, getCartRequest, loadSnapshots } from "./cart";
import { loadCommerceConfig } from "./config";
import { MiCorreoQuoter } from "./correo";
import { sendOrderEmails } from "./email";
import { env } from "./env";
import { adminClient } from "./supabase";

export const destinationSchema = z.object({
  postcode: z.string().trim().max(10),
  state: z.string().trim().max(60),
  city: z.string().trim().max(80),
});

export const quoteSchema = z.object({
  destination: destinationSchema.optional(),
  deliveryOptionId: z.string().max(80).nullable().optional(),
  paymentMethod: z.enum(["bank_transfer", "cash"]).nullable().optional(),
});

export const placeSchema = quoteSchema.extend({
  destination: destinationSchema,
  deliveryOptionId: z.string().max(80),
  paymentMethod: z.enum(["bank_transfer", "cash"]),
  billing: z.object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    email: z.string().trim().email().max(160),
    phone: z.string().trim().min(6).max(40),
    dni: z.string().trim().regex(/^\d{7,9}$/, "DNI inválido"),
  }),
  address: z.object({
    street: z.string().trim().max(160),
    number: z.string().trim().max(20),
    apartment: z.string().trim().max(40).optional(),
    // Envíos Correo "a sucursal": sucursal elegida (como el selector del plugin de WP)
    agency: z.object({ code: z.string().trim().max(20), name: z.string().trim().max(160) }).optional(),
  }).optional(),
  note: z.string().trim().max(500).optional(),
  // El cliente confirma el total que vio; si el servidor calcula otro (cambió stock/precio), se rechaza para re-confirmar.
  expectedTotalCents: z.number().int().nonnegative(),
});

export interface CheckoutComputation {
  profile: SessionProfile | null;
  cartId: string | null;
  totals: CartTotals;
  shippingOptions: ShippingOption[];
  motoUnavailableReason?: string;
  correoError?: string;
  paymentOptions: ReturnType<typeof availablePaymentMethods>;
  estimatedDelivery?: string;
  snapshots: Awaited<ReturnType<typeof loadSnapshots>>;
  rulesVersion: number;
}

export async function computeCheckout(input: z.infer<typeof quoteSchema>): Promise<CheckoutComputation> {
  const [cfg, profile, cart] = await Promise.all([loadCommerceConfig(), getSessionProfile(), getCart(false)]);
  const request = cart ? await getCartRequest(cart.id) : [];
  const snapshots = await loadSnapshots(request.map((r) => r.sku));

  let shippingOptions: ShippingOption[] = [{ id: "local_pickup", kind: "local_pickup", label: cfg.shipping.pickup.label, priceCents: 0 }];
  let motoUnavailableReason: string | undefined;
  let correoError: string | undefined;
  if (input.destination?.postcode) {
    const lines = request.map((r) => ({ quantity: r.quantity, ...snapshots.get(r.sku) }));
    const q = await quoteShipping(input.destination as Destination, lines, cfg.shipping, MiCorreoQuoter.fromEnv());
    shippingOptions = q.options;
    motoUnavailableReason = q.motoUnavailableReason;
    correoError = q.correoError;
    await adminClient().from("shipping_quotes").insert({ cart_id: cart?.id ?? null, destination: input.destination, options: q.options, moto_unavailable_reason: q.motoUnavailableReason ?? null, correo_error: q.correoError ?? null });
  }
  // La opción elegida debe existir en la cotización del SERVIDOR para ese destino
  const shipping = shippingOptions.find((o) => o.id === input.deliveryOptionId) ?? null;

  const totals = priceCart({
    request,
    products: snapshots,
    isWholesaleUser: profile?.role === "wholesale",
    wholesaleRules: cfg.wholesale,
    shipping,
    requestedPayment: (input.paymentMethod ?? null) as PaymentMethodId | null,
    paymentsConfig: cfg.payments,
  });

  const estimatedDelivery = shipping?.kind === "moto" ? estimateMotoDelivery(new Date(), !!shipping.sameDayEligible, cfg.sameday).label : undefined;
  return {
    profile, cartId: cart?.id ?? null, totals, shippingOptions, motoUnavailableReason, correoError,
    paymentOptions: availablePaymentMethods(shipping?.kind ?? null, cfg.payments), estimatedDelivery, snapshots,
    rulesVersion: cfg.wholesale.version,
  };
}

export class CheckoutError extends Error {
  constructor(public code: string, message: string, public status = 409, public detail?: unknown) { super(message); }
}

export async function placeOrder(input: z.infer<typeof placeSchema>) {
  const c = await computeCheckout(input);
  const cfg = await loadCommerceConfig();
  if (!c.cartId || !c.totals.lines.length) throw new CheckoutError("empty_cart", "Tu carrito está vacío");
  if (!c.totals.shipping) throw new CheckoutError("invalid_delivery", "El método de entrega elegido no está disponible para tu dirección. Elegí otro.");
  if (c.totals.payment !== input.paymentMethod) throw new CheckoutError("invalid_payment", c.totals.paymentNotice ?? "El medio de pago no está disponible para esta entrega.");
  if (c.totals.issues.length) throw new CheckoutError("cart_changed", "Tu carrito cambió (stock o disponibilidad). Revisalo antes de confirmar.", 409, c.totals.issues);
  if (c.totals.totalCents !== input.expectedTotalCents) throw new CheckoutError("total_changed", "El total se actualizó. Revisá el resumen y confirmá nuevamente.", 409, { totalCents: c.totals.totalCents });
  const toBranch = c.totals.shipping.kind === "correo_argentino" && /_s$/.test(c.totals.shipping.id);
  if (toBranch && !input.address?.agency?.code) throw new CheckoutError("agency_required", "Elegí la sucursal de Correo Argentino donde vas a retirar el envío", 422);
  if (c.totals.shipping.kind !== "local_pickup" && !toBranch && !input.address?.street) throw new CheckoutError("address_required", "Ingresá la dirección de entrega", 422);

  const status = initialOrderStatus(c.totals.payment, cfg.payments);
  const items = c.totals.lines.map((l) => {
    const s = c.snapshots.get(l.sku)!;
    return {
      product_id: s.id, sku: l.sku, name: l.name, quantity: l.quantity, unit_price_cents: l.unitPriceCents,
      retail_unit_price_cents: s.retailPriceCents, line_total_cents: l.lineTotalCents, wholesale_applied: l.wholesaleApplied, wholesale_group: s.wholesaleGroup,
    };
  });
  const { data, error } = await adminClient().rpc("place_order", {
    p: {
      user_id: c.profile?.id ?? "",
      email: input.billing.email,
      status,
      payment_method: c.totals.payment,
      delivery_kind: c.totals.shipping.kind,
      delivery_option_id: c.totals.shipping.id,
      delivery_label: c.totals.shipping.label,
      moto_zone_id: c.totals.shipping.motoZoneId ?? "",
      estimated_delivery: c.estimatedDelivery ?? null,
      billing: input.billing,
      shipping_address: input.address ? { ...input.address, ...input.destination } : { ...input.destination },
      subtotal_cents: c.totals.subtotalCents,
      shipping_cents: c.totals.shippingCents,
      cash_discount_cents: c.totals.cashDiscountCents,
      total_cents: c.totals.totalCents,
      wholesale_applied: c.totals.wholesale.qualifies && c.totals.lines.some((l) => l.wholesaleApplied),
      wholesale_points: c.totals.wholesale.points,
      wholesale_threshold: c.totals.wholesale.threshold,
      wholesale_rules_version: c.rulesVersion || "",
      pricing_snapshot: c.totals,
      customer_note: input.note ?? null,
      cart_id: c.cartId,
      items,
    },
  });
  if (error) {
    const m = error.message.match(/STOCK_INSUFICIENTE:(\S+)/);
    if (m) throw new CheckoutError("out_of_stock", `Se agotó el stock de ${m[1]} mientras confirmabas. Revisá tu carrito.`);
    console.error("[checkout] place_order", error.code);
    throw new CheckoutError("internal", "No pudimos registrar el pedido. Intentá nuevamente.", 500);
  }
  const row = (data as Array<{ order_id: string; order_number: number }>)[0]!;
  const mail = await sendOrderEmails({
    number: row.order_number, email: input.billing.email, customerName: `${input.billing.firstName} ${input.billing.lastName}`,
    status: status === "on_hold" ? "En espera de validación de pago" : status, paymentLabel: c.totals.payment === "cash" ? "Efectivo" : "Transferencia bancaria",
    deliveryLabel: c.totals.shipping.label, lines: c.totals.lines, subtotalCents: c.totals.subtotalCents, shippingCents: c.totals.shippingCents,
    cashDiscountCents: c.totals.cashDiscountCents, totalCents: c.totals.totalCents, bankDetails: env().BANK_TRANSFER_DETAILS,
  });
  if (!mail.sent) await adminClient().from("audit_logs").insert({ action: "email_failed", entity: "orders", entity_id: row.order_id, after: { reason: mail.error?.slice(0, 200) } });
  return { orderId: row.order_id, number: row.order_number, status };
}

/** Cambio de estado por staff. Al pasar a processing/completed evalúa asignación de rol mayorista (snippet #6). */
export async function changeOrderStatus(actor: SessionProfile, orderId: string, next: string) {
  const db = adminClient();
  const allowed = ["on_hold", "processing", "completed", "cancelled", "refunded"];
  if (!allowed.includes(next)) throw new CheckoutError("bad_status", "Estado inválido", 422);
  const { data: o } = await db.from("orders").select("id, status, user_id").eq("id", orderId).single();
  if (!o) throw new CheckoutError("not_found", "Pedido inexistente", 404);
  const { error } = await db.from("orders").update({ status: next, paid_at: next === "processing" || next === "completed" ? new Date().toISOString() : undefined }).eq("id", orderId);
  if (error) throw error;
  await db.from("audit_logs").insert({ actor_id: actor.id, actor_role: actor.role, action: "status_change", entity: "orders", entity_id: orderId, before: { status: o.status }, after: { status: next } });
  if (next === "cancelled" || next === "refunded") await db.rpc("release_order_stock", { p_order: orderId });
  if ((next === "processing" || next === "completed") && o.user_id) {
    const [{ data: items }, { data: prof }, cfg] = await Promise.all([
      db.from("order_items").select("quantity, wholesale_group").eq("order_id", orderId),
      db.from("profiles").select("role").eq("id", o.user_id).single(),
      loadCommerceConfig(),
    ]);
    const already = prof?.role === "wholesale";
    if (prof?.role === "customer" && shouldGrantWholesaleRole((items ?? []).map((i) => ({ quantity: i.quantity, group: i.wholesale_group })), already, cfg.wholesale)) {
      await db.from("profiles").update({ role: "wholesale", wholesale_since: new Date().toISOString() }).eq("id", o.user_id);
      await db.from("audit_logs").insert({ actor_id: actor.id, actor_role: actor.role, action: "role_change", entity: "profiles", entity_id: o.user_id, before: { role: "customer" }, after: { role: "wholesale", reason: `pedido ${orderId}` } });
    }
  }
}
