import { createHmac, randomUUID } from "node:crypto";

/**
 * Salida de pedidos hacia sistemas externos (D-18). Hoy: AstroSelling (que a su vez impacta Alegra).
 * Mañana: otro sink (p.ej. factura/remito directo en Alegra) sin tocar checkout ni base: sólo se agrega
 * una implementación de OrderSink y se cambia settings.integrations.orderSinks.
 */

export interface SinkOrder {
  id: string;
  number: number;
  status: "pending" | "on_hold" | "processing" | "completed" | "cancelled" | "refunded" | "failed";
  email: string;
  placedAt: string;
  paymentMethod: "bank_transfer" | "cash" | "mercadopago" | "card";
  deliveryKind: "local_pickup" | "moto" | "moto_scheduled_caba" | "correo_argentino";
  deliveryLabel: string;
  billing: { firstName?: string; lastName?: string; phone?: string; dni?: string; email?: string };
  shippingAddress: { street?: string; number?: string; apartment?: string; city?: string; state?: string; postcode?: string } | null;
  subtotalCents: number;
  shippingCents: number;
  cashDiscountCents: number;
  totalCents: number;
  note: string | null;
  wholesaleApplied?: boolean;
  /** Referencias ya obtenidas por sink (p.ej. { alegra: "10714" }) */
  externalRefs?: Record<string, string>;
  items: Array<{ sku: string; name: string; quantity: number; unitPriceCents: number; lineTotalCents: number; sourceId?: string | null }>;
}

export interface OrderEvent {
  id: number;
  orderId: string;
  sink: string;
  event: "order.created" | "order.updated";
  attempts: number;
}

export interface OrderSink {
  readonly name: string;
  send(event: OrderEvent, order: SinkOrder): Promise<{ externalRef?: string }>;
}

export interface OrderEventStore {
  claim(limit: number): Promise<OrderEvent[]>;
  loadOrder(orderId: string): Promise<SinkOrder | null>;
  markSent(event: OrderEvent, externalRef: string | undefined): Promise<void>;
  markFailed(eventId: number, error: string, nextAttemptAt: Date, dead: boolean): Promise<void>;
}

export class SinkError extends Error {
  constructor(message: string, public retryable: boolean) { super(message); }
}

/** Backoff exponencial: 1, 2, 4, 8… minutos, tope 6 h. */
export function backoffMs(attempts: number) {
  return Math.min(2 ** Math.max(0, attempts - 1), 360) * 60_000;
}

export async function dispatchOrderEvents(
  store: OrderEventStore,
  sinks: Record<string, OrderSink>,
  opts: { limit?: number; maxAttempts?: number; now?: () => Date } = {},
) {
  const now = opts.now ?? (() => new Date());
  const max = opts.maxAttempts ?? 10;
  const res = { claimed: 0, sent: 0, failed: 0, dead: 0 };
  const events = await store.claim(opts.limit ?? 20);
  res.claimed = events.length;
  for (const ev of events) {
    const fail = async (msg: string, retryable: boolean) => {
      const dead = !retryable || ev.attempts >= max;
      await store.markFailed(ev.id, msg.slice(0, 1000), new Date(now().getTime() + backoffMs(ev.attempts)), dead);
      dead ? res.dead++ : res.failed++;
    };
    const sink = sinks[ev.sink];
    if (!sink) { await fail(`Sink "${ev.sink}" no configurado`, false); continue; }
    const order = await store.loadOrder(ev.orderId);
    if (!order) { await fail("Pedido inexistente", false); continue; }
    try {
      const r = await sink.send(ev, order);
      await store.markSent(ev, r.externalRef);
      res.sent++;
    } catch (e) {
      await fail((e as Error).message, e instanceof SinkError ? e.retryable : true);
    }
  }
  return res;
}

