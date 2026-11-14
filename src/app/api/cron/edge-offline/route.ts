import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { dbConfigured, pool } from "@/lib/db";
import { checkEdgeOffline } from "@/lib/alerts/edgeOffline";
import { sendAlertMail } from "@/lib/alerts/mailer";

// POST /api/cron/edge-offline：Cloud Scheduler 每分鐘呼叫。Authorization: Bearer <CRON_SECRET>
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const ok = secret.length >= 16 && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!dbConfigured()) return NextResponse.json({ error: "db_not_configured" }, { status: 503 });
  const r = await checkEdgeOffline(pool(), sendAlertMail);
  return NextResponse.json(r, { headers: { "cache-control": "no-store" } });
}
