import { formatArs } from "@franzebi/domain";
import { revalidatePath } from "next/cache";
import { audit, requireAdmin } from "@/lib/auth";
import { adminClient } from "@/lib/supabase";

/** Configuración comercial. Cambios sólo admin, auditados por trigger y por audit(). */
async function saveSetting(formData: FormData) {
  "use server";
  const me = await requireAdmin();
  const key = String(formData.get("key"));
  if (!["payments", "shipping", "sameday", "catalog", "contact", "notifications", "faq"].includes(key)) throw new Error("Clave inválida");
  let value: unknown;
  try { value = JSON.parse(String(formData.get("value"))); } catch { throw new Error("JSON inválido"); }
  if (key === "payments") {
    const kinds = (value as { cash?: { allowedDeliveryKinds?: string[] } }).cash?.allowedDeliveryKinds ?? [];
    if (kinds.includes("correo_argentino")) throw new Error("Efectivo nunca puede habilitarse para Correo Argentino");
  }
  await adminClient().from("settings").upsert({ key, value, updated_by: me.id });
  await audit(me, "settings_update", "settings", key, value);
  revalidatePath("/admin/configuracion/");
}

async function saveZone(formData: FormData) {
  "use server";
  const me = await requireAdmin();
  const id = String(formData.get("id"));
  const price = Math.round(Number(formData.get("price")) * 100);
  if (!Number.isFinite(price) || price < 0) throw new Error("Precio inválido");
  await adminClient().from("shipping_zones").update({ price_cents: price, active: formData.get("active") === "on" }).eq("id", id);
  await audit(me, "zone_update", "shipping_zones", id, { price_cents: price });
  revalidatePath("/admin/configuracion/");
}

export default async function Config() {
  await requireAdmin();
  const db = adminClient();
  const [{ data: settings }, { data: zones }, { data: rules }] = await Promise.all([
    db.from("settings").select("key, value, is_public, updated_at").order("key"),
    db.from("shipping_zones").select("id, label, price_cents, active, cities").order("sort"),
    db.from("wholesale_rules").select("*").order("version", { ascending: false }),
  ]);
  return (
    <>
      <h1>Configuración comercial</h1>
      <p className="notice warn">Hay decisiones pendientes del dueño (ver docs/03-decisiones-pendientes.md). Cambiá estos valores sólo con definición explícita.</p>

      <h2>Zonas de moto</h2>
      <table><thead><tr><th>Zona</th><th>Precio</th><th>Localidades</th><th></th></tr></thead><tbody>
        {zones?.map((z) => (
          <tr key={z.id}><td>{z.label}</td><td>{formatArs(Number(z.price_cents))}</td><td><small>{z.cities.length} localidades</small></td>
            <td><form action={saveZone} style={{ display: "flex", gap: ".25rem" }}><input type="hidden" name="id" value={z.id} /><input name="price" type="number" step="1" min="0" defaultValue={Number(z.price_cents) / 100} style={{ width: 100 }} /><label><input type="checkbox" name="active" defaultChecked={z.active} /> activa</label><button className="btn btn-outline" style={{ minHeight: 32 }}>Guardar</button></form></td></tr>
        ))}
      </tbody></table>

      <h2>Reglas mayoristas</h2>
      <table><thead><tr><th>Versión</th><th>Activa</th><th>Umbral 1ª compra</th><th>Umbral re-stock</th><th>Pesos</th><th>Notas</th></tr></thead><tbody>
        {rules?.map((r) => <tr key={r.id}><td>{r.version}</td><td>{r.active ? "sí" : ""}</td><td>{r.first_purchase_threshold}</td><td>{r.restock_threshold}</td><td><pre>{JSON.stringify(r.groups, null, 1)}</pre></td><td><small>{r.notes}</small></td></tr>)}
      </tbody></table>
      <p><small>Para cambiar reglas se crea una nueva versión (los pedidos guardan la versión aplicada).</small></p>

      <h2>Parámetros</h2>
      {settings?.map((s) => (
        <form key={s.key} action={saveSetting} style={{ marginBottom: "1rem" }}>
          <input type="hidden" name="key" value={s.key} />
          <label><strong>{s.key}</strong> {s.is_public && <span className="badge">público</span>}</label>
          <textarea name="value" rows={8} defaultValue={JSON.stringify(s.value, null, 2)} style={{ width: "100%", fontFamily: "monospace" }} />
          <button className="btn btn-outline">Guardar {s.key}</button>
        </form>
      ))}
    </>
  );
}
