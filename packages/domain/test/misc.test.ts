import { describe, expect, it } from "vitest";
import { DEFAULT_SAMEDAY, estimateMotoDelivery, rewriteSearchQuery, validateImage, whatsappInquiryUrl } from "../src/index.js";

const BRANDS = ["Lattafa", "Afnan", "Armaf", "Al Haramain", "Maison Alhambra", "Carolina Herrera", "Jo Milano", "Rasasi"];

describe("búsqueda tolerante", () => {
  it("lattfa => lattafa (alias)", () => expect(rewriteSearchQuery("lattfa", BRANDS).rewritten).toBe("lattafa"));
  it("tildes y mayúsculas", () => expect(rewriteSearchQuery("LÁTTAFA Asad", BRANDS).rewritten).toBe("lattafa asad"));
  it("typo por distancia de edición", () => expect(rewriteSearchQuery("armfa odyssey", BRANDS).rewritten).toBe("armaf odyssey"));
  it("transposición", () => expect(rewriteSearchQuery("rasais hawas", BRANDS).rewritten).toBe("rasasi hawas"));
  it("no 'corrige' palabras cortas", () => expect(rewriteSearchQuery("edp 100", BRANDS).rewritten).toBe("edp 100"));
});

describe("same day (America/Argentina/Buenos_Aires)", () => {
  // 14:29Z = 11:29 ART ; 14:31Z = 11:31 ART (corte 11:30). 2026-11-23 es lunes.
  it("pago 11:29 => hoy 16 a 22", () => expect(estimateMotoDelivery(new Date("2026-11-23T14:29:00Z"), true, DEFAULT_SAMEDAY).sameDay).toBe(true));
  it("pago 11:31 => próximo día", () => expect(estimateMotoDelivery(new Date("2026-11-23T14:31:00Z"), true, DEFAULT_SAMEDAY).sameDay).toBe(false));
  it("zona no elegible", () => expect(estimateMotoDelivery(new Date("2026-11-23T12:00:00Z"), false, DEFAULT_SAMEDAY).sameDay).toBe(false));
  it("domingo no", () => expect(estimateMotoDelivery(new Date("2026-11-22T12:00:00Z"), true, DEFAULT_SAMEDAY).sameDay).toBe(false));
});

describe("WhatsApp a pedido", () => {
  it("incluye nombre y SKU", () => {
    const url = whatsappInquiryUrl({ name: "YSL Mon Paris EDP 90ML", sku: "PER_DIS_F_YSL_MON_PARIS_EDP_90ML" });
    expect(url.startsWith("https://wa.me/5491128720954?text=")).toBe(true);
    const text = decodeURIComponent(url.split("text=")[1]!);
    expect(text).toContain("YSL Mon Paris EDP 90ML");
    expect(text).toContain("SKU: PER_DIS_F_YSL_MON_PARIS_EDP_90ML");
  });
});

function png(w: number, h: number) {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}
function jpeg(w: number, h: number) {
  // SOI, APP0 (len 16), SOF0
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0)];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, ...new Array(9).fill(0)];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof]);
}

describe("validación de imágenes", () => {
  it("PNG válido", () => expect(validateImage(png(800, 800), "image/png")).toMatchObject({ ok: true, format: "png", width: 800 }));
  it("JPEG válido (image/jpg tolerado)", () => expect(validateImage(jpeg(1000, 1200), "image/jpg")).toMatchObject({ ok: true, width: 1000, height: 1200 }));
  it("HTML disfrazado de .jpg (caso RIFFS) => unsupported_format", () => {
    const html = new TextEncoder().encode("<!DOCTYPE html><html>403 Forbidden</html>");
    expect(validateImage(html, "image/jpeg")).toMatchObject({ ok: false, code: "unsupported_format" });
  });
  it("MIME declarado distinto", () => expect(validateImage(png(800, 800), "image/jpeg")).toMatchObject({ ok: false, code: "mime_mismatch" }));
  it("muy chica", () => expect(validateImage(png(50, 50))).toMatchObject({ ok: false, code: "too_small" }));
  it("truncada", () => expect(validateImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toMatchObject({ ok: false, code: "corrupt" }));
  it("vacía", () => expect(validateImage(new Uint8Array())).toMatchObject({ ok: false, code: "empty" }));
});
