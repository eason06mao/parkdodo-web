import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { dbConfigured, tx } from "@/lib/db";
import { EdgeError, requestGateCommand } from "@/lib/edge/service";
import { accounts, auditEntries, siteRecords } from "@/lib/mock/tenancy";
import { can } from "@/lib/permissions";
import { GATE_REASONS } from "@/lib/types";

// 遠端開閘：寫入 gate_commands（30 秒內有效），由現場工控機長輪詢取回、透過相機繼電器開閘，再回報結果。
// 雲端資料庫尚未設定時只驗證欄位（Mock）。
// TODO 正式版：MFA 驗證；hold_open 需第二人核准。
export async function POST(req: Request) {
  const user = await getCurrentUser();
  const b = (await req.json().catch(() => null)) as { siteId?: string; laneCode?: string; plate?: string; reasonCode?: string; reasonNote?: string; idempotencyKey?: string } | null;
  if (!b?.siteId || !b.laneCode || !b.idempotencyKey) return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  if (!GATE_REASONS.some((r) => r.code === b.reasonCode)) return NextResponse.json({ error: "invalid_reason" }, { status: 400 });
  if (b.reasonCode === "other" && !b.reasonNote?.trim()) return NextResponse.json({ error: "reason_note_required", message: "原因選「其他」時，請填寫補充說明。" }, { status: 400 });

  const site = siteRecords.find((s) => s.id === b.siteId);
  if (!site) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!can(user, "gate.remote_open", { orgId: site.orgId, siteId: site.id })) {
    return NextResponse.json({ error: "forbidden", message: "你沒有這個站點的遠端開閘權限。" }, { status: 403 });
  }
  const binding = user.bindings.find((x) => x.orgId === site.orgId || user.isHq);

  if (!dbConfigured()) {
    return NextResponse.json({ id: `mock-${Date.now()}`, status: "requested", expiresAt: new Date(Date.now() + 30_000).toISOString(), mock: true }, { status: 202 });
  }
  try {
    const r = await tx((c) => requestGateCommand(c, {
      siteCode: site.code, laneCode: b.laneCode!, reasonCode: b.reasonCode!, reasonNote: b.reasonNote?.trim() || undefined,
      requestedByEmail: accounts.find((a) => a.id === user.id)?.email ?? "", requestedRole: binding?.role ?? "hq_ops",
      idempotencyKey: b.idempotencyKey!, plate: b.plate,
    }));
    auditEntries.unshift({ at: new Date().toISOString(), actor: user.name, action: "遠端開閘", target: `${site.name}・${b.laneCode}`, orgId: site.orgId,
      reason: GATE_REASONS.find((x) => x.code === b.reasonCode)?.label });
    return NextResponse.json(r, { status: 202 });
  } catch (e) {
    if (e instanceof EdgeError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    console.error("[gate-commands]", e);
    return NextResponse.json({ error: "server_error", message: "送出失敗，請再試一次。" }, { status: 500 });
  }
}
