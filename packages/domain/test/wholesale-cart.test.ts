import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAYMENTS,
  DEFAULT_WHOLESALE as R,
  evaluateWholesale,
  priceCart,
  shouldGrantWholesaleRole,
  type ProductSnapshot,
  type WholesaleGroup,
} from "../src/index.js";

const line = (group: WholesaleGroup | null, quantity: number, retail = 100000, wholesale: number | null = 80000) => ({
  sku: `${group}-${quantity}-${Math.random()}`,
  quantity,
  group,
  retailPriceCents: retail,
  wholesalePriceCents: wholesale,
});

describe("puntos mayoristas", () => {
  it("minorista: 10 árabes = 10 pts => califica", () => {
    const e = evaluateWholesale([line("arabes", 10)], false, R);
    expect(e).toMatchObject({ points: 10, threshold: 10, qualifies: true, missingPoints: 0 });
    expect(e.savingsCents).toBe(10 * 20000);
  });
  it("minorista: 9 árabes no califica y NO recibe precio mayorista", () => {
    const e = evaluateWholesale([line("arabes", 9)], false, R);
    expect(e.qualifies).toBe(false);
    expect(e.missingPoints).toBe(1);
    expect(e.lines.every((l) => !l.wholesaleApplied && l.unitPriceCents === 100000)).toBe(true);
    expect(e.reason).toMatch(/faltan 1 puntos/);
  });
  it("minorista: 5 diseñador = 10 pts (consistente con FAQ '5 unidades')", () => expect(evaluateWholesale([line("disenador", 5)], false, R).qualifies).toBe(true));
  it("re-stock: 3 árabes = 3 pts", () => expect(evaluateWholesale([line("arabes", 3)], true, R).qualifies).toBe(true));
  it("re-stock: 2 diseñador = 3 pts (FAQ '2 unidades')", () => expect(evaluateWholesale([line("disenador", 2)], true, R).points).toBe(3));
  it("CONTRADICCIÓN D-04: 2 cosmética + 1 diseñador = 2,5 pts y con reglas actuales NO califica", () => {
    const e = evaluateWholesale([line("cosmetica", 2), line("disenador", 1)], true, R);
    expect(e.points).toBe(2.5);
    expect(e.qualifies).toBe(false);
  });
  it("sin coma flotante: 20 cosmética = 10 pts exactos", () => expect(evaluateWholesale([line("cosmetica", 20)], false, R).qualifies).toBe(true));
  it("decants (sin grupo) suman 0 (D-05)", () => expect(evaluateWholesale([line(null, 50)], false, R).points).toBe(0));
  it("sin precio MAYORISTA en Alegra: queda minorista y se informa (nunca se inventa descuento)", () => {
    const e = evaluateWholesale([line("arabes", 10, 100000, null)], false, R);
    expect(e.qualifies).toBe(true);
    expect(e.lines[0]).toMatchObject({ wholesaleApplied: false, unitPriceCents: 100000, note: "Sin precio MAYORISTA en Alegra" });
  });
  it("precio mayorista mayor al minorista nunca encarece", () => {
    const e = evaluateWholesale([line("arabes", 10, 100000, 120000)], false, R);
    expect(e.lines[0]!.unitPriceCents).toBe(100000);
  });
  it("asigna rol al confirmar primera compra >= 10 pts con pesos de primera compra", () => {
    expect(shouldGrantWholesaleRole([{ group: "disenador", quantity: 5 }], false, R)).toBe(true);
    expect(shouldGrantWholesaleRole([{ group: "arabes", quantity: 9 }], false, R)).toBe(false);
    expect(shouldGrantWholesaleRole([{ group: "arabes", quantity: 20 }], true, R)).toBe(false);
  });
});

describe("carrito", () => {
  const prod = (sku: string, o: Partial<ProductSnapshot> = {}): ProductSnapshot => ({
    sku,
    name: sku,
    status: "active",
    saleMode: "purchasable",
    retailPriceCents: 100000,
    wholesalePriceCents: 80000,
    stock: 5,
    wholesaleGroup: "arabes",
    ...o,
  });
  const base = {
    isWholesaleUser: false,
    wholesaleRules: R,
    shipping: null,
    requestedPayment: null,
    paymentsConfig: DEFAULT_PAYMENTS,
  };
  it("stock insuficiente: ajusta cantidad y avisa, sin error", () => {
    const t = priceCart({ ...base, request: [{ sku: "A", quantity: 8 }], products: new Map([["A", prod("A")]]) });
    expect(t.lines[0]!.quantity).toBe(5);
    expect(t.issues[0]).toMatchObject({ type: "quantity_reduced", requested: 8, available: 5 });
    expect(t.totalCents).toBe(500000);
  });
  it("sin stock, a pedido, oculto e inexistente quedan fuera con motivo", () => {
    const t = priceCart({
      ...base,
      request: [{ sku: "A", quantity: 1 }, { sku: "D", quantity: 1 }, { sku: "E", quantity: 1 }, { sku: "X", quantity: 1 }],
      products: new Map([
        ["A", prod("A", { stock: 0 })],
        ["D", prod("D", { saleMode: "on_request" })],
        ["E", prod("E", { saleMode: "hidden" })],
      ]),
    });
    expect(t.lines).toHaveLength(0);
    expect(t.issues.map((i) => i.type)).toEqual(["out_of_stock", "on_request", "not_for_sale", "not_found"]);
  });
  it("cantidades del cliente negativas/decimales se sanean", () => {
    const t = priceCart({ ...base, request: [{ sku: "A", quantity: -3 }, { sku: "A", quantity: 2.7 }], products: new Map([["A", prod("A")]]) });
    expect(t.lines[0]!.quantity).toBe(2);
  });
  it("efectivo con retiro aplica 5% sobre productos", () => {
    const t = priceCart({
      ...base,
      request: [{ sku: "A", quantity: 2 }],
      products: new Map([["A", prod("A")]]),
      shipping: { id: "local_pickup", kind: "local_pickup", label: "Retiro", priceCents: 0 },
      requestedPayment: "cash",
    });
    expect(t.payment).toBe("cash");
    expect(t.cashDiscountCents).toBe(10000);
    expect(t.totalCents).toBe(190000);
  });
  it("efectivo pedido con Correo => transferencia, sin descuento", () => {
    const t = priceCart({
      ...base,
      request: [{ sku: "A", quantity: 1 }],
      products: new Map([["A", prod("A")]]),
      shipping: { id: "correo:x", kind: "correo_argentino", label: "Correo", priceCents: 700000 },
      requestedPayment: "cash",
    });
    expect(t.payment).toBe("bank_transfer");
    expect(t.cashDiscountCents).toBe(0);
    expect(t.totalCents).toBe(800000);
  });
});
