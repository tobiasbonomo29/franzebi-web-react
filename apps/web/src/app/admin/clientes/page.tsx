import { requireStaff } from "@/lib/auth";
import { adminClient } from "@/lib/supabase";
import { actionSetRole } from "../actions";

const ROLES = { admin: "Administrador", operator: "Operador", customer: "Cliente", wholesale: "Mayorista" } as const;

export default async function Customers({ searchParams }: { searchParams: Promise<{ q?: string; role?: string }> }) {
  const me = await requireStaff();
  const sp = await searchParams;
  let q = adminClient().from("profiles").select("id, email, full_name, phone, role, wholesale_since, legacy_wp_user_id, password_reset_required, created_at").order("created_at", { ascending: false }).limit(200);
  if (sp.q) q = q.or(`email.ilike.%${sp.q.replace(/[%,()]/g, "")}%,full_name.ilike.%${sp.q.replace(/[%,()]/g, "")}%`);
  if (sp.role && sp.role in ROLES) q = q.eq("role", sp.role);
  const { data, error } = await q;
  if (error) throw error;
  return (
    <>
      <h1>Clientes</h1>
      <form style={{ display: "flex", gap: ".5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <input name="q" placeholder="Email o nombre" defaultValue={sp.q ?? ""} />
        <select name="role" defaultValue={sp.role ?? ""}><option value="">Todos</option>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="btn">Filtrar</button>
      </form>
      <table>
        <thead><tr><th>Email</th><th>Nombre</th><th>Teléfono</th><th>Rol</th><th>Migrado de WP</th><th>Alta</th></tr></thead>
        <tbody>
          {data?.map((p) => (
            <tr key={p.id}>
              <td>{p.email}</td><td>{p.full_name}</td><td>{p.phone}</td>
              <td>
                {me.role === "admin" && p.id !== me.id ? (
                  <form action={actionSetRole} style={{ display: "flex", gap: ".25rem" }}>
                    <input type="hidden" name="userId" value={p.id} />
                    <select name="role" defaultValue={p.role}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <button className="btn btn-outline" style={{ minHeight: 32, padding: ".2rem .6rem" }}>OK</button>
                  </form>
                ) : ROLES[p.role as keyof typeof ROLES]}
                {p.wholesale_since && <small> desde {new Date(p.wholesale_since).toLocaleDateString("es-AR")}</small>}
              </td>
              <td>{p.legacy_wp_user_id ? `#${p.legacy_wp_user_id}${p.password_reset_required ? " · debe crear contraseña" : ""}` : "—"}</td>
              <td><small>{new Date(p.created_at).toLocaleDateString("es-AR")}</small></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
