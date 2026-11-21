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
export class MiCorreoQuoter implements CorreoQuoter {
  private token: { value: string; exp: number } | null = null;

  static fromEnv(): MiCorreoQuoter | null {
    const e = env();
    if (!e.CORREO_API_BASE || !e.CORREO_API_USER || !e.CORREO_API_PASSWORD || !e.CORREO_CUSTOMER_ID || !e.CORREO_ORIGIN_POSTCODE) return null;
    return new MiCorreoQuoter();
  }

  private async auth(): Promise<string> {
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
    const dims = {
      length: Math.max(...input.packages.map((p) => p.lengthCm)),
      width: Math.max(...input.packages.map((p) => p.widthCm)),
      height: Math.min(150, input.packages.reduce((s, p) => s + p.heightCm * p.quantity, 0)),
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
      for (const r of j.rates) {
        const where = deliveredType === "D" ? "a domicilio" : "a sucursal";
        out.push({ serviceId: `${r.productType}_${deliveredType}`.toLowerCase(), label: `Correo Argentino ${r.productName.toLowerCase()} ${where}`, priceCents: toCents(r.price) });
      }
    }
    return out;
  }
}
