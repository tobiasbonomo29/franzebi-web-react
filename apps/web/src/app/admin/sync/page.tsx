import { requireStaff } from "@/lib/auth";
import { adminClient } from "@/lib/supabase";
import { actionResolveError, actionRetryErrors, actionRetryOrderEvent, actionRunSync } from "../actions";

export default async function SyncPage() {
  const me = await requireStaff();
  const db = adminClient();
  const [{ data: jobs }, { data: errors }, { data: outbox }] = await Promise.all([
    db.from("sync_jobs").select("*").order("started_at", { ascending: false }).limit(20),
    db.from("sync_errors").select("*").is("resolved_at", null).order("created_at", { ascending: false }).limit(200),
    db.from("order_events").select("id, sink, event, order_status, status, attempts, last_error, next_attempt_at, created_at, orders(number)").neq("status", "sent").order("id", { ascending: false }).limit(100),
  ]);
  const dispatchOn = process.env.ORDER_DISPATCH_ENABLED === "true";
  const applyAllowed = process.env.SYNC_ALLOW_APPLY === "true";
  return (
    <>
      <h1>Sincronización Alegra</h1>
      <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
        <form action={actionRunSync}><input type="hidden" name="mode" value="dry_run" /><button className="btn btn-outline">Simular (dry-run)</button></form>
        {me.role === "admin" && (
          <form action={actionRunSync}><input type="hidden" name="mode" value="apply" /><button className="btn" disabled={!applyAllowed} title={applyAllowed ? "" : "Requiere SYNC_ALLOW_APPLY=true"}>Sincronizar ahora</button></form>
        )}
      </div>
      {!applyAllowed && <p className="notice warn">Modo seguro: el sync real está deshabilitado (SYNC_ALLOW_APPLY≠true). Sólo se ejecutan dry-runs.</p>}

      <h2>Últimas corridas</h2>
      <table>
        <thead><tr><th>Inicio</th><th>Origen</th><th>Disparador</th><th>Modo</th><th>Estado</th><th>Resultado</th><th></th></tr></thead>
        <tbody>
          {jobs?.map((j) => (
            <tr key={j.id}>
              <td>{new Date(j.started_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}</td>
              <td>{j.source}</td><td><small>{j.trigger}</small></td><td>{j.dry_run ? "dry-run" : "real"}</td><td><strong>{j.status}</strong></td>
              <td><small>{j.stats ? Object.entries(j.stats as Record<string, number>).map(([k, v]) => `${k}: ${v}`).join(" · ") : "—"}</small></td>
              <td>{!j.dry_run && <form action={actionRetryErrors}><input type="hidden" name="jobId" value={j.id} /><button className="btn btn-outline" style={{ minHeight: 32, padding: ".2rem .6rem" }}>Reintentar errores</button></form>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Errores abiertos ({errors?.length ?? 0})</h2>
      <table>
        <thead><tr><th>Fecha</th><th>SKU</th><th>Etapa</th><th>Código</th><th>Mensaje</th><th>Reintentable</th><th></th></tr></thead>
        <tbody>
          {errors?.map((e) => (
            <tr key={e.id}>
              <td><small>{new Date(e.created_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}</small></td>
              <td><code>{e.sku ?? e.source_id ?? "—"}</code></td><td>{e.stage}</td><td><code>{e.code}</code></td>
              <td>{e.message}{e.payload_summary && <details><summary>payload</summary><pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(e.payload_summary, null, 1)}</pre></details>}</td>
              <td>{e.retryable ? "sí" : "no"}</td>
              <td><form action={actionResolveError}><input type="hidden" name="id" value={e.id} /><button className="btn btn-outline" style={{ minHeight: 32, padding: ".2rem .6rem" }}>Marcar resuelto</button></form></td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Pedidos hacia AstroSelling (pendientes / con error: {outbox?.length ?? 0})</h2>
      {!dispatchOn && <p className="notice warn">Envío de pedidos deshabilitado (ORDER_DISPATCH_ENABLED≠true). Los eventos se acumulan y salen cuando se habilite.</p>}
      <p><small>Si un evento queda “dead”, los siguientes del mismo pedido esperan hasta reintentarlo (así nunca llega una actualización antes que el alta).</small></p>
      <table>
        <thead><tr><th>Pedido</th><th>Destino</th><th>Evento</th><th>Estado</th><th>Intentos</th><th>Error</th><th></th></tr></thead>
        <tbody>
          {outbox?.map((e) => (
            <tr key={e.id}>
              <td>#{(e.orders as unknown as { number: number } | null)?.number}</td><td>{e.sink}</td><td>{e.event} → {e.order_status}</td>
              <td><strong>{e.status}</strong></td><td>{e.attempts}</td><td><small>{e.last_error}</small></td>
              <td>{(e.status === "failed" || e.status === "dead") && <form action={actionRetryOrderEvent}><input type="hidden" name="id" value={e.id} /><button className="btn btn-outline" style={{ minHeight: 32, padding: ".2rem .6rem" }}>Reintentar</button></form>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
