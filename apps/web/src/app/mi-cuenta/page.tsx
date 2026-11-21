import type { Metadata } from "next";
import Link from "next/link";
import { formatArs } from "@franzebi/domain";
import { getSessionProfile } from "@/lib/auth";
import { env } from "@/lib/env";
import { userClient } from "@/lib/supabase";
import { AuthForms } from "./AuthForms";

export const metadata: Metadata = { title: "Mi cuenta", robots: { index: false, follow: true } };

const STATUS: Record<string, string> = { on_hold: "En espera", processing: "Procesando", completed: "Completado", cancelled: "Cancelado", refunded: "Reembolsado", pending: "Pendiente", failed: "Fallido" };

export default async function Account() {
  const profile = await getSessionProfile();
  if (!profile) {
    const e = env();
    return (
      <div className="container" style={{ maxWidth: 520 }}>
        <h1>Mi cuenta</h1>
        <p className="notice">¿Ya eras cliente en la tienda anterior? Tu cuenta fue migrada: usá <strong>“Olvidé mi contraseña”</strong> con tu email para crear una contraseña nueva.</p>
        <AuthForms supabaseUrl={e.NEXT_PUBLIC_SUPABASE_URL} anonKey={e.NEXT_PUBLIC_SUPABASE_ANON_KEY} siteUrl={e.SITE_URL} />
      </div>
    );
  }
  const sb = await userClient(); // RLS: sólo sus pedidos
  const { data: orders } = await sb.from("orders").select("number, status, total_cents, placed_at, delivery_label").order("placed_at", { ascending: false }).limit(50);
  return (
    <div className="container">
      <h1>Mi cuenta</h1>
      <p>Hola {profile.fullName ?? profile.email}. {profile.role === "wholesale" && <span className="badge">Cliente mayorista</span>}</p>
      {(profile.role === "admin" || profile.role === "operator") && <p><Link className="btn btn-outline" href="/admin/">Panel de administración</Link></p>}
      <h2>Mis pedidos</h2>
      {!orders?.length ? <p>Todavía no hiciste pedidos.</p> : (
        <table className="cart-table">
          <thead><tr><th>Pedido</th><th>Fecha</th><th>Entrega</th><th>Estado</th><th className="num">Total</th></tr></thead>
          <tbody>{orders.map((o) => (
            <tr key={o.number}>
              <td className="name">#{o.number}</td>
              <td data-label="Fecha">{new Date(o.placed_at).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}</td>
              <td data-label="Entrega">{o.delivery_label}</td>
              <td data-label="Estado">{STATUS[o.status] ?? o.status}</td>
              <td className="num" data-label="Total">{formatArs(Number(o.total_cents))}</td>
            </tr>))}
          </tbody>
        </table>
      )}
    </div>
  );
}
