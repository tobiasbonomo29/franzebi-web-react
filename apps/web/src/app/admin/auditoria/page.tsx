import { requireAdmin } from "@/lib/auth";
import { adminClient } from "@/lib/supabase";

export default async function Audit({ searchParams }: { searchParams: Promise<{ entity?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  let q = adminClient().from("audit_logs").select("id, at, actor_id, actor_role, action, entity, entity_id, before, after").order("at", { ascending: false }).limit(200);
  if (sp.entity) q = q.eq("entity", sp.entity);
  const { data } = await q;
  return (
    <>
      <h1>Auditoría</h1>
      <form style={{ marginBottom: "1rem" }}>
        <select name="entity" defaultValue={sp.entity ?? ""}>
          <option value="">Todo</option>{["orders", "products", "product_prices", "profiles", "settings", "wholesale_rules", "shipping_zones", "sync_jobs"].map((e) => <option key={e}>{e}</option>)}
        </select> <button className="btn">Filtrar</button>
      </form>
      <table>
        <thead><tr><th>Fecha</th><th>Actor</th><th>Acción</th><th>Entidad</th><th>Cambio</th></tr></thead>
        <tbody>
          {data?.map((a) => (
            <tr key={a.id}>
              <td><small>{new Date(a.at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}</small></td>
              <td><small>{a.actor_role ?? "sistema"}<br />{a.actor_id?.slice(0, 8)}</small></td>
              <td>{a.action}</td><td>{a.entity} <small>{a.entity_id?.slice(0, 12)}</small></td>
              <td><details><summary>ver</summary><pre style={{ whiteSpace: "pre-wrap", maxWidth: 520 }}>{JSON.stringify({ before: a.before, after: a.after }, null, 1)}</pre></details></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
