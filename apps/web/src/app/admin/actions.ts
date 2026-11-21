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
  revalidatePath("/admin/pedidos/", "layout");
}

export async function actionValidatePayment(formData: FormData) {
  const actor = await requireStaff();
  const orderId = String(formData.get("orderId"));
  const db = adminClient();
  await db.from("payment_attempts").update({ status: "approved", validated_by: actor.id, validated_at: new Date().toISOString() }).eq("order_id", orderId).eq("status", "awaiting_validation");
  await changeOrderStatus(actor, orderId, "processing");
  revalidatePath("/admin/pedidos/", "layout");
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
  revalidatePath("/admin/pedidos/", "layout");
}

export async function actionSetPublished(formData: FormData) {
  const actor = await requireStaff();
  const id = String(formData.get("productId"));
  const published = formData.get("published") === "true";
  await adminClient().from("products").update({ published }).eq("id", id);
  await audit(actor, published ? "product_publish" : "product_unpublish", "products", id);
  revalidatePath("/admin/productos/");
}

// ---------------------------------------------------------------------------
// Detalle de pedido: notas, seguimiento y Correo Argentino
// ---------------------------------------------------------------------------
export async function actionAddOrderNote(formData: FormData) {
  const actor = await requireStaff();
  const orderId = String(formData.get("orderId"));
  const note = String(formData.get("note") ?? "").trim().slice(0, 2000);
  if (!note) return;
  const customerVisible = formData.get("customer") === "on";
  await adminClient().from("order_notes").insert({ order_id: orderId, author_id: actor.id, author_email: actor.email, note, customer_visible: customerVisible });
  await audit(actor, "order_note", "orders", orderId, { customerVisible });
  revalidatePath(`/admin/pedidos/${formData.get("number")}/`);
}

export async function actionSetTracking(formData: FormData) {
  const actor = await requireStaff();
  const orderId = String(formData.get("orderId"));
  const tracking = String(formData.get("tracking") ?? "").trim().slice(0, 60) || null;
  const db = adminClient();
  await db.from("orders").update({ tracking_number: tracking, shipped_at: tracking ? new Date().toISOString() : null }).eq("id", orderId);
  if (tracking) await db.from("order_notes").insert({ order_id: orderId, author_id: actor.id, author_email: actor.email, note: `Número de seguimiento: ${tracking}`, customer_visible: true });
  await audit(actor, "order_tracking", "orders", orderId, { tracking });
  revalidatePath(`/admin/pedidos/${formData.get("number")}/`);
}

export async function actionCorreoImport(formData: FormData) {
  const actor = await requireStaff();
  const orderId = String(formData.get("orderId"));
  const { MiCorreoClient, DEFAULT_CORREO_SENDER } = await import("@/lib/correo");
  const db = adminClient();
  const note = (text: string) => db.from("order_notes").insert({ order_id: orderId, author_id: actor.id, author_email: actor.email, note: text, customer_visible: false });
  const client = MiCorreoClient.fromEnvClient();
  if (!client) {
    await note("Correo Argentino: no se pudo importar, faltan credenciales de la API MiCorreo (CORREO_API_USER / CORREO_API_PASSWORD).");
    revalidatePath(`/admin/pedidos/${formData.get("number")}/`);
    return;
  }
  const { data: o } = await db.from("orders").select("*, order_items(quantity, line_total_cents, products(weight_kg, length_cm, width_cm, height_cm))").eq("id", orderId).single();
  if (!o || o.delivery_kind !== "correo_argentino") return;
  const b = (o.billing ?? {}) as Record<string, string>;
  const s = (o.shipping_address ?? {}) as Record<string, string> & { agency?: { code: string } };
  const items = o.order_items as Array<{ quantity: number; line_total_cents: number; products: { weight_kg: number | null; length_cm: number | null; width_cm: number | null; height_cm: number | null } | null }>;
  // Mismo criterio que la cotización: fallback 1 kg y 20x15x10 por unidad sin datos
  const weightG = items.reduce((sum, i) => sum + (Number(i.products?.weight_kg) || 1) * 1000 * i.quantity, 0);
  const dims = {
    length: Math.max(...items.map((i) => Number(i.products?.length_cm) || 20)),
    width: Math.max(...items.map((i) => Number(i.products?.width_cm) || 15)),
    height: Math.min(150, items.reduce((sum, i) => sum + (Number(i.products?.height_cm) || 10) * i.quantity, 0)),
  };
  const toBranch = /_s$/.test(o.delivery_option_id);
  try {
    const r = await client.importShipment({
      number: Number(o.number),
      recipient: { name: `${b.firstName ?? ""} ${b.lastName ?? ""}`.trim(), email: o.email, phone: b.phone ?? "" },
      deliveryType: toBranch ? "S" : "D",
      agencyCode: s.agency?.code ?? null,
      address: { street: [s.street, s.number].filter(Boolean).join(" "), apartment: s.apartment, city: s.city ?? "", provinceCode: s.state ?? "", postcode: s.postcode ?? "" },
      productType: /expreso/i.test(o.delivery_label) ? "EP" : "CP",
      weightG,
      dims,
      declaredValue: Number(o.subtotal_cents) / 100,
      sender: DEFAULT_CORREO_SENDER,
    });
    await db.from("orders").update({ external_refs: { ...((o.external_refs as Record<string, string>) ?? {}), correo: r?.createdAt ?? "importado" }, ...(r?.trackingNumber ? { tracking_number: r.trackingNumber, shipped_at: new Date().toISOString() } : {}) }).eq("id", orderId);
    await note(`Envío importado en MiCorreo${r?.trackingNumber ? ` (seguimiento ${r.trackingNumber})` : ""}.`);
    await audit(actor, "correo_import", "orders", orderId, { tracking: r?.trackingNumber ?? null });
  } catch (e) {
    await note(`Correo Argentino: error al importar — ${(e as Error).message.slice(0, 300)}`);
  }
  revalidatePath(`/admin/pedidos/${formData.get("number")}/`);
}
