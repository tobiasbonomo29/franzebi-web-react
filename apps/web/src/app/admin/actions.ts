"use server";
import { revalidatePath } from "next/cache";
import { audit, requireAdmin, requireStaff } from "@/lib/auth";
import { changeOrderStatus } from "@/lib/checkout";
import { runSync } from "@/lib/sync-runner";
import { adminClient } from "@/lib/supabase";

export async function actionRunSync(formData: FormData) {
  const actor = await requireStaff();
  const apply = formData.get("mode") === "apply";
  if (apply && actor.role !== "admin") throw new Error("Sólo admin puede aplicar un sync real");
  const r = await runSync({ apply, trigger: `manual:${actor.id}` });
  await audit(actor, apply ? "sync_apply" : "sync_dry_run", "sync_jobs", r.jobId, r.stats);
  revalidatePath("/admin/sync/");
}

export async function actionRetryErrors(formData: FormData) {
  const actor = await requireStaff();
  const jobId = String(formData.get("jobId"));
  const db = adminClient();
  const { data } = await db.from("sync_errors").select("id, sku").eq("job_id", jobId).eq("retryable", true).is("resolved_at", null);
  const skus = [...new Set((data ?? []).map((e) => e.sku).filter(Boolean) as string[])];
  if (!skus.length) return;
  const r = await runSync({ apply: true, trigger: `retry:${jobId}`, onlySkus: skus });
  await db.from("sync_errors").update({ retry_job_id: r.jobId }).in("id", (data ?? []).map((e) => e.id));
  await audit(actor, "sync_retry", "sync_jobs", jobId, { skus: skus.length, retryJob: r.jobId });
  revalidatePath("/admin/sync/");
}

export async function actionResolveError(formData: FormData) {
  const actor = await requireStaff();
  const id = Number(formData.get("id"));
  await adminClient().from("sync_errors").update({ resolved_at: new Date().toISOString(), resolved_by: actor.id }).eq("id", id);
  revalidatePath("/admin/sync/");
}

export async function actionOrderStatus(formData: FormData) {
  const actor = await requireStaff();
  await changeOrderStatus(actor, String(formData.get("orderId")), String(formData.get("status")));
  revalidatePath("/admin/pedidos/");
}

export async function actionValidatePayment(formData: FormData) {
  const actor = await requireStaff();
  const orderId = String(formData.get("orderId"));
  const db = adminClient();
  await db.from("payment_attempts").update({ status: "approved", validated_by: actor.id, validated_at: new Date().toISOString() }).eq("order_id", orderId).eq("status", "awaiting_validation");
  await changeOrderStatus(actor, orderId, "processing");
  revalidatePath("/admin/pedidos/");
}

export async function actionSetSaleMode(formData: FormData) {
  const actor = await requireStaff();
  const id = String(formData.get("productId"));
  const mode = String(formData.get("saleMode"));
  if (!["purchasable", "on_request", "hidden"].includes(mode)) throw new Error("Modo inválido");
  await adminClient().from("products").update({ sale_mode: mode, sale_mode_locked: true }).eq("id", id);
  await audit(actor, "sale_mode_change", "products", id, { sale_mode: mode });
  revalidatePath("/admin/productos/");
}

export async function actionSetRole(formData: FormData) {
  const actor = await requireAdmin();
  const userId = String(formData.get("userId"));
  const role = String(formData.get("role"));
  if (!["admin", "operator", "customer", "wholesale"].includes(role)) throw new Error("Rol inválido");
  await adminClient().from("profiles").update({ role, wholesale_since: role === "wholesale" ? new Date().toISOString() : null }).eq("id", userId);
  await audit(actor, "role_change", "profiles", userId, { role });
  revalidatePath("/admin/clientes/");
}

export async function actionRetryOrderEvent(formData: FormData) {
  const actor = await requireStaff();
  const id = Number(formData.get("id"));
  await adminClient().from("order_events").update({ status: "pending", next_attempt_at: new Date().toISOString(), last_error: null }).eq("id", id).in("status", ["failed", "dead"]);
  await audit(actor, "order_event_retry", "order_events", String(id));
  revalidatePath("/admin/sync/");
}

export async function actionSetPublished(formData: FormData) {
  const actor = await requireStaff();
  const id = String(formData.get("productId"));
  const published = formData.get("published") === "true";
  await adminClient().from("products").update({ published }).eq("id", id);
  await audit(actor, published ? "product_publish" : "product_unpublish", "products", id);
  revalidatePath("/admin/productos/");
}
