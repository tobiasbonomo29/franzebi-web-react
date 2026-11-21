import { formatArs } from "@franzebi/domain";
import { requireStaff } from "@/lib/auth";
import { adminClient } from "@/lib/supabase";
import { actionOrderStatus, actionValidatePayment } from "../actions";

const STATUSES = ["on_hold", "processing", "completed", "cancelled", "refunded"] as const;
const LABEL: Record<string, string> = { on_hold: "En espera", processing: "Procesando", completed: "Completado", cancelled: "Cancelado", refunded: "Reembolsado", pending: "Pendiente", failed: "Fallido" };

export default async function Orders({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  await requireStaff();
  const sp = await searchParams;
  let q = adminClient().from("orders").select("id, number, status, email, billing, payment_method, delivery_label, total_cents, cash_discount_cents, wholesale_applied, placed_at, order_items(sku, name, quantity)").order("placed_at", { ascending: false }).limit(100);
  if (sp.status && (STATUSES as readonly string[]).includes(sp.status)) q = q.eq("status", sp.status);
  if (sp.q) q = q.or(`email.ilike.%${sp.q.replace(/[%,()]/g, "")}%,number.eq.${Number(sp.q) || 0}`);
  const { data: orders, error } = await q;
  if (error) throw error;
  return (
    <>
      <h1>Pedidos</h1>
      <form style={{ display: "flex", gap: ".5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <select name="status" defaultValue={sp.status ?? ""}><option value="">Todos</option>{STATUSES.map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}</select>
        <input name="q" placeholder="Email o número" defaultValue={sp.q ?? ""} />
        <button className="btn">Filtrar</button>
      </form>
      <table>
        <thead><tr><th>#</th><th>Fecha</th><th>Cliente</th><th>Ítems</th><th>Entrega / pago</th><th>Total</th><th>Estado</th></tr></thead>
        <tbody>
          {orders?.map((o) => {
            const b = o.billing as { firstName?: string; lastName?: string; phone?: string; dni?: string };
            return (
              <tr key={o.id}>
                <td>{o.number}</td>
                <td>{new Date(o.placed_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}</td>
                <td>{b.firstName} {b.lastName}<br /><small>{o.email} · {b.phone} · DNI {b.dni}</small></td>
                <td>{(o.order_items as Array<{ sku: string; name: string; quantity: number }>).map((i) => <div key={i.sku}><small>{i.quantity}× {i.name} ({i.sku})</small></div>)}</td>
                <td>{o.delivery_label}<br /><small>{o.payment_method === "cash" ? "Efectivo" : "Transferencia"}{o.wholesale_applied ? " · Mayorista" : ""}</small></td>
                <td>{formatArs(Number(o.total_cents))}{Number(o.cash_discount_cents) > 0 && <><br /><small>-{formatArs(Number(o.cash_discount_cents))} efvo.</small></>}</td>
                <td>
                  <strong>{LABEL[o.status] ?? o.status}</strong>
                  {o.status === "on_hold" && o.payment_method === "bank_transfer" && (
                    <form action={actionValidatePayment}><input type="hidden" name="orderId" value={o.id} /><button className="btn" style={{ minHeight: 32, padding: ".2rem .8rem" }}>Validar pago</button></form>
                  )}
                  <form action={actionOrderStatus} style={{ display: "flex", gap: ".25rem", marginTop: ".25rem" }}>
                    <input type="hidden" name="orderId" value={o.id} />
                    <select name="status" defaultValue={o.status}>{STATUSES.map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}</select>
                    <button className="btn btn-outline" style={{ minHeight: 32, padding: ".2rem .6rem" }}>OK</button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
