import { describe, expect, it } from "vitest";
import { AlegraSource } from "../src/index.js";

const fakeFetch = (routes: Record<string, unknown>): typeof fetch =>
  (async (url: string | URL) => {
    const path = String(url).replace("https://api.alegra.com/api/v1", "").split("?")[0]!;
    const body = routes[path];
    return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404 });
  }) as typeof fetch;

describe("adaptador Alegra", () => {
  const routes = {
    "/price-lists": [
      { id: "1", name: "General", currency: { code: "ARS" } },
      { id: "u1", name: "MAYORISTA", currency: { code: "USD" } }, // ignorada
      { id: "m1", name: "Mayorista", currency: { code: "ARS" } },
    ],
    "/items": [
      { id: 10, name: "LATTAFA ASAD 100ML", reference: " PER_ARB_M_LAT_ASAD_100ML ", status: "active", inventory: { availableQuantity: 4 },
        price: [{ idPriceList: "1", price: 45000 }, { idPriceList: "u1", price: 30, currency: "USD" }, { idPriceList: "m1", price: "38000.5" }] },
      { id: 11, name: "SIN SKU", reference: "", price: [] },
      { id: 12, name: "SIN MAYORISTA", reference: "X1", price: [{ idPriceList: "1", price: 1000 }], inventory: { availableQuantity: -2 } },
    ],
  };
  it("normaliza SKU, toma MAYORISTA en ARS, ignora USD, rechaza sin SKU", async () => {
    const src = new AlegraSource({ email: "e", token: "t", retailPriceListName: "General", wholesalePriceListName: "MAYORISTA", fetchImpl: fakeFetch(routes) });
    const page = await src.fetchPage(null);
    expect(page.records[0]).toMatchObject({ sku: "PER_ARB_M_LAT_ASAD_100ML", retailPriceCents: 4500000, wholesalePriceCents: 3800050, stock: 4 });
    expect(page.records[1]).toMatchObject({ sku: "X1", wholesalePriceCents: null, stock: 0 });
    expect(page.rejects).toEqual([expect.objectContaining({ code: "missing_sku" })]);
    expect(page.next).toBeNull();
  });
  it("formato real de Alegra (2026-11-21): id de lista en price[].id y lista 'usd' con moneda ARS ignorada", async () => {
    const real = {
      "/price-lists": [
        { id: "0198cc87", name: "ARABES MINORISTA (pesos)", status: "active", currency: { code: "ARS" }, main: true },
        { id: "0198ebe4", name: "ARABES MAYORISTA usd", status: "active", currency: { code: "ARS" } },
        { id: "019d6e7c", name: "MAYORISTA", status: "active", currency: { code: "ARS" } },
      ],
      "/items": [
        { id: "1886", name: "LATTAFA KHAMRAH 100ML", reference: "PER_ARB_M_LAT_KHAMRAH_100ML", status: "active",
          price: [{ id: "0198cc87", name: "ARABES MINORISTA (pesos)", price: 52000 }, { id: "0198ebe4", name: "ARABES MAYORISTA usd", price: 30 }, { id: "019d6e7c", name: "MAYORISTA", price: 46000 }],
          inventory: { availableQuantity: 7 }, itemCategory: { name: "PERFUMERIA" } },
      ],
    };
    const src = new AlegraSource({ email: "e", token: "t", retailPriceListName: "ARABES MINORISTA (pesos)", wholesalePriceListName: "MAYORISTA", fetchImpl: fakeFetch(real), minIntervalMs: 0 });
    const page = await src.fetchPage(null);
    expect(page.records[0]).toMatchObject({ retailPriceCents: 5200000, wholesalePriceCents: 4600000, stock: 7, imageUrls: [] });
    const srcUsd = new AlegraSource({ email: "e", token: "t", retailPriceListName: "ARABES MAYORISTA usd", wholesalePriceListName: "MAYORISTA", fetchImpl: fakeFetch(real), minIntervalMs: 0 });
    await expect(srcUsd.fetchPage(null)).rejects.toThrow(/No existe lista ARS/);
  });

  it("exige credenciales por entorno", () => {
    expect(() => new AlegraSource({ email: "", token: "", retailPriceListName: "General", wholesalePriceListName: "MAYORISTA" })).toThrow(/ALEGRA_API/);
  });
});
