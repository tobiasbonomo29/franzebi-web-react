import { NextResponse } from "next/server";
import { MiCorreoClient, type CorreoAgency } from "@/lib/correo";

export const dynamic = "force-dynamic";

const cache = new Map<string, { at: number; list: CorreoAgency[] }>();

/** Sucursales de Correo Argentino por provincia (para "a sucursal" en el checkout). Cache 12 h por instancia. */
export async function GET(req: Request) {
  const state = new URL(req.url).searchParams.get("state")?.toUpperCase() ?? "";
  const hit = cache.get(state);
  if (hit && Date.now() - hit.at < 12 * 3600_000) return NextResponse.json({ agencies: hit.list });
  const client = MiCorreoClient.fromEnvClient();
  if (!client) return NextResponse.json({ agencies: [], error: "Correo Argentino no configurado" }, { status: 503 });
  try {
    const list = await client.agencies(state);
    cache.set(state, { at: Date.now(), list });
    return NextResponse.json({ agencies: list });
  } catch (e) {
    console.error("[correo] agencies", (e as Error).message.slice(0, 120));
    return NextResponse.json({ agencies: [], error: "No pudimos obtener las sucursales" }, { status: 502 });
  }
}
