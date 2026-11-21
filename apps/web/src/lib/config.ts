import "server-only";
import {
  DEFAULT_PAYMENTS,
  DEFAULT_SAMEDAY,
  DEFAULT_SHIPPING,
  DEFAULT_WHOLESALE,
  type PaymentsConfig,
  type SameDayConfig,
  type ShippingConfig,
  type WholesaleRules,
} from "@franzebi/domain";
import { adminClient } from "./supabase";

/** Carga la configuración comercial vigente desde la base (settings / shipping_zones / wholesale_rules). */
export interface CommerceConfig {
  payments: PaymentsConfig;
  shipping: ShippingConfig;
  sameday: SameDayConfig;
  wholesale: WholesaleRules & { version: number };
  catalog: { hideDesignerPrices: boolean; placeholderOnImageError: boolean; menu: Array<{ label: string; href: string }> };
}

let cache: { at: number; value: CommerceConfig } | null = null;
const TTL_MS = 60_000;

export async function loadCommerceConfig(): Promise<CommerceConfig> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const db = adminClient();
  const [settings, zones, rules] = await Promise.all([
    db.from("settings").select("key, value"),
    db.from("shipping_zones").select("*").eq("active", true).order("sort"),
    db.from("wholesale_rules").select("*").eq("active", true).maybeSingle(),
  ]);
  if (settings.error || zones.error || rules.error) throw new Error("No se pudo cargar la configuración comercial");
  const s = Object.fromEntries((settings.data ?? []).map((r) => [r.key, r.value]));
  const ship = (s.shipping ?? {}) as Partial<ShippingConfig>;
  const value: CommerceConfig = {
    payments: { ...DEFAULT_PAYMENTS, ...(s.payments ?? {}), mercadopago: { enabled: false }, card: { enabled: false } },
    sameday: { ...DEFAULT_SAMEDAY, ...(s.sameday ?? {}) },
    shipping: {
      ...DEFAULT_SHIPPING,
      ...ship,
      motoZones: (zones.data ?? []).map((z) => ({
        id: z.id,
        label: z.label,
        priceCents: Number(z.price_cents),
        caba: z.is_caba,
        cities: z.cities,
        postcodeRanges: (z.postcode_ranges as string[]).map(parseRange),
        sameDayEligible: z.same_day_eligible,
      })),
    },
    wholesale: rules.data
      ? {
          enabled: true,
          version: rules.data.version,
          firstPurchaseThreshold: Number(rules.data.first_purchase_threshold),
          restockThreshold: Number(rules.data.restock_threshold),
          groups: rules.data.groups,
        }
      : { ...DEFAULT_WHOLESALE, enabled: false, version: 0 },
    catalog: { hideDesignerPrices: true, placeholderOnImageError: true, menu: [], ...(s.catalog ?? {}) },
  };
  cache = { at: Date.now(), value };
  return value;
}

/** "[1500,1894)" -> [1500, 1893] */
function parseRange(r: string): [number, number] {
  const m = r.match(/^([[(])(\d+),(\d+)([\])])$/);
  if (!m) throw new Error(`Rango inválido ${r}`);
  const a = Number(m[2]) + (m[1] === "(" ? 1 : 0);
  const b = Number(m[3]) - (m[4] === ")" ? 1 : 0);
  return [a, b];
}
