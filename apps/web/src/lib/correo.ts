import "server-only";
import type { CorreoQuote, CorreoQuoter, Destination } from "@franzebi/domain";
import { toCents } from "@franzebi/domain";
import { env } from "./env";

/**
 * Cotizador Correo Argentino (API MiCorreo). Debe CONSERVAR la lógica del plugin actual
 * "correoargentino-shipping 3.0.3rc" (4 servicios: clásico/expreso × domicilio/sucursal).
 * Los nombres de campos se validan contra la API real en staging (docs/04, Fase 4) antes del cutover.
 * Peso/dimensiones de fallback (1 kg, 20x15x10) vienen del dominio y nunca se muestran al cliente.
 */
/** Etiqueta idéntica a la del plugin de WP: "Correo Argentino clásico a domicilio" (la API trae "Correo Argentino Clasico"). */
export function correoLabel(productName: string, productType: string, deliveredType: "D" | "S") {
  const n = productName.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const service = /expres/.test(n) || /^ep$/i.test(productType) ? "expreso" : "clásico";
  return `Correo Argentino ${service} ${deliveredType === "D" ? "a domicilio" : "a sucursal"}`;
}

export class MiCorreoQuoter implements CorreoQuoter {
  private token: { value: string; exp: number } | null = null;

  static fromEnv(): MiCorreoQuoter | null {
    const e = env();
    if (!e.CORREO_API_BASE || !e.CORREO_API_USER || !e.CORREO_API_PASSWORD || !e.CORREO_CUSTOMER_ID || !e.CORREO_ORIGIN_POSTCODE) return null;
    return new MiCorreoQuoter();
  }

  protected async auth(): Promise<string> {
    if (this.token && this.token.exp > Date.now() + 60_000) return this.token.value;
    const e = env();
    const res = await fetch(`${e.CORREO_API_BASE}/token`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${e.CORREO_API_USER}:${e.CORREO_API_PASSWORD}`).toString("base64") },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Correo Argentino auth HTTP ${res.status}`);
    const j = (await res.json()) as { token: string; expire?: string };
    this.token = { value: j.token, exp: j.expire ? Date.parse(j.expire) : Date.now() + 30 * 60_000 };
    return j.token;
  }

  async quote(input: { destination: Destination; packages: Array<{ weightKg: number; lengthCm: number; widthCm: number; heightCm: number; quantity: number }> }): Promise<CorreoQuote[]> {
    const e = env();
    // Bulto consolidado: suma de pesos, mayor largo/ancho, alto apilado (misma estrategia "un paquete" del plugin)
    const weightG = Math.round(input.packages.reduce((s, p) => s + p.weightKg * p.quantity, 0) * 1000);
    // La API exige enteros (gramos y cm)
    const dims = {
      length: Math.ceil(Math.max(...input.packages.map((p) => p.lengthCm))),
      width: Math.ceil(Math.max(...input.packages.map((p) => p.widthCm))),
      height: Math.ceil(Math.min(150, input.packages.reduce((s, p) => s + p.heightCm * p.quantity, 0))),
    };
    const token = await this.auth();
    const out: CorreoQuote[] = [];
    for (const deliveredType of ["D", "S"] as const) {
      const res = await fetch(`${e.CORREO_API_BASE}/rates`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: e.CORREO_CUSTOMER_ID,
          postalCodeOrigin: e.CORREO_ORIGIN_POSTCODE,
          postalCodeDestination: input.destination.postcode.replace(/\D/g, "").slice(0, 4),
          deliveredType,
          dimensions: { weight: weightG, ...dims },
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`Correo Argentino rates HTTP ${res.status}`);
      const j = (await res.json()) as { rates?: Array<{ productType: string; productName: string; price: number; deliveryTimeMin?: string; deliveryTimeMax?: string }> };
      if (!Array.isArray(j.rates)) continue; // mismo guard que snippet #43
      for (const r of j.rates) out.push({ serviceId: `${r.productType}_${deliveredType}`.toLowerCase(), label: correoLabel(r.productName, r.productType, deliveredType), priceCents: toCents(r.price) });
    }
    // Mismo orden que el plugin en WP: expreso domicilio, clásico domicilio, expreso sucursal, clásico sucursal
    const rank = (q: CorreoQuote) => (q.serviceId.endsWith("_d") ? 0 : 2) + (/expreso/i.test(q.label) ? 0 : 1);
    return out.sort((a, b) => rank(a) - rank(b));
  }
}

// ---------------------------------------------------------------------------
// Sucursales y registro de envíos (equivalente a "Importar" en Órdenes de Correo Argentino del plugin).
// Campos según la documentación pública de la API MiCorreo; validar con credenciales reales en staging (docs/04).
// ---------------------------------------------------------------------------
export interface CorreoAgency { code: string; name: string; address: string; city: string; postcode: string }

