import type { Metadata } from "next";
import { env } from "@/lib/env";
import { ResetForm } from "./ResetForm";

export const metadata: Metadata = { title: "Nueva contraseña", robots: { index: false, follow: false } };

export default function ResetPage() {
  const e = env();
  return (
    <div className="container" style={{ maxWidth: 520 }}>
      <h1>Crear nueva contraseña</h1>
      <ResetForm supabaseUrl={e.NEXT_PUBLIC_SUPABASE_URL} anonKey={e.NEXT_PUBLIC_SUPABASE_ANON_KEY} />
    </div>
  );
}
