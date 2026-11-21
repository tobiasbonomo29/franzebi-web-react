import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = await requireStaff();
  return (
    <div className="admin">
      <nav aria-label="Administración">
        <p><strong>Franzebi Admin</strong><br /><small>{me.email} · {me.role}</small></p>
        <Link href="/admin/">Resumen</Link>
        <Link href="/admin/pedidos/">Pedidos</Link>
        <Link href="/admin/productos/">Productos y stock</Link>
        <Link href="/admin/sync/">Sincronización</Link>
        <Link href="/admin/clientes/">Clientes</Link>
        {me.role === "admin" && <Link href="/admin/configuracion/">Configuración</Link>}
        {me.role === "admin" && <Link href="/admin/auditoria/">Auditoría</Link>}
        <Link href="/">← Ver tienda</Link>
      </nav>
      <main>{children}</main>
    </div>
  );
}
