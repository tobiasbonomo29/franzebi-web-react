import { notFound } from "next/navigation";
import Link from "next/link";
import { formatArs, whatsappReceiptUrl } from "@franzebi/domain";
import { requireStaff } from "@/lib/auth";
import { adminClient } from "@/lib/supabase";
import { actionAddOrderNote, actionCorreoImport, actionOrderStatus, actionRetryOrderEvent, actionSetTracking, actionValidatePayment } from "../../actions";
import { PrintButton } from "./PrintButton";

const STATUSES = ["on_hold", "processing", "completed", "cancelled", "refunded"] as const;
const LABEL: Record<string, string> = { on_hold: "En espera", processing: "Procesando", completed: "Completado", cancelled: "Cancelado", refunded: "Reembolsado", pending: "Pendiente", failed: "Fallido" };
const EVENT_LABEL: Record<string, string> = { pending: "Pendiente", sending: "Enviando", sent: "Enviado", failed: "Reintentando", dead: "Falló (revisar)" };
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }) : "—");

/** Detalle de pedido (equivalente a la edición de pedido de WooCommerce). */
export default async function OrderDetail({ params }: { params: Promise<{ number: string }> }) {
  await requireStaff();
  const n = Number((await params).number);
  if (!Number.isInteger(n)) notFound();
  const db = adminClient();
  const { data: o } = await db.from("orders").select("*").eq("number", n).maybeSingle();
  if (!o) notFound();
  const [{ data: items }, { data: notes }, { data: events }, { data: payments }, { data: history }] = await Promise.all([
    db.from("order_items").select("sku, name, quantity, unit_price_cents, retail_unit_price_cents, line_total_cents, wholesale_applied, products(slug)").eq("order_id", o.id),
    db.from("order_notes").select("note, author_email, customer_visible, created_at").eq("order_id", o.id).order("created_at", { ascending: false }),
    db.from("order_events").select("id, sink, event, order_status, status, attempts, last_error, external_ref, created_at, sent_at, next_attempt_at").eq("order_id", o.id).order("id"),
    db.from("payment_attempts").select("method, status, amount_cents, validated_at").eq("order_id", o.id),
    db.from("audit_logs").select("at, action, before, after, actor_role").eq("entity", "orders").eq("entity_id", o.id).order("at", { ascending: false }).limit(30),
  ]);
  const b = (o.billing ?? {}) as Record<string, string>;
  const s = (o.shipping_address ?? {}) as Record<string, string> & { agency?: { code: string; name: string } };
  const refs = (o.external_refs ?? {}) as Record<string, string>;
  const phone = (b.phone ?? "").replace(/\D/g, "");
  const wa = phone ? `https://wa.me/${phone.startsWith("54") ? phone : `549${phone.replace(/^0/, "").replace(/^15/, "")}`}?text=${encodeURIComponent(`Hola ${b.firstName ?? ""}! Te escribimos de Franzebi Imports por tu pedido #${o.number}.`)}` : null;

  return (
    <div className="order-detail">
      <p className="no-print"><Link href="/admin/pedidos/">← Pedidos</Link></p>
      <h1>
        Pedido #{o.number} <span className={`badge status-${o.status}`}>{LABEL[o.status] ?? o.status}</span>
        {o.wholesale_applied && <span className="badge">Mayorista</span>}
      </h1>
      <p><small>Realizado el {fmt(o.placed_at)}{o.paid_at && <> · Pago validado {fmt(o.paid_at)}</>}{o.shipped_at && <> · Despachado {fmt(o.shipped_at)}</>}</small></p>

      <div className="no-print" style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", margin: "1rem 0" }}>
        {o.status === "on_hold" && o.payment_method === "bank_transfer" && (
          <form action={actionValidatePayment}><input type="hidden" name="orderId" value={o.id} /><button className="btn">Validar pago (→ Procesando)</button></form>
        )}
        <form action={actionOrderStatus} style={{ display: "flex", gap: ".25rem" }}>
          <input type="hidden" name="orderId" value={o.id} />
          <select name="status" defaultValue={o.status} aria-label="Estado">{STATUSES.map((x) => <option key={x} value={x}>{LABEL[x]}</option>)}</select>
          <button className="btn btn-outline">Cambiar estado</button>
        </form>
        {wa && <a className="btn btn-outline" href={wa} target="_blank" rel="noopener">WhatsApp al cliente</a>}
        <a className="btn btn-outline" href={`mailto:${o.email}?subject=${encodeURIComponent(`Tu pedido #${o.number} en Franzebi Imports`)}`}>Email al cliente</a>
        <PrintButton />
      </div>

      <div className="grid2">
        <section className="card">
          <h2>Cliente</h2>
          <p><strong>{b.firstName} {b.lastName}</strong><br />DNI {b.dni}<br /><a href={`mailto:${o.email}`}>{o.email}</a><br />{b.phone}</p>
          {o.user_id ? <p><small>Cliente registrado</small></p> : <p><small>Compra como invitado</small></p>}
        </section>
        <section className="card">
          <h2>Entrega</h2>
          <p><strong>{o.delivery_label}</strong>{o.estimated_delivery && <><br /><small>{o.estimated_delivery}</small></>}</p>
          {s.agency && <p>Sucursal: <strong>{s.agency.name}</strong> ({s.agency.code})</p>}
          <p>{[s.street, s.number].filter(Boolean).join(" ")} {s.apartment}<br />{[s.city, s.state, s.postcode].filter(Boolean).join(", ")}</p>
          {o.delivery_kind === "correo_argentino" && (
            <div className="no-print">
              <form action={actionCorreoImport} style={{ marginBottom: ".5rem" }}>
                <input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="number" value={o.number} />
                <button className="btn btn-outline">{refs.correo ? "Reimportar en Correo Argentino" : "Importar en Correo Argentino"}</button>
              </form>
            </div>
          )}
          {o.delivery_kind !== "local_pickup" && (
            <form action={actionSetTracking} className="no-print" style={{ display: "flex", gap: ".25rem" }}>
              <input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="number" value={o.number} />
              <input name="tracking" placeholder="N° de seguimiento" defaultValue={o.tracking_number ?? ""} aria-label="Número de seguimiento" />
              <button className="btn btn-outline">Guardar</button>
            </form>
          )}
          {o.tracking_number && <p className="print-only">Seguimiento: {o.tracking_number}</p>}
        </section>
        <section className="card">
          <h2>Pago</h2>
          <p><strong>{o.payment_method === "cash" ? "Efectivo en el local (5% OFF)" : "Transferencia bancaria"}</strong></p>
          {payments?.map((p, i) => <p key={i}><small>{p.status === "approved" ? `Aprobado ${fmt(p.validated_at)}` : p.status === "awaiting_validation" ? "Esperando comprobante / validación" : p.status} · {formatArs(Number(p.amount_cents))}</small></p>)}
          {o.payment_method === "bank_transfer" && o.status === "on_hold" && <p className="no-print"><small>Link para que el cliente mande el comprobante: <a href={whatsappReceiptUrl(o.number)} target="_blank" rel="noopener">WhatsApp</a></small></p>}
        </section>
      </div>

      <section className="card">
        <h2>Productos</h2>
        <table>
          <thead><tr><th>Producto</th><th>SKU</th><th>Cant.</th><th>Unitario</th><th>Total</th></tr></thead>
          <tbody>
            {items?.map((i) => (
              <tr key={i.sku}>
                <td>{(i.products as unknown as { slug: string } | null)?.slug ? <a href={`/product/${(i.products as unknown as { slug: string }).slug}/`} target="_blank" rel="noopener">{i.name}</a> : i.name}{i.wholesale_applied && <> <small className="badge">mayorista</small></>}</td>
                <td><code>{i.sku}</code></td>
                <td>{i.quantity}</td>
                <td>{formatArs(Number(i.unit_price_cents))}{i.wholesale_applied && i.retail_unit_price_cents && <><br /><small><s>{formatArs(Number(i.retail_unit_price_cents))}</s></small></>}</td>
                <td>{formatArs(Number(i.line_total_cents))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={4}>Subtotal</td><td>{formatArs(Number(o.subtotal_cents))}</td></tr>
            {Number(o.cash_discount_cents) > 0 && <tr><td colSpan={4}>Descuento efectivo</td><td>-{formatArs(Number(o.cash_discount_cents))}</td></tr>}
            <tr><td colSpan={4}>Envío</td><td>{formatArs(Number(o.shipping_cents))}</td></tr>
            <tr><td colSpan={4}><strong>Total</strong></td><td><strong>{formatArs(Number(o.total_cents))}</strong></td></tr>
          </tfoot>
        </table>
        {o.wholesale_applied && <p><small>Puntos mayoristas: {o.wholesale_points} / {o.wholesale_threshold}</small></p>}
        {o.customer_note && <p><strong>Nota del cliente:</strong> {o.customer_note}</p>}
      </section>

      <div className="grid2 no-print">
        <section className="card">
          <h2>Notas del pedido</h2>
          <form action={actionAddOrderNote}>
            <input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="number" value={o.number} />
            <textarea name="note" rows={3} maxLength={2000} placeholder="Agregar nota…" style={{ width: "100%" }} />
            <label style={{ display: "block", margin: ".25rem 0" }}><input type="checkbox" name="customer" /> Visible para el cliente (en Mi cuenta)</label>
            <button className="btn btn-outline">Agregar nota</button>
          </form>
          <ul className="notes">
            {notes?.map((x, i) => (
              <li key={i} className={x.customer_visible ? "note-customer" : ""}>
                <p>{x.note}</p>
                <small>{fmt(x.created_at)} · {x.author_email ?? "sistema"}{x.customer_visible ? " · visible al cliente" : ""}</small>
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <h2>Integraciones (facturación / stock en Alegra)</h2>
          {refs.alegra && <p>Factura Alegra: <strong>#{refs.alegra}</strong></p>}
          {refs.astroselling && <p>AstroSelling: <code>{refs.astroselling}</code></p>}
          {refs.correo && <p>Correo Argentino: importado</p>}
          {!events?.length && <p><small>Sin eventos (no hay integraciones activas en settings.integrations.orderSinks).</small></p>}
          <table>
            <thead><tr><th>Destino</th><th>Evento</th><th>Estado</th><th>Intentos</th><th /></tr></thead>
            <tbody>
              {events?.map((e) => (
                <tr key={e.id}>
                  <td>{e.sink}</td>
                  <td><small>{e.event} ({LABEL[e.order_status] ?? e.order_status})</small></td>
                  <td>{EVENT_LABEL[e.status] ?? e.status}{e.last_error && <><br /><small title={e.last_error}>{e.last_error.slice(0, 90)}</small></>}{e.status === "failed" && <><br /><small>próximo intento {fmt(e.next_attempt_at)}</small></>}</td>
                  <td>{e.attempts}</td>
                  <td>{(e.status === "dead" || e.status === "failed") && <form action={actionRetryOrderEvent}><input type="hidden" name="id" value={e.id} /><button className="btn btn-outline">Reintentar</button></form>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Historial</h3>
          <ul className="notes">{history?.map((h, i) => <li key={i}><small>{fmt(h.at)} · {h.action} {h.before ? `${JSON.stringify(h.before)} → ` : ""}{h.after ? JSON.stringify(h.after).slice(0, 120) : ""} ({h.actor_role ?? "sistema"})</small></li>)}</ul>
        </section>
      </div>
    </div>
  );
}
