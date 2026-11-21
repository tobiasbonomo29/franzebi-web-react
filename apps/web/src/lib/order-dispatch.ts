import "server-only";
import { AlegraInvoiceSink, AstroSellingSink, dispatchOrderEvents, type OrderEvent, type OrderEventStore, type OrderSink, type SinkOrder } from "@franzebi/sync";
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
    const { data: o } = await this.db.from("orders").select("*, order_items(sku, name, quantity, unit_price_cents, line_total_cents, products(source_id))").eq("id", id).maybeSingle();
    if (!o) return null;
    return {
      id: o.id, number: Number(o.number), status: o.status, email: o.email, placedAt: o.placed_at,
      paymentMethod: o.payment_method, deliveryKind: o.delivery_kind, deliveryLabel: o.delivery_label,
      billing: o.billing ?? {}, shippingAddress: o.shipping_address,
      subtotalCents: Number(o.subtotal_cents), shippingCents: Number(o.shipping_cents), cashDiscountCents: Number(o.cash_discount_cents), totalCents: Number(o.total_cents),
      note: o.customer_note,
      wholesaleApplied: !!o.wholesale_applied,
      externalRefs: (o.external_refs ?? {}) as Record<string, string>,
      items: (o.order_items as Array<{ sku: string; name: string; quantity: number; unit_price_cents: number; line_total_cents: number; products: { source_id: string | null } | null }>).map((i) => ({
        sku: i.sku, name: i.name, quantity: i.quantity, unitPriceCents: Number(i.unit_price_cents), lineTotalCents: Number(i.line_total_cents), sourceId: i.products?.source_id ?? null,
      })),
    };
  }
  async markSent(ev: OrderEvent, ref?: string) {
    await this.db.from("order_events").update({ status: "sent", sent_at: new Date().toISOString(), external_ref: ref ?? null, last_error: null }).eq("id", ev.id);
    if (ref) {
      // Guarda la referencia en el pedido (p.ej. external_refs.alegra = id de factura) para anular/consultar luego
      const { data } = await this.db.from("orders").select("external_refs").eq("id", ev.orderId).maybeSingle();
      await this.db.from("orders").update({ external_refs: { ...((data?.external_refs as Record<string, string>) ?? {}), [ev.sink]: ref } }).eq("id", ev.orderId);
    }
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
  if (e.ALEGRA_API_EMAIL && e.ALEGRA_API_TOKEN && e.ALEGRA_INVOICE_PRICE_LIST_ID) {
    sinks.alegra = new AlegraInvoiceSink({
      email: e.ALEGRA_API_EMAIL, token: e.ALEGRA_API_TOKEN, siteUrl: e.SITE_URL,
      numberTemplateId: e.ALEGRA_INVOICE_NUMBER_TEMPLATE_ID, warehouseId: e.ALEGRA_INVOICE_WAREHOUSE_ID,
      retailPriceListId: e.ALEGRA_INVOICE_PRICE_LIST_ID, wholesalePriceListId: e.ALEGRA_INVOICE_WHOLESALE_PRICE_LIST_ID,
      shippingItemId: e.ALEGRA_INVOICE_SHIPPING_ITEM_ID, status: e.ALEGRA_INVOICE_STATUS,
    });
  }
  return sinks;
}

export async function runOrderDispatch() {
  const e = env();
  // Doble llave: en staging no se mandan pedidos de prueba a AstroSelling (impactaría Alegra real).
  if (e.ORDER_DISPATCH_ENABLED !== "true") return { skipped: "ORDER_DISPATCH_ENABLED≠true" };
  return dispatchOrderEvents(new SupabaseOrderEventStore(), buildSinks(), { limit: 25, maxAttempts: 10 });
}