const PROVINCE_CODES = new Set(["C", "B", "K", "H", "U", "X", "W", "E", "P", "Y", "L", "F", "M", "N", "Q", "R", "A", "J", "D", "Z", "S", "G", "V", "T"]);

export class MiCorreoClient extends MiCorreoQuoter {
  static fromEnvClient(): MiCorreoClient | null {
    return MiCorreoQuoter.fromEnv() ? new MiCorreoClient() : null;
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const e = env();
    const token = await this.auth();
    const res = await fetch(`${e.CORREO_API_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Correo Argentino ${path.split("?")[0]} HTTP ${res.status}: ${text.slice(0, 200)}`);
    return (text ? JSON.parse(text) : null) as T;
  }

  /** Sucursales habilitadas para retiro en la provincia (para envíos "a sucursal"). */
  async agencies(provinceCode: string): Promise<CorreoAgency[]> {
    if (!PROVINCE_CODES.has(provinceCode)) return [];
    const e = env();
    const list = await this.req<Array<{ code: string; name: string; status?: string; services?: { pickupAvailability?: boolean }; location?: { address?: { streetName?: string; streetNumber?: string; city?: string; postalCode?: string } } }>>(
      "GET",
      `/agencies?customerId=${encodeURIComponent(e.CORREO_CUSTOMER_ID!)}&provinceCode=${provinceCode}`,
    );
    return (list ?? [])
      .filter((a) => a.status !== "INACTIVE" && a.services?.pickupAvailability !== false)
      .map((a) => ({
        code: a.code,
        name: a.name,
        address: [a.location?.address?.streetName, a.location?.address?.streetNumber].filter(Boolean).join(" "),
        city: a.location?.address?.city ?? "",
        postcode: a.location?.address?.postalCode ?? "",
      }))
      .sort((x, y) => x.city.localeCompare(y.city, "es") || x.name.localeCompare(y.name, "es"));
  }

  /** Registra el envío en MiCorreo (POST /shipping/import). */
  async importShipment(o: {
    number: number;
    recipient: { name: string; email: string; phone: string };
    deliveryType: "D" | "S";
    agencyCode?: string | null;
    address: { street: string; city: string; provinceCode: string; postcode: string; apartment?: string };
    productType: "CP" | "EP";
    weightG: number;
    dims: { length: number; width: number; height: number };
    declaredValue: number;
    sender: { name: string; email: string; phone: string; street: string; number: string; city: string; provinceCode: string; postcode: string };
  }) {
    const e = env();
    return this.req<{ createdAt?: string; trackingNumber?: string }>("POST", "/shipping/import", {
      customerId: e.CORREO_CUSTOMER_ID,
      extOrderId: String(o.number),
      orderNumber: String(o.number),
      sender: {
        name: o.sender.name, phone: o.sender.phone, cellPhone: o.sender.phone, email: o.sender.email,
        originAddress: { streetName: o.sender.street, streetNumber: o.sender.number, floor: "", apartment: "", city: o.sender.city, provinceCode: o.sender.provinceCode, postalCode: o.sender.postcode },
      },
      recipient: { name: o.recipient.name, phone: o.recipient.phone, cellPhone: o.recipient.phone, email: o.recipient.email },
      shipping: {
        deliveryType: o.deliveryType,
        productType: o.productType,
        agency: o.deliveryType === "S" ? o.agencyCode : null,
        address: { streetName: o.address.street, streetNumber: "", floor: "", apartment: o.address.apartment ?? "", city: o.address.city, provinceCode: o.address.provinceCode, postalCode: o.address.postcode },
        weight: Math.max(1, Math.round(o.weightG)),
        declaredValue: Math.round(o.declaredValue),
        height: Math.ceil(o.dims.height), length: Math.ceil(o.dims.length), width: Math.ceil(o.dims.width),
      },
    });
  }

  /** Estado de un envío por número de seguimiento. */
  async tracking(trackingNumber: string) {
    return this.req<unknown>("GET", `/shipping/tracking?shippingId=${encodeURIComponent(trackingNumber)}`);
  }
}

/** Remitente (datos del plugin de WP, sección "Datos del negocio"). Configurable por settings.correo_sender. */
export const DEFAULT_CORREO_SENDER = {
  name: "Franzebi Imports", email: "franzebi.imports@gmail.com", phone: "1121829631",
  street: "Combatientes de Malvinas", number: "3411", city: "Ciudad Autónoma de Buenos Aires", provinceCode: "C", postcode: "1431",
};
