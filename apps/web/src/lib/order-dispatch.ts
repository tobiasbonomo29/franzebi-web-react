import "server-only";
import { AstroSellingSink, dispatchOrderEvents, type OrderEventStore, type OrderSink, type SinkOrder } from "@franzebi/sync";
import { env } from "./env";
import { adminClient } from "./supabase";

class SupabaseOrderEventStore implements OrderEventStore {
  private db = adminClient();
  async claim(limit: number) {
    await this.db.rpc("requeue_stuck_order_events");
    const { data, error } = await this.db.rpc("claim_order_events", { p_limit: limit });
    if (error) throw error;
    return (data ?? []).map((e: { id: number; order_id: string; sink: string; event: "order.created" | "order.updated"; attempts: number }) => ({ id: e.id, orderId: e.order_id, sink: e.sink, event: e.event, attempts: e.attempts }));
  }
  async loadOrder(id: string): Promise<SinkOrder | null> {
    const { data: o } = await this.db.from("orders").select("*, order_items(sku, name, quantity, unit_price_cents, line_total_cents)").eq("id", id).maybeSingle();
    if (!o) return null;
    return {
      id: o.id, number: Number(o.number), status: o.status, email: o.email, placedAt: o.placed_at,
      paymentMethod: o.payment_method, deliveryKind: o.delivery_kind, deliveryLabel: o.delivery_label,
      billing: o.billing ?? {}, shippingAddress: o.shipping_address,
      subtotalCents: Number(o.subtotal_cents), shippingCents: Number(o.shipping_cents), cashDiscountCents: Number(o.cash_discount_cents), totalCents: Number(o.total_cents),
      note: o.customer_note,
      items: (o.order_items as Array<{ sku: string; name: string; quantity: number; unit_price_cents: number; line_total_cents: number }>).map((i) => ({
        sku: i.sku, name: i.name, quantity: i.quantity, unitPriceCents: Number(i.unit_price_cents), lineTotalCents: Number(i.line_total_cents),
      })),
    };
  }
  async markSent(id: number, ref?: string) {
    await this.db.from("order_events").update({ status: "sent", sent_at: new Date().toISOString(), external_ref: ref ?? null, last_error: null }).eq("id", id);
  }
  async markFailed(id: number, error: string, next: Date, dead: boolean) {
    await this.db.from("order_events").update({ status: dead ? "dead" : "failed", last_error: error, next_attempt_at: next.toISOString() }).eq("id", id);
  }
}

/** Sinks disponibles. Para reemplazar AstroSelling: agregar acá el nuevo y cambiar settings.integrations.orderSinks. */
function buildSinks(): Record<string, OrderSink> {
  const e = env();
  const sinks: Record<string, OrderSink> = {};
  if (e.ASTROSELLING_ORDER_WEBHOOK_URL && e.ASTROSELLING_WEBHOOK_SECRET) {
    sinks.astroselling = new AstroSellingSink({ webhookUrl: e.ASTROSELLING_ORDER_WEBHOOK_URL, secret: e.ASTROSELLING_WEBHOOK_SECRET, siteUrl: e.SITE_URL });
  }
  return sinks;
}

export async function runOrderDispatch() {
  const e = env();
  // Doble llave: en staging no se mandan pedidos de prueba a AstroSelling (impactaría Alegra real).
  if (e.ORDER_DISPATCH_ENABLED !== "true") return { skipped: "ORDER_DISPATCH_ENABLED≠true" };
  return dispatchOrderEvents(new SupabaseOrderEventStore(), buildSinks(), { limit: 25, maxAttempts: 10 });
}
