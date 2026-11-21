/**
 * Todo importe se maneja en CENTAVOS de ARS (enteros). Nunca floats para dinero.
 */
export type Cents = number;

export function toCents(ars: number | string): Cents {
  const n = typeof ars === "string" ? Number(ars.replace(",", ".")) : ars;
  if (!Number.isFinite(n) || n < 0) throw new RangeError(`Importe inválido: ${ars}`);
  return Math.round(n * 100);
}

/** Aplica un porcentaje (p.ej. 5 = 5%) y redondea al centavo (half-up). */
export function percentOf(amount: Cents, percent: number): Cents {
  return Math.round((amount * percent) / 100);
}

export function formatArs(c: Cents): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(c / 100);
}
