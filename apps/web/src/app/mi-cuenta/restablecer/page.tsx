import type { Metadata } from "next";
import { LegacyPage } from "@/components/LegacyPage";
import { LegacyPortal } from "@/components/LegacyPortal";
import { env } from "@/lib/env";
import { ResetForm } from "./ResetForm";

export const metadata: Metadata = { title: { absolute: "Mi cuenta – Franzebi Imports – Los Mejores Precios" }, robots: { index: false, follow: false } };

/** Crear/cambiar contraseña (llega desde el email de registro o de "¿Olvidaste la contraseña?"). */
export default function ResetPage() {
  const e = env();
  return (
    <LegacyPage name="account" values={{ account: `<div class="woocommerce-notices-wrapper"></div><div id="fz-reset-root"></div>` }}>
      <LegacyPortal target="fz-reset-root">
        <ResetForm supabaseUrl={e.NEXT_PUBLIC_SUPABASE_URL} anonKey={e.NEXT_PUBLIC_SUPABASE_ANON_KEY} />
      </LegacyPortal>
    </LegacyPage>
  );
}
