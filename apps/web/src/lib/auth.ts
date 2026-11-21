import "server-only";
import { redirect } from "next/navigation";
import { adminClient, userClient } from "./supabase";

export type Role = "admin" | "operator" | "customer" | "wholesale";
export interface SessionProfile {
  id: string;
  email: string;
  role: Role;
  fullName: string | null;
}

/** El rol se lee SIEMPRE de la base (profiles.role), nunca del JWT/metadata que el cliente podría manipular. */
export async function getSessionProfile(): Promise<SessionProfile | null> {
  const sb = await userClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  const { data: p } = await adminClient().from("profiles").select("id, email, role, full_name").eq("id", data.user.id).maybeSingle();
  if (!p) return null;
  return { id: p.id, email: p.email, role: p.role as Role, fullName: p.full_name };
}

export async function requireStaff(): Promise<SessionProfile> {
  const p = await getSessionProfile();
  if (!p) redirect("/mi-cuenta/?next=/admin/");
  if (p.role !== "admin" && p.role !== "operator") redirect("/");
  return p;
}

export async function requireAdmin(): Promise<SessionProfile> {
  const p = await requireStaff();
  if (p.role !== "admin") redirect("/admin/");
  return p;
}

export async function audit(actor: SessionProfile | null, action: string, entity: string, entityId: string | null, after?: unknown) {
  await adminClient().from("audit_logs").insert({ actor_id: actor?.id ?? null, actor_role: actor?.role ?? null, action, entity, entity_id: entityId, after: after ?? null });
}
