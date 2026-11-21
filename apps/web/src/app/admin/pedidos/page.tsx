import Link from "next/link";
import { formatArs } from "@franzebi/domain";
import { requireStaff } from "@/lib/auth";
import { adminClient } from "@/lib/supabase";
import { DELIVERY, LABEL, PER_PAGE, STATUSES, ordersQuery, type SP } from "@/lib/admin-orders";
import { actionValidatePayment } from "../actions";

export default async function Orders({ searchParams }: { searchParams: Promise<SP> }) {
  await requireStaff();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const db = adminClient();
  const [{ data: orders, count, error }, ...counts] = await Promise.all([
    ordersQuery(sp).range((page - 1) * PER_PAGE, page * PER_PAGE - 1),
    ...STATUSES.map((s) => db.from("orders").select("id", { count: "exact", head: true }).eq("status", s)),
  ]);
  if (error) throw error;
  const qs = (extra: Partial<SP>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...extra }).filter(([, v]) => v) as Array<[string, string]>);
    return `?${p}`;
  };
  const pages = Math.max(1, Math.ceil((count ?? 0) / PER_PAGE));
  return (
    <>
      <h1>Pedidos <small>({count ?? 0})</small></h1>
      <nav className="status-tabs" aria-label="Estados">
        <Link className={!sp.status ? "active" : ""} href={qs({ status: undefined, page: undefined })}>Todos</Link>
        {STATUSES.map((s, i) => (
          <Link key={s} className={sp.status === s ? "active" : ""} href={qs({ status: s, page: undefined })}>{LABEL[s]} ({counts[i]?.count ?? 0})</Link>
        ))}
      </nav>
      <form style={{ display: "flex", gap: ".5rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "end" }}>
        {sp.status && <input type="hidden" name="status" value={sp.status} />}
        <label>Buscar<br /><input name="q" placeholder="N°, nombre, email, DNI, teléfono" defaultValue={sp.q ?? ""} /></label>
        <label>Entrega<br /><select name="delivery" defaultValue={sp.delivery ?? ""}><option value="">Todas</option>{Object.entries(DELIVERY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Desde<br /><input type="date" name="from" defaultValue={sp.from ?? ""} /></label>
        <label>Hasta<br /><input type="date" name="to" defaultValue={sp.to ?? ""} /></label>
        <button className="btn">Filtrar</button>
        <a className="btn btn-outline" href={`/admin/pedidos/export${qs({ page: undefined })}`}>Exportar CSV</a>
      </form>
      <table>
        <thead><tr><th>Pedido</th><th>Fecha</th><th>Cliente</th><th>Ítems</th><th>Entrega / pago</th><th>Total</th><th>Estado</th></tr></thead>
        <tbody>
          {orders?.map((o) => {
            const b = o.billing as { firstName?: string; lastName?: string; phone?: string; dni?: string };
            const refs = (o.external_refs ?? {}) as Record<string, string>;
            const its = o.order_items as Array<{ sku: string; name: string; quantity: number }>;
            return (
              <tr key={o.id}>
                <td><Link href={`/admin/pedidos/${o.number}/`}><strong>#{o.number}</strong></Link></td>
                <td><small>{new Date(o.placed_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" })}</small></td>
                <td>{b.firstName} {b.lastName}<br /><small>{o.email}<br />{b.phone}</small></td>
                <td>{its.slice(0, 3).map((i) => <div key={i.sku}><small>{i.quantity}× {i.name}</small></div>)}{its.length > 3 && <small>+{its.length - 3} más</small>}</td>
                <td>{o.delivery_label}<br /><small>{o.payment_method === "cash" ? "Efectivo" : "Transferencia"}{o.wholesale_applied ? " · Mayorista" : ""}{o.tracking_number ? ` · Seg. ${o.tracking_number}` : ""}</small></td>
                <td>{formatArs(Number(o.total_cents))}{refs.alegra && <><br /><small>Factura {refs.alegra}</small></>}</td>
                <td>
                  <span className={`badge status-${o.status}`}>{LABEL[o.status] ?? o.status}</span>
                  {o.status === "on_hold" && o.payment_method === "bank_transfer" && (
                    <form action={actionValidatePayment} style={{ marginTop: ".25rem" }}><input type="hidden" name="orderId" value={o.id} /><button className="btn" style={{ minHeight: 30, padding: ".15rem .6rem" }}>Validar pago</button></form>
                  )}
                </td>
              </tr>
            );
          })}
          {!orders?.length && <tr><td colSpan={7}>No hay pedidos con esos filtros.</td></tr>}
        </tbody>
      </table>
      <p>{page > 1 && <Link href={qs({ page: String(page - 1) })}>← Anterior</Link>} Página {page} de {pages} {page < pages && <Link href={qs({ page: String(page + 1) })}>Siguiente →</Link>}</p>
    </>
  );
}
