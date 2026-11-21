import "server-only";
import { adminClient } from "./supabase";

export const STATUSES = ["on_hold", "processing", "completed", "cancelled", "refunded"] as const;
export const LABEL: Record<string, string> = { on_hold: "En espera", processing: "Procesando", completed: "Completado", cancelled: "Cancelado", refunded: "Reembolsado", pending: "Pendiente", failed: "Fallido" };
export const DELIVERY: Record<string, string> = { local_pickup: "Retiro", moto: "Moto", moto_scheduled_caba: "Horario CABA", correo_argentino: "Correo Argentino" };
export const PER_PAGE = 50;

export type SP = { status?: string; q?: string; delivery?: string; from?: string; to?: string; page?: string };

/** Filtros compartidos por la lista y la exportación CSV. */
export function ordersQuery(sp: SP) {
  let q = adminClient()
    .from("orders")
    .select("id, number, status, email, billing, payment_method, delivery_kind, delivery_label, total_cents, cash_discount_cents, wholesale_applied, placed_at, tracking_number, external_refs, order_items(sku, name, quantity)", { count: "exact" })
    .order("placed_at", { ascending: false });
  if (sp.status && (STATUSES as readonly string[]).includes(sp.status)) q = q.eq("status", sp.status);
  if (sp.delivery && sp.delivery in DELIVERY) q = q.eq("delivery_kind", sp.delivery);
  if (sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from)) q = q.gte("placed_at", `${sp.from}T00:00:00-03:00`);
  if (sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to)) q = q.lte("placed_at", `${sp.to}T23:59:59-03:00`);
  const term = (sp.q ?? "").replace(/[%,()*]/g, "").trim();
  if (term) {
    const ors = [`email.ilike.%${term}%`, `billing->>firstName.ilike.%${term}%`, `billing->>lastName.ilike.%${term}%`, `billing->>dni.ilike.%${term}%`, `billing->>phone.ilike.%${term}%`];
    if (/^\d+$/.test(term) && term.length <= 12) ors.push(`number.eq.${term}`);
    q = q.or(ors.join(","));
  }
  return q;
}

