import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { dbConfigured } from "@/lib/db";
import { createPairingForSite } from "@/lib/edge/console";
import { accounts, auditEntries, siteRecords } from "@/lib/mock/tenancy";
import { can } from "@/lib/permissions";

// POST：產生工控機配對碼（僅總部 edge.pair）。10 分鐘內有效、只能用一次；同站點舊的未使用配對碼一併作廢。
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const site = siteRecords.find((s) => s.id === id);
  if (!site) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!can(user, "edge.pair")) return NextResponse.json({ error: "forbidden", message: "工控機配對只限總部。" }, { status: 403 });
  if (!dbConfigured()) return NextResponse.json({ error: "db_not_configured", message: "雲端資料庫尚未設定，這組配對碼只是示意。" }, { status: 503 });

  const email = accounts.find((a) => a.id === user.id)?.email ?? "";
  const r = await createPairingForSite(site.code, `${site.name}工控機`, email);
  if (!r) return NextResponse.json({ error: "not_found", message: `雲端資料庫沒有站點 ${site.code}。` }, { status: 404 });
  auditEntries.unshift({ at: new Date().toISOString(), actor: user.name, action: "產生配對碼", target: `${site.name}（${site.code}）`, orgId: site.orgId });
  return NextResponse.json({ code: r.code, expiresAt: r.expiresAt }, { status: 201, headers: { "cache-control": "no-store" } });
}
