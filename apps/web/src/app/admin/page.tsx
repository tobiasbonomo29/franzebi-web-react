import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { adminClient } from "@/lib/supabase";

export default async function AdminHome() {
  await requireStaff();
  const db = adminClient();
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
  const [onHold, processing, products, noImage, openErrors, lastJob] = await Promise.all([
    count(db.from("orders").select("*", { count: "exact", head: true }).eq("status", "on_hold")),
    count(db.from("orders").select("*", { count: "exact", head: true }).eq("status", "processing")),
    count(db.from("products").select("*", { count: "exact", head: true }).eq("status", "active")),
    count(db.from("products").select("*", { count: "exact", head: true }).eq("has_placeholder_image", true)),
    count(db.from("sync_errors").select("*", { count: "exact", head: true }).is("resolved_at", null)),
    db.from("sync_jobs").select("status, started_at, dry_run, stats").order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return (
    <>
      <h1>Resumen</h1>
      <div className="kpis">
        <Link href="/admin/pedidos/?status=on_hold" className="kpi"><b>{onHold}</b>Pedidos en espera (validar pago)</Link>
        <Link href="/admin/pedidos/?status=processing" className="kpi"><b>{processing}</b>Pedidos procesando</Link>
        <div className="kpi"><b>{products}</b>Productos activos</div>
        <div className="kpi"><b>{noImage}</b>Con imagen placeholder</div>
        <Link href="/admin/sync/" className="kpi"><b>{openErrors}</b>Errores de sync abiertos</Link>
      </div>
      <p>Último sync: {lastJob.data ? `${new Date(lastJob.data.started_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })} · ${lastJob.data.status}${lastJob.data.dry_run ? " (dry-run)" : ""}` : "nunca"}</p>
    </>
  );
}
