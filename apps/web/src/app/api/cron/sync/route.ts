import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { runSync } from "@/lib/sync-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Vercel Cron (GET) o scheduler externo (POST), con Authorization: Bearer CRON_SECRET. */
async function handler(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const r = await runSync({ apply: true, trigger: "cron" }); // escribe sólo si SYNC_ALLOW_APPLY=true
    return NextResponse.json({ jobId: r.jobId, stats: r.stats });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
export { handler as GET, handler as POST };
