import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { userClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
const schema = z.object({ email: z.string().trim().email().max(160) });

/** Registro como en Woo: sólo email; se envía un enlace para establecer la contraseña. */
export async function POST(req: Request) {
  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ message: "Ingresá una dirección de correo electrónico válida." }, { status: 422 });
  const sb = await userClient();
  await sb.auth.signInWithOtp({ email: p.data.email, options: { shouldCreateUser: true, emailRedirectTo: `${env().SITE_URL}/mi-cuenta/restablecer/` } });
  // Mismo mensaje exista o no la cuenta (no revela emails registrados)
  return NextResponse.json({ message: "Te enviamos un enlace a tu correo electrónico para establecer tu contraseña." });
}
