import type { Cents } from "./money.js";
import { normalizeText } from "./text.js";

/**
 * Envíos. Réplica parametrizable de la lógica activa en WordPress
 * (snippet #11 "Checkout efectico", funciones franzebi_zona_moto_destino / filtrar_metodos_envio_segun_pago).
 *
 * Reglas fijas (no configurables):
 *  - Retiro por el local siempre disponible, para todas las zonas, independiente del medio de pago.
 *  - Si la zona de moto es ambigua o excluida => sólo Correo Argentino + retiro.
 */

export type DeliveryKind = "local_pickup" | "moto" | "moto_scheduled_caba" | "correo_argentino";

export interface Destination {
  postcode: string;
  /** Código de provincia (C, B, ...) o nombre. */
  state: string;
  city: string;
}

export interface MotoZoneRule {
  id: string; // verde | negra | azul | roja
  label: string;
  priceCents: Cents;
  /** Zona CABA: CP 1000-1499 con provincia CABA. */
  caba?: boolean;
  /** Localidades (normalizadas) aceptadas. */
  cities?: string[];
  /** Rangos de CP numéricos válidos [desde, hasta] inclusive. */
  postcodeRanges?: Array<[number, number]>;
  sameDayEligible: boolean;
}

export interface ShippingConfig {
  motoZones: MotoZoneRule[];
  excludedCities: string[];
  excludedPostcodes: number[];
  scheduledCaba: { enabled: boolean; label: string; priceCents: Cents };
  pickup: { label: string; address?: string };
  /** Fallback interno para cotizar Correo Argentino. Nunca se muestra al cliente. */
  correoFallbackPackage: { weightKg: number; lengthCm: number; widthCm: number; heightCm: number };
}

export interface ParsedPostcode {
  prefix: string; // "" | letra CPA
  zip: number;
}

export function parsePostcode(raw: string): ParsedPostcode | null {
  const m = String(raw ?? "").replace(/\s+/g, "").toUpperCase().match(/^([A-Z])?(\d{4})/);
  if (!m) return null;
  return { prefix: m[1] ?? "", zip: Number(m[2]) };
}

const CABA_STATES = new Set(["c", "caba", "ciudad autonoma de buenos aires", "capital federal"]);
const BA_STATES = new Set(["b", "buenos aires", "provincia de buenos aires"]);

export type MotoZoneResult =
  | { zone: MotoZoneRule; reason?: undefined }
  | { zone: null; reason: "invalid_postcode" | "excluded" | "out_of_coverage" | "ambiguous" };

export function resolveMotoZone(dest: Destination, cfg: ShippingConfig): MotoZoneResult {
  const pc = parsePostcode(dest.postcode);
  if (!pc) return { zone: null, reason: "invalid_postcode" };
  const city = normalizeText(dest.city);
  const state = normalizeText(dest.state);

  if (cfg.excludedCities.includes(city) || cfg.excludedPostcodes.includes(pc.zip)) {
    return { zone: null, reason: "excluded" };
  }

  if (pc.zip >= 1000 && pc.zip <= 1499) {
    const caba = cfg.motoZones.find((z) => z.caba);
    if (caba && CABA_STATES.has(state) && (pc.prefix === "" || pc.prefix === "C")) return { zone: caba };
    // CP de CABA con provincia distinta: dato inconsistente => no ofrecer moto
    return { zone: null, reason: "ambiguous" };
  }

  if (!BA_STATES.has(state) || (pc.prefix !== "" && pc.prefix !== "B")) {
    return { zone: null, reason: "out_of_coverage" };
  }

  for (const z of cfg.motoZones) {
    if (z.caba || !z.cities?.includes(city)) continue;
    const inRange = (z.postcodeRanges ?? []).some(([a, b]) => pc.zip >= a && pc.zip <= b);
    if (inRange) return { zone: z };
    // localidad conocida pero CP incoherente
    return { zone: null, reason: "ambiguous" };
  }
  return { zone: null, reason: "out_of_coverage" };
}

