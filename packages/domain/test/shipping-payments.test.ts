import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAYMENTS as PAY,
  DEFAULT_SHIPPING as SHIP,
  availablePaymentMethods,
  cashDiscount,
  initialOrderStatus,
  packagesForCorreo,
  quoteShipping,
  resolveMotoZone,
  resolvePaymentSelection,
  type CorreoQuoter,
  type PaymentsConfig,
} from "../src/index.js";

const zone = (postcode: string, state: string, city: string) => resolveMotoZone({ postcode, state, city }, SHIP);

describe("zonas de moto", () => {
  it("CABA => verde $4.000", () => {
    const r = zone("C1414", "C", "CABA");
    expect(r.zone?.id).toBe("verde");
    expect(r.zone?.priceCents).toBe(400000);
  });
  it("primer cordón => negra $6.000", () => expect(zone("1636", "B", "Olivos").zone?.priceCents).toBe(600000));
  it("zona azul => $8.000", () => expect(zone("1629", "Buenos Aires", "Pilar").zone?.priceCents).toBe(800000));
  it("zona roja => $9.500 (La Plata)", () => expect(zone("1900", "B", "La Plata").zone?.priceCents).toBe(950000));
  it.each([
    ["1748", "General Rodríguez"],
    ["1865", "San Vicente"],
    ["1814", "Cañuelas"],
    ["1723", "Mariano Acosta"],
    ["1727", "Marcos Paz"],
  ])("excluidos: %s %s", (cp, city) => expect(zone(cp, "B", city).zone).toBeNull());
  it("excluye por CP aunque la localidad esté mal escrita", () => expect(zone("1748", "B", "Gral Rodriguez").reason).toBe("excluded"));
  it("CP de CABA con provincia BA es ambiguo => sin moto", () => expect(zone("1414", "B", "Palermo").reason).toBe("ambiguous"));
  it("localidad conocida con CP incoherente => ambiguo", () => expect(zone("5000", "B", "Olivos").reason).toBe("ambiguous"));
  it("otra provincia => fuera de cobertura", () => expect(zone("5000", "X", "Córdoba").reason).toBe("out_of_coverage"));
  it("CP inválido", () => expect(zone("abc", "C", "CABA").reason).toBe("invalid_postcode"));
});

describe("cotización de envíos", () => {
  const correo: CorreoQuoter = {
    quote: async () => [
      { serviceId: "clasico_domicilio", label: "Correo Argentino clásico a domicilio", priceCents: 750000 },
      { serviceId: "roto", label: "respuesta inválida", priceCents: 0 },
    ],
  };
  it("retiro siempre disponible, también en zonas excluidas", async () => {
    const r = await quoteShipping({ postcode: "1748", state: "B", city: "General Rodriguez" }, [{ quantity: 1 }], SHIP, correo);
    expect(r.options.map((o) => o.kind)).toEqual(["local_pickup", "correo_argentino"]);
  });
  it("CABA: retiro + moto + horario + correo", async () => {
    const r = await quoteShipping({ postcode: "1414", state: "C", city: "CABA" }, [{ quantity: 1 }], SHIP, correo);
    expect(r.options.map((o) => o.id)).toEqual(["local_pickup", "moto:verde", "moto_scheduled_caba", "correo:clasico_domicilio"]);
  });
  it("si Correo falla, no rompe el checkout", async () => {
    const r = await quoteShipping({ postcode: "1414", state: "C", city: "CABA" }, [{ quantity: 1 }], SHIP, { quote: async () => { throw new Error("timeout"); } });
    expect(r.correoError).toBe("timeout");
    expect(r.options.length).toBeGreaterThan(0);
  });
  it("fallback 1kg 20x15x10 sólo cuando falta el dato", () => {
    expect(packagesForCorreo([{ quantity: 2 }, { quantity: 1, weightKg: 0.3, lengthCm: 10, widthCm: 10, heightCm: 10 }], SHIP)).toEqual([
      { quantity: 2, weightKg: 1, lengthCm: 20, widthCm: 15, heightCm: 10 },
      { quantity: 1, weightKg: 0.3, lengthCm: 10, widthCm: 10, heightCm: 10 },
    ]);
  });
});

describe("medios de pago", () => {
  const ids = (k: Parameters<typeof availablePaymentMethods>[0], cfg: PaymentsConfig = PAY) => availablePaymentMethods(k, cfg).map((o) => o.id);
  it("efectivo en retiro", () => expect(ids("local_pickup")).toEqual(["bank_transfer", "cash"]));
  it("efectivo NUNCA en Correo, aun si se configura mal", () => {
    const bad = { ...PAY, cash: { ...PAY.cash, allowedDeliveryKinds: ["local_pickup", "moto", "moto_scheduled_caba", "correo_argentino"] } } as unknown as PaymentsConfig;
    expect(ids("correo_argentino", bad)).toEqual(["bank_transfer"]);
  });
  it("config del brief: retiro + moto + horario CABA", () => {
    const brief = { ...PAY, cash: { ...PAY.cash, allowedDeliveryKinds: ["local_pickup", "moto", "moto_scheduled_caba"] as const } } as PaymentsConfig;
    expect(ids("moto", brief)).toContain("cash");
    expect(ids("moto_scheduled_caba", brief)).toContain("cash");
  });
  it("sin entrega elegida no se ofrece efectivo", () => expect(ids(null)).toEqual(["bank_transfer"]));
  it("cambiar a Correo con efectivo elegido => transferencia con aviso, determinístico", () => {
    const r1 = resolvePaymentSelection("cash", "correo_argentino", PAY);
    const r2 = resolvePaymentSelection(r1.method, "correo_argentino", PAY);
    expect(r1).toMatchObject({ method: "bank_transfer", changed: true });
    expect(r1.notice).toMatch(/efectivo/);
    expect(r2).toMatchObject({ method: "bank_transfer", changed: false });
  });
  it("descuento 5% en centavos, nunca negativo", () => {
    expect(cashDiscount(1000000, PAY)).toBe(50000);
    expect(cashDiscount(333, PAY)).toBe(17);
    expect(cashDiscount(0, PAY)).toBe(0);
  });
  it("transferencia => En espera", () => expect(initialOrderStatus("bank_transfer", PAY)).toBe("on_hold"));
});
