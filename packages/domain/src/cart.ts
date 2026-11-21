import type { Cents } from "./money.js";
import { cashDiscount, resolvePaymentSelection, type PaymentMethodId, type PaymentsConfig } from "./payments.js";
import type { ShippingOption } from "./shipping.js";
import { evaluateWholesale, type WholesaleEvaluation, type WholesaleGroup, type WholesaleRules } from "./wholesale.js";

/**
 * Motor de totales del carrito. Corre SÓLO en el servidor con datos leídos de la base
 * (precio, stock, grupo, estado). El cliente sólo envía { sku, quantity } y sus elecciones.
 */

export type SaleMode = "purchasable" | "on_request" | "hidden";

export interface ProductSnapshot {
  sku: string;
  name: string;
  status: "active" | "inactive";
  saleMode: SaleMode;
  retailPriceCents: Cents | null;
  wholesalePriceCents: Cents | null;
  stock: number; // unidades disponibles (ya descontadas reservas)
  wholesaleGroup: WholesaleGroup | null;
  weightKg?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
}

export interface CartRequestLine {
  sku: string;
  quantity: number;
}

export type CartIssue =
  | { sku: string; type: "not_found" | "not_for_sale" | "on_request" | "no_price"; message: string }
  | { sku: string; type: "out_of_stock"; message: string }
  | { sku: string; type: "quantity_reduced"; requested: number; available: number; message: string };

export interface PricedLine {
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: Cents;
  lineTotalCents: Cents;
  wholesaleApplied: boolean;
  note?: string;
}

export interface CartTotals {
  lines: PricedLine[];
  issues: CartIssue[];
  wholesale: WholesaleEvaluation;
  subtotalCents: Cents;
  shipping: ShippingOption | null;
  shippingCents: Cents;
  payment: PaymentMethodId;
  paymentNotice?: string;
  cashDiscountCents: Cents;
  totalCents: Cents;
}

const MAX_QTY_PER_LINE = 999;

export function priceCart(input: {
  request: CartRequestLine[];
  products: Map<string, ProductSnapshot>;
  isWholesaleUser: boolean;
  wholesaleRules: WholesaleRules;
  shipping: ShippingOption | null;
  requestedPayment: PaymentMethodId | null;
  paymentsConfig: PaymentsConfig;
}): CartTotals {
  const issues: CartIssue[] = [];
  const valid: Array<{ p: ProductSnapshot; qty: number }> = [];

  // Consolidar SKUs repetidos
  const merged = new Map<string, number>();
  for (const l of input.request) {
    const q = Math.floor(Number(l.quantity));
    if (!Number.isFinite(q) || q <= 0) continue;
    merged.set(l.sku, Math.min(MAX_QTY_PER_LINE, (merged.get(l.sku) ?? 0) + q));
  }

  for (const [sku, requested] of merged) {
    const p = input.products.get(sku);
    if (!p) { issues.push({ sku, type: "not_found", message: "El producto ya no está disponible" }); continue; }
    if (p.status !== "active" || p.saleMode === "hidden") { issues.push({ sku, type: "not_for_sale", message: `${p.name} no está a la venta` }); continue; }
    if (p.saleMode === "on_request") { issues.push({ sku, type: "on_request", message: `${p.name} es a pedido: consultanos por WhatsApp` }); continue; }
    if (p.retailPriceCents == null || p.retailPriceCents <= 0) { issues.push({ sku, type: "no_price", message: `${p.name} no tiene precio vigente` }); continue; }
    if (p.stock <= 0) { issues.push({ sku, type: "out_of_stock", message: `${p.name} está sin stock` }); continue; }
    let qty = requested;
    if (requested > p.stock) {
      qty = p.stock;
      issues.push({ sku, type: "quantity_reduced", requested, available: p.stock, message: `Sólo quedan ${p.stock} unidades de ${p.name}; ajustamos la cantidad` });
    }
    valid.push({ p, qty });
  }

  const wholesale = evaluateWholesale(
    valid.map(({ p, qty }) => ({ sku: p.sku, quantity: qty, group: p.wholesaleGroup, retailPriceCents: p.retailPriceCents!, wholesalePriceCents: p.wholesalePriceCents })),
    input.isWholesaleUser,
    input.wholesaleRules,
  );

  const lines: PricedLine[] = wholesale.lines.map((wl, i) => ({
    sku: wl.sku,
    name: valid[i]!.p.name,
    quantity: wl.quantity,
    unitPriceCents: wl.unitPriceCents,
    lineTotalCents: wl.unitPriceCents * wl.quantity,
    wholesaleApplied: wl.wholesaleApplied,
    note: wl.note,
  }));
  const subtotal = lines.reduce((s, l) => s + l.lineTotalCents, 0);
  const pay = resolvePaymentSelection(input.requestedPayment, input.shipping?.kind ?? null, input.paymentsConfig);
  const cash = pay.method === "cash" ? cashDiscount(subtotal, input.paymentsConfig) : 0;
  const shippingCents = input.shipping?.priceCents ?? 0;

  return {
    lines,
    issues,
    wholesale,
    subtotalCents: subtotal,
    shipping: input.shipping,
    shippingCents,
    payment: pay.method,
    paymentNotice: pay.notice,
    cashDiscountCents: cash,
    totalCents: subtotal - cash + shippingCents,
  };
}