export interface ShippingOption {
  id: string; // estable: "local_pickup" | "moto:verde" | "moto_scheduled_caba" | "correo:<servicio>"
  kind: DeliveryKind;
  label: string;
  priceCents: Cents;
  motoZoneId?: string;
  sameDayEligible?: boolean;
}

export interface CorreoQuote {
  serviceId: string; // p.ej. "expreso_domicilio"
  label: string;
  priceCents: Cents;
}

/** Puerto para cotizar Correo Argentino (implementado por el backend con credenciales propias). */
export interface CorreoQuoter {
  quote(input: {
    destination: Destination;
    packages: Array<{ weightKg: number; lengthCm: number; widthCm: number; heightCm: number; quantity: number }>;
  }): Promise<CorreoQuote[]>;
}

export interface CartPhysicalLine {
  quantity: number;
  weightKg?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
}

/** Aplica el fallback interno 1 kg / 20x15x10 cuando el producto no tiene datos (igual que snippet #8). */
export function packagesForCorreo(lines: CartPhysicalLine[], cfg: ShippingConfig) {
  const f = cfg.correoFallbackPackage;
  const pos = (v: number | null | undefined, d: number) => (v && v > 0 ? v : d);
  return lines.map((l) => ({
    quantity: l.quantity,
    weightKg: pos(l.weightKg, f.weightKg),
    lengthCm: pos(l.lengthCm, f.lengthCm),
    widthCm: pos(l.widthCm, f.widthCm),
    heightCm: pos(l.heightCm, f.heightCm),
  }));
}

export interface ShippingQuoteResult {
  options: ShippingOption[];
  motoUnavailableReason?: string;
  correoError?: string;
}

export async function quoteShipping(
  dest: Destination,
  lines: CartPhysicalLine[],
  cfg: ShippingConfig,
  correo: CorreoQuoter | null,
): Promise<ShippingQuoteResult> {
  const options: ShippingOption[] = [
    { id: "local_pickup", kind: "local_pickup", label: cfg.pickup.label, priceCents: 0 },
  ];
  const moto = resolveMotoZone(dest, cfg);
  let motoUnavailableReason: string | undefined;
  if (moto.zone) {
    options.push({
      id: `moto:${moto.zone.id}`,
      kind: "moto",
      label: moto.zone.label,
      priceCents: moto.zone.priceCents,
      motoZoneId: moto.zone.id,
      sameDayEligible: moto.zone.sameDayEligible,
    });
    if (moto.zone.caba && cfg.scheduledCaba.enabled) {
      options.push({
        id: "moto_scheduled_caba",
        kind: "moto_scheduled_caba",
        label: cfg.scheduledCaba.label,
        priceCents: cfg.scheduledCaba.priceCents,
        motoZoneId: moto.zone.id,
      });
    }
  } else {
    motoUnavailableReason = moto.reason;
  }

  let correoError: string | undefined;
  if (correo && parsePostcode(dest.postcode)) {
    try {
      const quotes = await correo.quote({ destination: dest, packages: packagesForCorreo(lines, cfg) });
      for (const q of quotes) {
        if (!Number.isInteger(q.priceCents) || q.priceCents <= 0) continue; // guard igual a snippet #43
        options.push({ id: `correo:${q.serviceId}`, kind: "correo_argentino", label: q.label, priceCents: q.priceCents });
      }
    } catch (e) {
      correoError = e instanceof Error ? e.message : String(e);
    }
  }
  // Mismo orden que el checkout de WooCommerce: Correo Argentino, retiro por el local, moto, horario específico
  const rank = (k: ShippingOption["kind"]) => ({ correo_argentino: 0, local_pickup: 1, moto: 2, moto_scheduled_caba: 3 })[k];
  options.sort((a, b) => rank(a.kind) - rank(b.kind));
  return { options, motoUnavailableReason, correoError };
}
