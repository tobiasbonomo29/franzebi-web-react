import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { env } from "./env";

/** Cliente con la sesión del usuario (anon key + cookies). Respeta RLS. */
export async function userClient(): Promise<SupabaseClient> {
  const store = await cookies();
  const e = env();
  return createServerClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list: Array<{ name: string; value: string; options: CookieOptions }>) => {
        try {
          for (const c of list) store.set(c.name, c.value, c.options);
        } catch {
          /* llamado desde un Server Component: el middleware refresca la sesión */
        }
      },
    },
  });
}

let admin: SupabaseClient | null = null;
/** Cliente SERVICE ROLE: bypassa RLS. Sólo en route handlers/acciones de servidor tras validar permisos. */
export function adminClient(): SupabaseClient {
  if (admin) return admin;
  const e = env();
  admin = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

/** Cliente público anónimo sin cookies (para páginas de catálogo cacheables). */
export function publicClient(): SupabaseClient {
  const e = env();
  return createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
}
