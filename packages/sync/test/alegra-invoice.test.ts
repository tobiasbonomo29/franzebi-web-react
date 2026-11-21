import { describe, expect, it } from "vitest";
import { AlegraInvoiceSink, toAlegraInvoice, type AlegraInvoiceConfig, type SinkOrder } from "../src/index.js";

const cfg: AlegraInvoiceConfig = {
  email: "x@test", token: "t", siteUrl: "https://franzebi.ar", numberTemplateId: "3", warehouseId: "1",
  retailPriceListId: "pl-minorista", wholesalePriceListId: "pl-mayorista", minIntervalMs: 0,
};

const order: SinkOrder = {
  id: "o1", number: 30001, status: "on_hold", email: "ana@x.test", placedAt: "2026-11-21T23:30:00Z",
  paymentMethod: "bank_transfer", deliveryKind: "moto", deliveryLabel: "Moto CABA",
  billing: { firstName: "Ana", lastName: "Pérez", phone: "1155555555", dni: "30.111.222" },
  shippingAddress: { street: "Corrientes 1234", city: "CABA", state: "C", postcode: "1043" },
  subtotalCents: 13162500, shippingCents: 400000, cashDiscountCents: 0, totalCents: 13562500, note: null,
  items: [
    { sku: "PER_ARB_M_ARM_ODYSSEY_AQUA_100ML", name: "ARMAF ODYSSEY AQUA 100ML", quantity: 1, unitPriceCents: 7312500, lineTotalCents: 7312500, sourceId: "730" },
    { sku: "PER_ARB_M_RAS_HAWAS_FOR_HIM_MALIBU_100ML", name: "RASASI HAWAS", quantity: 1, unitPriceCents: 5850000, lineTotalCents: 5850000, sourceId: "1122" },
  ],
};

function fakeAlegra(opts: { invoices?: Array<{ id: string; observations: string }>; contacts?: Array<{ id: number }> } = {}) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = url.replace("https://api.alegra.com/api/v1", "");
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: String(init.method), path, body });
    const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });
    if (path.startsWith("/invoices?")) return json(opts.invoices ?? []);
    if (path.startsWith("/contacts?")) return json(opts.contacts ?? []);
    if (path === "/contacts") return json({ id: 9001 }, 201);
    if (path === "/invoices") return json({ id: "20001" }, 201);
    if (/\/invoices\/\d+\/void/.test(path)) return json({});
    return json({ message: "no encontrado" }, 404);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("factura directa en Alegra (formato AstroSelling)", () => {
  it("payload: TICKET, depósito Principal, MINORISTA, TRANSFER, observación con #pedido, precios en pesos", () => {
    const p = toAlegraInvoice(order, "9001", cfg);
    expect(p).toMatchObject({
      date: "2026-11-21", // 23:30 UTC = 20:30 en Buenos Aires
      dueDate: "2026-12-21",
      client: { id: "9001" },
      numberTemplate: { id: "3" },
      warehouse: { id: "1" },
      priceList: { id: "pl-minorista" },
      saleCondition: "TRANSFER",
      observations: "Venta https://franzebi.ar #30001 - Facturado desde franzebi.ar",
      items: [{ id: "730", price: 73125, quantity: 1, discount: 0 }, { id: "1122", price: 58500, quantity: 1, discount: 0 }],
    });
    expect(p).not.toHaveProperty("status");
  });

  it("efectivo => CASH con 5% de descuento por línea; mayorista => lista MAYORISTA; envío opcional como ítem", () => {
    const cash = toAlegraInvoice({ ...order, paymentMethod: "cash", cashDiscountCents: 658125, wholesaleApplied: true }, "1", { ...cfg, shippingItemId: "999" });
    expect(cash.saleCondition).toBe("CASH");
    expect(cash.priceList).toEqual({ id: "pl-mayorista" });
    expect(cash.items.slice(0, 2).every((i) => i.discount === 5)).toBe(true);
    expect(cash.items[2]).toEqual({ id: "999", price: 4000, quantity: 1, discount: 0 });
  });

  it("no factura si falta el id de Alegra de algún ítem (no reintenta)", () => {
    expect(() => toAlegraInvoice({ ...order, items: [{ ...order.items[0]!, sourceId: null }] }, "1", cfg)).toThrow(/sin id de Alegra/);
  });

  it("crea cliente por DNI si no existe y luego la factura", async () => {
    const a = fakeAlegra();
    const sink = new AlegraInvoiceSink({ ...cfg, fetchImpl: a.fetchImpl });
    const r = await sink.send({ id: 1, orderId: "o1", sink: "alegra", event: "order.created", attempts: 1 }, order);
    expect(r.externalRef).toBe("20001");
    expect(a.calls.map((c) => `${c.method} ${c.path.split("?")[0]}`)).toEqual(["GET /invoices", "GET /contacts", "POST /contacts", "POST /invoices"]);
    expect(a.calls[1]!.path).toContain("identification=30111222");
    expect(a.calls[2]!.body).toMatchObject({ name: "Ana Pérez", ivaCondition: "FINAL_CONSUMER", identificationObject: { type: "DNI", number: "30111222" } });
  });

  it("idempotente: si ya existe la factura con la marca del pedido no crea otra", async () => {
    const a = fakeAlegra({ invoices: [{ id: "15000", observations: "Venta https://franzebi.ar #30001 - Facturado desde franzebi.ar" }] });
    const sink = new AlegraInvoiceSink({ ...cfg, fetchImpl: a.fetchImpl });
    const r = await sink.send({ id: 1, orderId: "o1", sink: "alegra", event: "order.created", attempts: 2 }, order);
    expect(r.externalRef).toBe("15000");
    expect(a.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("no confunde #3000 con #30001", async () => {
    const a = fakeAlegra({ invoices: [{ id: "1", observations: "Venta https://franzebi.ar #3000 - Facturado desde franzebi.ar" }], contacts: [{ id: 7 }] });
    const sink = new AlegraInvoiceSink({ ...cfg, fetchImpl: a.fetchImpl });
    const r = await sink.send({ id: 1, orderId: "o1", sink: "alegra", event: "order.created", attempts: 1 }, order);
    expect(r.externalRef).toBe("20001");
  });

  it("pedido cancelado con factura => la anula; otros updates no tocan Alegra", async () => {
    const a = fakeAlegra();
    const sink = new AlegraInvoiceSink({ ...cfg, fetchImpl: a.fetchImpl });
    await sink.send({ id: 2, orderId: "o1", sink: "alegra", event: "order.updated", attempts: 1 }, { ...order, status: "processing", externalRefs: { alegra: "20001" } });
    expect(a.calls).toHaveLength(0);
    await sink.send({ id: 3, orderId: "o1", sink: "alegra", event: "order.updated", attempts: 1 }, { ...order, status: "cancelled", externalRefs: { alegra: "20001" } });
    expect(a.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /invoices/20001/void"]);
  });
});
