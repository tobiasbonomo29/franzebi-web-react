import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatArs, whatsappReceiptUrl } from "@franzebi/domain";
import { verifyOrderAccessToken } from "@/lib/order-token";
import { getSessionProfile } from "@/lib/auth";
import { env } from "@/lib/env";
import { adminClient } from "@/lib/supabase";

export const metadata: Metadata = { title: "Pedido recibido", robots: { index: false, follow: false } };

/** Página de gracias. Sólo para el dueño logueado, staff, o quien trae el token HMAC emitido al confirmar. */
export default async function OrderThanks({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ t?: string }> }) {
  const n = Number((await params).number);
  const token = (await searchParams).t;
  if (!Number.isInteger(n)) notFound();
  const db = adminClient();
  const { data: o } = await db.from("orders").select("id, number, user_id, status, payment_method, delivery_label, total_cents, placed_at, estimated_delivery").eq("number", n).maybeSingle();
  if (!o) notFound();
  const profile = await getSessionProfile();
  const allowed = (profile && o.user_id === profile.id) || profile?.role === "admin" || profile?.role === "operator" || verifyOrderAccessToken(o.id, token);
  if (!allowed) notFound();
  const bank = env().BANK_TRANSFER_DETAILS;
  return (
    <div className="container" style={{ maxWidth: 720 }}>
      <h1>¡Gracias! Recibimos tu pedido #{o.number}</h1>
      <p className="notice">Entrega: {o.delivery_label}{o.estimated_delivery ? ` · ${o.estimated_delivery}` : ""}<br />Total: <strong>{formatArs(Number(o.total_cents))}</strong></p>
      {o.payment_method === "bank_transfer" && (
        <div className="notice warn">
          <p><strong>Tu pedido está En espera</strong> hasta que validemos la transferencia.</p>
          {bank && <p style={{ whiteSpace: "pre-line" }}>{bank}</p>}
          <p>Usá el número de pedido <strong>#{o.number}</strong> como referencia.</p>
          <a className="btn btn-wa" href={whatsappReceiptUrl(o.number)} target="_blank" rel="noopener">Enviar comprobante por WhatsApp</a>
        </div>
      )}
      {o.payment_method === "cash" && <p className="notice">Abonás en efectivo al retirar, con 5% de descuento ya aplicado.</p>}
      <p>Te enviamos la confirmación por email.</p>
    </div>
  );
}
