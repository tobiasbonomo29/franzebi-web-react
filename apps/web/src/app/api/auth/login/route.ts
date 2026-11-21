import { NextResponse } from "next/server";
import { z } from "zod";
import { userClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
const schema = z.object({ username: z.string().trim().email().max(160), password: z.string().min(1).max(200) });

/** Login del form de Woo (username = email). La sesión queda en cookies httpOnly de Supabase SSR. */
export async function POST(req: Request) {
  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ message: "Ingresá tu correo electrónico y contraseña." }, { status: 422 });
  const sb = await userClient();
  const { error } = await sb.auth.signInWithPassword({ email: p.data.username, password: p.data.password });
  if (error) return NextResponse.json({ message: "Error: el correo electrónico o la contraseña no son correctos. ¿Olvidaste la contraseña? Si eras cliente de la tienda anterior, creá una nueva desde “¿Olvidaste la contraseña?”." }, { status: 401 });
  const next = new URL(req.headers.get("referer") ?? "http://x/mi-cuenta/").searchParams.get("next");
  return NextResponse.json({ redirect: next && next.startsWith("/") && !next.startsWith("//") ? next : "/mi-cuenta/" });
}
