import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAYMENTS,
  DEFAULT_SAMEDAY,
  DEFAULT_SHIPPING,
  DEFAULT_WHOLESALE,
  availablePaymentMethods,
  evaluateWholesale,
  quoteShipping,
  resolveMotoZone,
} from "../src/index.js";

/** Decisiones confirmadas por el dueño el 2026-11-21 (docs/03). Si alguna cambia, actualizar acá y en el doc. */
describe("decisiones confirmadas 2026-11-21", () => {
  it("D-01 efectivo sólo con retiro", () => {
    expect(availablePaymentMethods("local_pickup", DEFAULT_PAYMENTS).map((p) => p.id)).toContain("cash");
    for (const k of ["moto", "moto_scheduled_caba", "correo_argentino"] as const) {
      expect(availablePaymentMethods(k, DEFAULT_PAYMENTS).map((p) => p.id)).toEqual(["bank_transfer"]);
    }
  });
  it("D-02 retiro + efectivo entra En espera", () => expect(DEFAULT_PAYMENTS.cash.initialOrderStatus).toBe("on_hold"));
  it("D-03 corte 11:30, lunes a viernes, 16 a 22 hs", () => {
    expect(DEFAULT_SAMEDAY).toMatchObject({ cutoff: "11:30", operatingWeekdays: [1, 2, 3, 4, 5], windowLabel: "16 a 22 hs" });
  });
  it("D-04 2 cosmética + 1 diseñador (re-stock) = 2,5 y no califica", () => {
    const e = evaluateWholesale(
      [
        { sku: "C", quantity: 2, group: "cosmetica", retailPriceCents: 100, wholesalePriceCents: 80 },
        { sku: "D", quantity: 1, group: "disenador", retailPriceCents: 100, wholesalePriceCents: 80 },
      ],
      true,
      DEFAULT_WHOLESALE,
    );
    expect(e).toMatchObject({ points: 2.5, qualifies: false });
  });
  it("D-05 decants no suman", () => {
    expect(evaluateWholesale([{ sku: "X", quantity: 30, group: null, retailPriceCents: 100, wholesalePriceCents: 80 }], false, DEFAULT_WHOLESALE).points).toBe(0);
  });
  it("D-06 Burzaco excluido de moto", () => {
    expect(resolveMotoZone({ postcode: "1852", state: "B", city: "Burzaco" }, DEFAULT_SHIPPING).reason).toBe("excluded");
  });
  it("D-07 Horario específico CABA cuesta $12.000", async () => {
    const r = await quoteShipping({ postcode: "1414", state: "C", city: "CABA" }, [{ quantity: 1 }], DEFAULT_SHIPPING, null);
    expect(r.options.find((o) => o.kind === "moto_scheduled_caba")?.priceCents).toBe(1200000);
  });
});
