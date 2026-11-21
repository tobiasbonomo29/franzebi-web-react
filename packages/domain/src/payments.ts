import { percentOf, type Cents } from "./money.js";
import type { DeliveryKind } from "./shipping.js";

/**
 * Medios de pago. Se resuelven SIEMPRE en el backend a partir del método de entrega.
 *
 * Reglas fijas:
 *  - Efectivo NUNCA para Correo Argentino (no configurable).
 *  - Transferencia => pedido "on_hold" (En espera) hasta validación manual.
 *  - Mercado Pago / tarjetas: inactivos.
 *  - Cambiar el método de entrega nunca deja un medio de pago inválido: se normaliza a transferencia
 *    y se informa el motivo (no se alterna ni se oculta silenciosamente).
 *
 * Configurable: en qué entregas se permite efectivo (D-01 resuelto: sólo retiro).
 * Default = sólo retiro local, confirmado por el dueño.
 */

export type PaymentMethodId = "bank_transfer" | "cash" | "mercadopago" | "card";

export interface PaymentsConfig {
  bankTransfer: { enabled: boolean; label: string; instructions: string };
  cash: {
    enabled: boolean;
    label: string;
    discountPercent: number; // 5
    allowedDeliveryKinds: Array<Exclude<DeliveryKind, "correo_argentino">>;
    /** Estado inicial de pedidos en efectivo (D-02 resuelto: on_hold). */
    initialOrderStatus: "on_hold" | "processing";
  };
  mercadopago: { enabled: false };
  card: { enabled: false };
}

export interface PaymentOption {
  id: PaymentMethodId;
  label: string;
  discountPercent?: number;
}

export function availablePaymentMethods(delivery: DeliveryKind | null, cfg: PaymentsConfig): PaymentOption[] {
  const out: PaymentOption[] = [];
  if (cfg.bankTransfer.enabled) out.push({ id: "bank_transfer", label: cfg.bankTransfer.label });
  if (delivery && isCashAllowed(delivery, cfg)) {
    out.push({ id: "cash", label: cfg.cash.label, discountPercent: cfg.cash.discountPercent });
  }
  return out;
}

export function isCashAllowed(delivery: DeliveryKind, cfg: PaymentsConfig): boolean {
  if (!cfg.cash.enabled) return false;
  if (delivery === "correo_argentino") return false; // regla dura
  return (cfg.cash.allowedDeliveryKinds as DeliveryKind[]).includes(delivery);
}

export interface PaymentResolution {
  method: PaymentMethodId;
  changed: boolean;
  notice?: string;
}

/** Normaliza el medio elegido tras un cambio de entrega. Determinístico, sin "toggles". */
export function resolvePaymentSelection(
  requested: PaymentMethodId | null,
  delivery: DeliveryKind | null,
  cfg: PaymentsConfig,
): PaymentResolution {
  const options = availablePaymentMethods(delivery, cfg);
  const fallback: PaymentMethodId = options[0]?.id ?? "bank_transfer";
  if (requested && options.some((o) => o.id === requested)) return { method: requested, changed: false };
  if (requested === "cash") {
    return {
      method: fallback,
      changed: true,
      notice: "El pago en efectivo no está disponible para el método de entrega elegido. Seleccionamos transferencia bancaria.",
    };
  }
  return { method: fallback, changed: requested !== null && requested !== fallback };
}

/** Descuento por efectivo sobre productos (no sobre envío). Devuelve monto POSITIVO a restar. */
export function cashDiscount(productsSubtotal: Cents, cfg: PaymentsConfig): Cents {
  const d = percentOf(productsSubtotal, cfg.cash.discountPercent);
  // Defensa contra el bug histórico de WP: "Descuento por Efectivo" con signo positivo (recargo).
  return Math.max(0, Math.min(d, productsSubtotal));
}

export type OrderStatus = "pending" | "on_hold" | "processing" | "completed" | "cancelled" | "refunded" | "failed";

export function initialOrderStatus(method: PaymentMethodId, cfg: PaymentsConfig): OrderStatus {
  if (method === "bank_transfer") return "on_hold";
  if (method === "cash") return cfg.cash.initialOrderStatus;
  return "pending";
}
