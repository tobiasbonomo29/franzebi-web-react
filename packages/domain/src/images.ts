/**
 * Validación de imágenes ANTES de procesarlas/publicarlas (caso real: RIFFS FREEZE 100ML falló con
 * woocommerce_product_image_upload_error). Se valida por "magic bytes", no por extensión ni Content-Type.
 */
export type ImageFormat = "jpeg" | "png" | "webp";

export interface ImageLimits {
  maxBytes: number;
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
}

export const DEFAULT_IMAGE_LIMITS: ImageLimits = {
  maxBytes: 8 * 1024 * 1024,
  minWidth: 200,
  minHeight: 200,
  maxWidth: 6000,
  maxHeight: 6000,
};

export type ImageValidation =
  | { ok: true; format: ImageFormat; mime: string; width: number; height: number; bytes: number }
  | { ok: false; code: "empty" | "too_large" | "unsupported_format" | "corrupt" | "too_small" | "too_big_dimensions" | "mime_mismatch"; message: string };

export function sniffFormat(b: Uint8Array): ImageFormat | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  return null;
}

function ascii(b: Uint8Array, s: number, e: number) {
  return String.fromCharCode(...b.subarray(s, e));
}
const u16be = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const u32be = (b: Uint8Array, o: number) => ((b[o]! << 24) >>> 0) + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]!;
const u16le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u24le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);

export function readDimensions(b: Uint8Array, f: ImageFormat): { width: number; height: number } | null {
  try {
    if (f === "png") {
      if (ascii(b, 12, 16) !== "IHDR") return null;
      return { width: u32be(b, 16), height: u32be(b, 20) };
    }
    if (f === "jpeg") {
      let o = 2;
      while (o + 9 < b.length) {
        if (b[o] !== 0xff) return null;
        const marker = b[o + 1]!;
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { o += 2; continue; }
        const len = u16be(b, o + 2);
        const isSOF = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
        if (isSOF) return { height: u16be(b, o + 5), width: u16be(b, o + 7) };
        o += 2 + len;
      }
      return null;
    }
    // webp
    const chunk = ascii(b, 12, 16);
    if (chunk === "VP8X") return { width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
    if (chunk === "VP8 ") return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
    if (chunk === "VP8L") {
      const b0 = b[21]!, b1 = b[22]!, b2 = b[23]!, b3 = b[24]!;
      return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
    }
    return null;
  } catch {
    return null;
  }
}

const MIME: Record<ImageFormat, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

export function validateImage(bytes: Uint8Array, declaredMime?: string | null, limits: ImageLimits = DEFAULT_IMAGE_LIMITS): ImageValidation {
  if (!bytes.length) return { ok: false, code: "empty", message: "Archivo vacío" };
  if (bytes.length > limits.maxBytes) return { ok: false, code: "too_large", message: `Pesa ${(bytes.length / 1048576).toFixed(1)} MB (máx ${(limits.maxBytes / 1048576).toFixed(0)} MB)` };
  const format = sniffFormat(bytes);
  if (!format) return { ok: false, code: "unsupported_format", message: "Formato no soportado: se aceptan JPG, PNG y WebP" };
  const mime = MIME[format];
  if (declaredMime && !/octet-stream/.test(declaredMime) && declaredMime.split(";")[0]!.trim().toLowerCase() !== mime && !(format === "jpeg" && /image\/jpg/i.test(declaredMime))) {
    return { ok: false, code: "mime_mismatch", message: `El servidor declara ${declaredMime} pero el archivo es ${mime}` };
  }
  const dim = readDimensions(bytes, format);
  if (!dim || !dim.width || !dim.height) return { ok: false, code: "corrupt", message: "No se pudieron leer las dimensiones (archivo dañado o truncado)" };
  if (dim.width < limits.minWidth || dim.height < limits.minHeight) return { ok: false, code: "too_small", message: `${dim.width}x${dim.height} px es menor al mínimo ${limits.minWidth}x${limits.minHeight}` };
  if (dim.width > limits.maxWidth || dim.height > limits.maxHeight) return { ok: false, code: "too_big_dimensions", message: `${dim.width}x${dim.height} px supera el máximo ${limits.maxWidth}x${limits.maxHeight}` };
  return { ok: true, format, mime, ...dim, bytes: bytes.length };
}
