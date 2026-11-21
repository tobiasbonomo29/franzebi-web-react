import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AstroSellingSink, backoffMs, dispatchOrderEvents, toWooOrderPayload, type OrderEvent, type OrderEventStore, type OrderSink, type SinkOrder } from "../src/index.js";

const order: SinkOrder = {
  id: "00000000-0000-0000-0000-000000000001", number: 30001, status: "on_hold", email: "c@x.test", placedAt: "2026-11-21T15:00:00Z",
  paymentMethod: "cash", deliveryKind: "local_pickup", deliveryLabel: "Retiro por el local",
  billing: { firstName: "Ana", lastName: "Pérez", phone: "11", dni: "30111222" }, shippingAddress: null,
  subtotalCents: 9000000, shippingCents: 0, cashDiscountCents: 450000, totalCents: 8550000, note: null,
  items: [{ sku: "PER_ARB_M_LAT_ASAD_100ML", name: "Lattafa Asad", quantity: 2, unitPriceCents: 4500000, lineTotalCents: 9000000 }],
};

class MemStore implements OrderEventStore {
  events: Array<OrderEvent & { status: string; error?: string; next?: Date }> = [];
  async claim(limit: number) {
    return this.events.filter((e) => e.status === "pending" || e.status === "failed").slice(0, limit).map((e) => { e.attempts++; e.status = "sending"; return { ...e }; });
  }
  async loadOrder(id: string) { return id === order.id ? order : null; }
  async markSent(id: number) { this.events.find((e) => e.id === id)!.status = "sent"; }
  async markFailed(id: number, error: string, next: Date, dead: boolean) { Object.assign(this.events.find((e) => e.id === id)!, { status: dead ? "dead" : "failed", error, next }); }
}

describe("outbox de pedidos", () => {
  it("envía y marca sent", async () => {
    const s = new MemStore();
    s.events.push({ id: 1, orderId: order.id, sink: "astroselling", event: "order.created", attempts: 0, status: "pending" });
    const sent: string[] = [];
    const sink: OrderSink = { name: "astroselling", send: async (e) => { sent.push(e.event); return {}; } };
    const r = await dispatchOrderEvents(s, { astroselling: sink });
    expect(r).toMatchObject({ sent: 1 });
    expect(s.events[0]!.status).toBe("sent");
  });
  it("error 5xx => failed con backoff; tras maxAttempts => dead", async () => {
    const s = new MemStore();
    s.events.push({ id: 1, orderId: order.id, sink: "astroselling", event: "order.created", attempts: 0, status: "pending" });
    const sink = new AstroSellingSink({ webhookUrl: "https://x.test/hook", secret: "s", siteUrl: "https://f.test", fetchImpl: (async () => new Response("", { status: 503 })) as typeof fetch });
    await dispatchOrderEvents(s, { astroselling: sink }, { maxAttempts: 2 });
    expect(s.events[0]!.status).toBe("failed");
    await dispatchOrderEvents(s, { astroselling: sink }, { maxAttempts: 2 });
    expect(s.events[0]!.status).toBe("dead");
  });
  it("error 4xx no reintentable => dead directo", async () => {
    const s = new MemStore();
    s.events.push({ id: 1, orderId: order.id, sink: "astroselling", event: "order.created", attempts: 0, status: "pending" });
    const sink = new AstroSellingSink({ webhookUrl: "https://x.test/hook", secret: "s", siteUrl: "https://f.test", fetchImpl: (async () => new Response("", { status: 400 })) as typeof fetch });
    const r = await dispatchOrderEvents(s, { astroselling: sink });
    expect(r.dead).toBe(1);
  });
  it("sink desconocido no rompe al resto", async () => {
    const s = new MemStore();
    s.events.push({ id: 1, orderId: order.id, sink: "otro", event: "order.created", attempts: 0, status: "pending" });
    const r = await dispatchOrderEvents(s, {});
    expect(r.dead).toBe(1);
  });
  it("backoff exponencial con tope 6 h", () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(4)).toBe(8 * 60_000);
    expect(backoffMs(30)).toBe(360 * 60_000);
  });
});

describe("AstroSelling (webhook compatible Woo)", () => {
  it("payload Woo: estado on-hold, cod, SKU, descuento efectivo negativo", () => {
    const p = toWooOrderPayload(order, "https://franzebi.ar");
    expect(p).toMatchObject({ status: "on-hold", payment_method: "cod", total: "85500.00", currency: "ARS" });
    expect(p.line_items[0]).toMatchObject({ sku: "PER_ARB_M_LAT_ASAD_100ML", quantity: 2, total: "90000.00" });
    expect(p.fee_lines[0]!.total).toBe("-4500.00");
    expect(p.shipping_lines[0]!.method_id).toBe("local_pickup");
  });
  it("firma HMAC-SHA256 base64 como WooCommerce", async () => {
    let got: { headers: Record<string, string>; body: string } | null = null;
    const sink = new AstroSellingSink({
      webhookUrl: "https://x.test/hook", secret: "secreto", siteUrl: "https://franzebi.ar",
      fetchImpl: (async (_u: string, init: RequestInit) => { got = { headers: init.headers as Record<string, string>, body: String(init.body) }; return new Response("{}", { status: 200 }); }) as unknown as typeof fetch,
    });
    await sink.send({ id: 1, orderId: order.id, sink: "astroselling", event: "order.created", attempts: 1 }, order);
    expect(got!.headers["X-WC-Webhook-Topic"]).toBe("order.created");
    expect(got!.headers["X-WC-Webhook-Signature"]).toBe(createHmac("sha256", "secreto").update(got!.body).digest("base64"));
  });
});
