import { describe, expect, it } from "vitest";
import { decodeEntities, mapWooToAlegra } from "../src/index.js";

const A = (sku: string, name = sku) => ({ sku, name });

describe("mapeo SKU Woo → Alegra (casos reales 2026-11-21)", () => {
  it("decodifica entidades HTML de Woo", () => {
    expect(decodeEntities("PER_DIS_F_VIKTOR&amp;ROLF_FLOWERBOMB")).toBe("PER_DIS_F_VIKTOR&ROLF_FLOWERBOMB");
    expect(decodeEntities("PER_ARB_M_LAT_BADE&#8217;E_AL_OUD")).toBe("PER_ARB_M_LAT_BADE’E_AL_OUD");
  });

  it("reglas: exacto, entidades, sufijo _ARB/_DIS, comodín ? y nombre", () => {
    const alegra = [
      A("PER_ARB_M_LAT_ASAD_100ML"),
      A("PER_DIS_F_VIKTOR&ROLF_FLOWERBOMB_EDP_100ML"),
      A("PER_ARB_M_LAT_BADE'E_AL_OUD_SUBLIME_100ML"),
      A("PER_DEC_M_MAI_TERRA_10ML_ARB"),
      A("PER_DEC_F_YSL_LIBRE_EDP_10ML_DIS"),
      A("PER_DIS_F_DIOR_J'ADORE_EDP_100ML"),
      A("X_NUEVO", "DECANT LATTAFA QIMMAH 5ML"),
    ];
    const woo = [
      { sku: "PER_ARB_M_LAT_ASAD_100ML", name: "Asad" },
      { sku: "PER_DIS_F_VIKTOR&amp;ROLF_FLOWERBOMB_EDP_100ML", name: "Flowerbomb" },
      { sku: "PER_ARB_M_LAT_BADE&#8217;E_AL_OUD_SUBLIME_100ML", name: "Bade'e" },
      { sku: "PER_DEC_M_MAI_TERRA_10ML", name: "Terra" },
      { sku: "PER_DEC_F_YSL_LIBRE_EDP_10ML", name: "DEACNT YSL LIBRE EDP 10ML" },
      { sku: "PER_DIS_F_DIOR_J?ADORE_EDP_100ML", name: "J'adore" },
      { sku: "637", name: "DECANT LATTAFA QIMMAH 5ML" },
      { sku: "534", name: "ENVIO" },
    ];
    const r = mapWooToAlegra(woo, alegra);
    expect(r.map((m) => [m.woo.sku, m.rule, m.alegra?.sku ?? null])).toEqual([
      ["PER_ARB_M_LAT_ASAD_100ML", "exact", "PER_ARB_M_LAT_ASAD_100ML"],
      ["PER_DIS_F_VIKTOR&amp;ROLF_FLOWERBOMB_EDP_100ML", "entities", "PER_DIS_F_VIKTOR&ROLF_FLOWERBOMB_EDP_100ML"],
      ["PER_ARB_M_LAT_BADE&#8217;E_AL_OUD_SUBLIME_100ML", "entities", "PER_ARB_M_LAT_BADE'E_AL_OUD_SUBLIME_100ML"],
      ["PER_DEC_M_MAI_TERRA_10ML", "suffix", "PER_DEC_M_MAI_TERRA_10ML_ARB"],
      ["PER_DEC_F_YSL_LIBRE_EDP_10ML", "suffix", "PER_DEC_F_YSL_LIBRE_EDP_10ML_DIS"],
      ["PER_DIS_F_DIOR_J?ADORE_EDP_100ML", "wildcard", "PER_DIS_F_DIOR_J'ADORE_EDP_100ML"],
      ["637", "name", "X_NUEVO"],
      ["534", "unmatched", null],
    ]);
  });

  it("no adivina: dos candidatos => ambiguous", () => {
    const r = mapWooToAlegra([{ sku: "OLD", name: "DECANT X 5ML" }], [A("A1", "DECANT X 5ML"), A("A2", "DECANT X 5ML")]);
    expect(r[0]).toMatchObject({ rule: "ambiguous", alegra: null });
  });

  it("un SKU de Alegra no se asigna a dos fichas de Woo (duplicados 637 vs SKU Alegra)", () => {
    const alegra = [A("PER_DEC_M_LAT_QIMMAH_5ML_ARB", "DECANT LATTAFA QIMMAH 5ML")];
    const r = mapWooToAlegra(
      [{ sku: "PER_DEC_M_LAT_QIMMAH_5ML", name: "DECANT LATTAFA QIMMAH 5ML" }, { sku: "637", name: "DECANT LATTAFA QIMMAH 5ML" }],
      alegra,
    );
    expect(r[0]!.rule).toBe("suffix");
    expect(r[1]!.rule).toBe("unmatched");
  });

  it("la ficha huérfana no le roba el match por nombre a la ficha correcta aunque venga primero", () => {
    const alegra = [A("PER_DEC_M_LAT_QIMMAH_5ML_ARB", "DECANT LATTAFA QIMMAH 5ML")];
    const r = mapWooToAlegra(
      [{ sku: "637", name: "DECANT LATTAFA QIMMAH 5ML" }, { sku: "PER_DEC_M_LAT_QIMMAH_5ML", name: "DECANT LATTAFA QIMMAH 5ML" }],
      alegra,
    );
    expect(r.map((m) => m.rule)).toEqual(["unmatched", "suffix"]);
  });
});
