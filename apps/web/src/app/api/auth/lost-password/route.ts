import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { userClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
const schema = z.object({ user_login: z.string().trim().email().max(160) });

/** "¿Olvidaste la contraseña?" (lost-password de Woo). */
export async function POST(req: Request) {
  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ message: "Introduce un correo electrónico válido." }, { status: 422 });
  const sb = await userClient();
  await sb.auth.resetPasswordForEmail(p.data.user_login, { redirectTo: `${env().SITE_URL}/mi-cuenta/restablecer/` });
  return NextResponse.json({ message: "Se ha enviado un correo electrónico para restablecer la contraseña. Puede tardar unos minutos en aparecer en tu bandeja de entrada." });
}
