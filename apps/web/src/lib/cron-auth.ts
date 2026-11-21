import "server-only";
import { timingSafeEqual } from "node:crypto";
import { env } from "./env";

/** Vercel Cron envía `Authorization: Bearer $CRON_SECRET`. */
export function isCronAuthorized(req: Request) {
  const got = Buffer.from(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
  const want = Buffer.from(env().CRON_SECRET);
  return got.length === want.length && timingSafeEqual(got, want);
}
