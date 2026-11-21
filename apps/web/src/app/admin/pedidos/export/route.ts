import { requireStaff } from "@/lib/auth";
import { LABEL, ordersQuery, type SP } from "@/lib/admin-orders";

export const dynamic = "force-dynamic";

const cell = (v: unknown) => {
  const s = String(v ?? "");
  // Evita inyección de fórmulas al abrir en Excel/Sheets
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",;\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** CSV de pedidos con los mismos filtros de la lista (separador ";" para Excel en español). */
export async function GET(req: Request) {
  await requireStaff();
  const sp = Object.fromEntries(new URL(req.url).searchParams) as SP;
  const { data, error } = await ordersQuery(sp).range(0, 4999);
  if (error) return new Response("Error", { status: 500 });
  const head = ["Pedido", "Fecha", "Estado", "Nombre", "Apellido", "DNI", "Email", "Teléfono", "Entrega", "Pago", "Mayorista", "Total", "Seguimiento", "Ítems"];
  const rows = (data ?? []).map((o) => {
    const b = (o.billing ?? {}) as Record<string, string>;
    const its = o.order_items as Array<{ sku: string; quantity: number }>;
    return [o.number, new Date(o.placed_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }), LABEL[o.status] ?? o.status, b.firstName, b.lastName, b.dni, o.email, b.phone, o.delivery_label, o.payment_method === "cash" ? "Efectivo" : "Transferencia", o.wholesale_applied ? "Sí" : "No", (Number(o.total_cents) / 100).toFixed(2).replace(".", ","), o.tracking_number, its.map((i) => `${i.quantity}x ${i.sku}`).join(" | ")];
  });
  const csv = "﻿" + [head, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="pedidos-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
}
