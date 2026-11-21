import type { Cents } from "./money.js";

/**
 * Sistema de puntos mayorista. Réplica de snippets #6, #7 y #31 de WordPress, parametrizado.
 *
 *  - Usuario minorista (primera compra mayorista): umbral `firstPurchaseThreshold` (10).
 *  - Usuario mayorista (re-stock): umbral `restockThreshold` (3).
 *  - Pesos por grupo (primera / re-stock): árabe 1/1, diseñador 2/1.5, cosmética 0.5/0.5.
 *  - Productos sin grupo (DECANTS) suman 0 — D-05 confirmado por el dueño.
 *  - El precio mayorista SIEMPRE viene de Alegra lista MAYORISTA (campo wholesalePriceCents).
 *    Nunca se calcula un descuento. Si un ítem no tiene precio MAYORISTA, queda a precio minorista y se informa.
 *  - Un carrito que no alcanza el umbral NO recibe precio mayorista.
 *
 * Los puntos se calculan en DÉCIMAS (enteros) para evitar errores de coma flotante.
 */

export type WholesaleGroup = "arabes" | "disenador" | "cosmetica";

export interface WholesaleRules {
  enabled: boolean;
  firstPurchaseThreshold: number;
  restockThreshold: number;
  groups: Record<WholesaleGroup, { label: string; firstPoints: number; restockPoints: number }>;
}

export interface WholesaleLineInput {
  sku: string;
  quantity: number;
  group: WholesaleGroup | null;
  retailPriceCents: Cents;
  wholesalePriceCents: Cents | null;
}

export interface WholesaleLineResult extends WholesaleLineInput {
  points: number;
  unitPriceCents: Cents;
  wholesaleApplied: boolean;
  note?: string;
}

export interface WholesaleEvaluation {
  mode: "first_purchase" | "restock";
  points: number;
  threshold: number;
  missingPoints: number;
  qualifies: boolean;
  reason: string;
  lines: WholesaleLineResult[];
  savingsCents: Cents;
  pointsByGroup: Record<WholesaleGroup | "sin_grupo", number>;
}

const tenths = (n: number) => Math.round(n * 10);

export function evaluateWholesale(
  lines: WholesaleLineInput[],
  isWholesaleUser: boolean,
  rules: WholesaleRules,
): WholesaleEvaluation {
  const mode = isWholesaleUser ? "restock" : "first_purchase";
  const threshold = isWholesaleUser ? rules.restockThreshold : rules.firstPurchaseThreshold;
  const byGroup: Record<WholesaleGroup | "sin_grupo", number> = { arabes: 0, disenador: 0, cosmetica: 0, sin_grupo: 0 };
  let totalT = 0;
  const perLinePoints = lines.map((l) => {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) throw new RangeError(`Cantidad inválida para ${l.sku}`);
    if (!l.group) return 0;
    const g = rules.groups[l.group];
    const t = tenths(isWholesaleUser ? g.restockPoints : g.firstPoints) * l.quantity;
    byGroup[l.group] += t;
    totalT += t;
    return t;
  });
  const thresholdT = tenths(threshold);
  const qualifies = rules.enabled && totalT >= thresholdT;
  let savings = 0;
  const out: WholesaleLineResult[] = lines.map((l, i) => {
    const base = { ...l, points: (perLinePoints[i] ?? 0) / 10 };
    if (!qualifies) return { ...base, unitPriceCents: l.retailPriceCents, wholesaleApplied: false };
    if (l.wholesalePriceCents == null || l.wholesalePriceCents <= 0) {
      return { ...base, unitPriceCents: l.retailPriceCents, wholesaleApplied: false, note: "Sin precio MAYORISTA en Alegra" };
    }
    // Nunca subir el precio por "mayorista"
    const unit = Math.min(l.wholesalePriceCents, l.retailPriceCents);
    savings += (l.retailPriceCents - unit) * l.quantity;
    return { ...base, unitPriceCents: unit, wholesaleApplied: true };
  });

  const missingT = Math.max(0, thresholdT - totalT);
  const points = totalT / 10;
  const reason = !rules.enabled
    ? "Beneficio mayorista desactivado"
    : qualifies
      ? mode === "restock"
        ? "Re-stock mayorista alcanzado"
        : "Primera compra mayorista alcanzada"
      : `Te faltan ${missingT / 10} puntos para precio mayorista (${points}/${threshold})`;

  for (const k of Object.keys(byGroup) as Array<keyof typeof byGroup>) byGroup[k] = byGroup[k] / 10;
  return { mode, points, threshold, missingPoints: missingT / 10, qualifies, reason, lines: out, savingsCents: savings, pointsByGroup: byGroup };
}

/**
 * ¿Asignar rol mayorista al confirmar el pedido? (Snippet #6: se evalúa con pesos de PRIMERA compra
 * cuando el pedido pasa a processing/completed.)
 */
export function shouldGrantWholesaleRole(
  orderLines: Array<Pick<WholesaleLineInput, "group" | "quantity">>,
  alreadyWholesale: boolean,
  rules: WholesaleRules,
): boolean {
  if (alreadyWholesale || !rules.enabled) return false;
  let t = 0;
  for (const l of orderLines) if (l.group) t += tenths(rules.groups[l.group].firstPoints) * l.quantity;
  return t >= tenths(rules.firstPurchaseThreshold);
}