// ---------------------------------------------------------------------------
// AstroSelling: replica el webhook de WooCommerce que hoy recibe
// (https://nova.astroselling.com/api/v1/channels/<canal>/webhooks/order).
// ⚠️ A CONFIRMAR CON ASTROSELLING antes de producción: si su canal Woo, además del webhook,
// consulta la API REST de Woo por el id del pedido (que ya no existirá). Si es así, hay que pedirles
// un canal genérico/API o migrar a un sink directo a Alegra.
// ---------------------------------------------------------------------------
const WOO_STATUS: Record<SinkOrder["status"], string> = {
  pending: "pending", on_hold: "on-hold", processing: "processing", completed: "completed", cancelled: "cancelled", refunded: "refunded", failed: "failed",
};
const WOO_PAYMENT: Record<SinkOrder["paymentMethod"], [string, string]> = {
  bank_transfer: ["bacs", "Transferencia Bancaria"],
  cash: ["cod", "Pagar en efectivo al retirar por el local"],
  mercadopago: ["woo-mercado-pago-basic", "Mercado Pago"],
  card: ["card", "Tarjeta"],
};
const WOO_SHIPPING: Record<SinkOrder["deliveryKind"], string> = {
  local_pickup: "local_pickup", moto: "flat_rate", moto_scheduled_caba: "flat_rate", correo_argentino: "correoargentino_shipping_method",
};
const money = (c: number) => (c / 100).toFixed(2);

export function toWooOrderPayload(o: SinkOrder, siteUrl: string) {
  const [pm, pmTitle] = WOO_PAYMENT[o.paymentMethod];
  const addr = {
    first_name: o.billing.firstName ?? "", last_name: o.billing.lastName ?? "",
    address_1: [o.shippingAddress?.street, o.shippingAddress?.number].filter(Boolean).join(" "), address_2: o.shippingAddress?.apartment ?? "",
    city: o.shippingAddress?.city ?? "", state: o.shippingAddress?.state ?? "", postcode: o.shippingAddress?.postcode ?? "", country: "AR",
  };
  return {
    id: o.number, number: String(o.number), order_key: `fz_${o.id}`, created_via: "franzebi-app",
    status: WOO_STATUS[o.status], currency: "ARS", date_created: o.placedAt,
    total: money(o.totalCents), shipping_total: money(o.shippingCents), discount_total: "0.00",
    payment_method: pm, payment_method_title: pmTitle, customer_note: o.note ?? "",
    billing: { ...addr, email: o.email, phone: o.billing.phone ?? "" },
    shipping: addr,
    line_items: o.items.map((i, n) => ({ id: n + 1, name: i.name, sku: i.sku, quantity: i.quantity, price: Number(money(i.unitPriceCents)), subtotal: money(i.lineTotalCents), total: money(i.lineTotalCents) })),
    shipping_lines: [{ id: 1, method_id: WOO_SHIPPING[o.deliveryKind], method_title: o.deliveryLabel, total: money(o.shippingCents) }],
    fee_lines: o.cashDiscountCents ? [{ id: 1, name: "Descuento por Efectivo", total: `-${money(o.cashDiscountCents)}` }] : [],
    meta_data: [{ key: "_billing_dni", value: o.billing.dni ?? "" }, { key: "_franzebi_order_id", value: o.id }],
    _links: { self: [{ href: `${siteUrl}/pedido/${o.number}/` }] },
  };
}

export class AstroSellingSink implements OrderSink {
  readonly name = "astroselling";
  constructor(private cfg: { webhookUrl: string; secret: string; siteUrl: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {
    if (!cfg.webhookUrl || !cfg.secret) throw new Error("Faltan ASTROSELLING_ORDER_WEBHOOK_URL / ASTROSELLING_WEBHOOK_SECRET");
  }
  async send(ev: OrderEvent, order: SinkOrder) {
    const body = JSON.stringify(toWooOrderPayload(order, this.cfg.siteUrl));
    const signature = createHmac("sha256", this.cfg.secret).update(body).digest("base64");
    const res = await (this.cfg.fetchImpl ?? fetch)(this.cfg.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Franzebi-Commerce/1.0 (WooCommerce-compatible webhook)",
        "X-WC-Webhook-Source": `${this.cfg.siteUrl}/`,
        "X-WC-Webhook-Topic": ev.event,
        "X-WC-Webhook-Resource": "order",
        "X-WC-Webhook-Event": ev.event.split(".")[1]!,
        "X-WC-Webhook-Signature": signature,
        "X-WC-Webhook-Delivery-ID": randomUUID(),
      },
      body,
      signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 15_000),
    });
    if (res.ok) return { externalRef: res.headers.get("x-request-id") ?? undefined };
    const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
    throw new SinkError(`AstroSelling HTTP ${res.status}`, retryable);
  }
}
