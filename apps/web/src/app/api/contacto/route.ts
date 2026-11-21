import { NextResponse } from "next/server";
import { z } from "zod";
import { sendContactEmail } from "@/lib/email";
import { adminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(160),
  message: z.string().trim().min(1).max(4000),
  honeypot: z.string().max(0).optional(), // campo oculto del form de Elementor: si viene lleno es spam
});

// Límite simple por IP (por instancia): 5 mensajes cada 10 minutos
const hits = new Map<string, number[]>();

/** Formulario de Contacto (mismo form de Elementor; fz.js lo envía acá). Nunca se pierde: si falla el email queda en auditoría. */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "?";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 600_000);
  if (recent.length >= 5) return NextResponse.json({ success: false, message: "Demasiados mensajes. Probá en unos minutos." }, { status: 429 });
  hits.set(ip, [...recent, now]);

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, message: "Revisá los campos del formulario." }, { status: 422 });
  if (parsed.data.honeypot) return NextResponse.json({ success: true, message: "El formulario se envió correctamente." });
  const { name, email, message } = parsed.data;
  const r = await sendContactEmail({ name, email, message });
  await adminClient().from("audit_logs").insert({ action: r.sent ? "contact_message" : "contact_message_unsent", entity: "contact", after: { name, email, message: message.slice(0, 4000), error: r.error?.slice(0, 200) ?? null } });
  return NextResponse.json({ success: true, message: "El formulario se envió correctamente." });
}
