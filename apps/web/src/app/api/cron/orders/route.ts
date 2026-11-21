import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { runOrderDispatch } from "@/lib/order-dispatch";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Despacha el outbox de pedidos hacia AstroSelling (o el sink configurado). */
async function handler(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runOrderDispatch());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
export { handler as GET, handler as POST };
