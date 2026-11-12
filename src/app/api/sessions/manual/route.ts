import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { quote } from "@/lib/billing/fee";
import { dbConfigured, tx } from "@/lib/db";
import { currentSchedule, normalizePlate as dbPlate } from "@/lib/edge/service";
import { MANUAL_REASONS, normalizePlate, validateManualEntry, type ManualEntryInput } from "@/lib/manualEntry";
import { auditEntries, rateSchedules, siteRecords } from "@/lib/mock/tenancy";
import { can } from "@/lib/permissions";

// 人工補登入場（例如相機漏拍、現場測試）。有雲端資料庫時寫入 parking_sessions，車主即可在繳費頁查到並付款。
// 規則：
//   1. 檢查 session.adjust 權限與站點範圍
//   2. 同站同車牌已有進行中紀錄時拒絕（資料庫 uq_session_open_plate 也會擋）
//   3. 建立 parking_sessions（source = manual，記錄操作人、時間、原因、依據），以該站費率報價
//   4. 車主付款後依一般流程建立出場授權；全程寫入 audit_logs
const openPlates = new Set<string>(["ABC-1234"]); // Mock：目前在場的車

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const v = (await req.json().catch(() => null)) as ManualEntryInput | null;
  if (!v) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const site = siteRecords.find((s) => s.id === v.siteId);
  if (!site) return NextResponse.json({ error: "invalid", message: "站點不存在。" }, { status: 422 });
  if (!can(user, "session.adjust", { orgId: site.orgId, siteId: site.id })) {
    return NextResponse.json({ error: "forbidden", message: "你沒有補登入場紀錄的權限。" }, { status: 403 });
  }
  const errors = validateManualEntry(v);
  if (Object.keys(errors).length) return NextResponse.json({ error: "invalid", errors, message: Object.values(errors)[0] }, { status: 422 });

  const plate = normalizePlate(v.plate);
  const reason = MANUAL_REASONS.find((r) => r.code === v.reason)!.label;
  const audit = (amount: number) => auditEntries.unshift({
    at: new Date().toISOString(), actor: user.name, action: "人工補登入場", orgId: site.orgId,
    target: `${site.name}・${plate}・入場 ${new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "short", timeStyle: "short" }).format(new Date(v.entryAt))}・應付 ${amount} 元`,
    reason: [reason, v.note.trim(), `依據：${v.evidence.trim()}`].filter(Boolean).join("；"),
  });

  if (dbConfigured()) {
    try {
      const r = await tx(async (c) => {
        const s = (await c.query("SELECT id, org_id FROM sites WHERE code = $1", [site.code])).rows[0];
        if (!s) return { error: "這個站點還沒有建立在雲端資料庫。" };
        const rate = await currentSchedule(c, s.id, new Date(v.entryAt));
        if (!rate) return { error: "這個站點尚未設定費率。" };
        const ins = await c.query(
          `INSERT INTO parking_sessions (site_id, org_id, plate_no, session_type, entry_at, fee_rate_version_id)
           VALUES ($1, $2, $3, 'transient', $4, $5) RETURNING id`, [s.id, s.org_id, dbPlate(plate), v.entryAt, rate.id]);
        return { sessionId: ins.rows[0].id as string, amount: quote(rate.schedule, v.entryAt, new Date().toISOString()).amount };
      });
      if ("error" in r) return NextResponse.json({ error: "invalid", message: r.error }, { status: 422 });
      audit(r.amount);
      return NextResponse.json({ sessionId: r.sessionId, plate, amount: r.amount, quotedAt: new Date().toISOString() }, { status: 201 });
    } catch (e) {
      if ((e as { code?: string }).code === "23505") {
        return NextResponse.json({ error: "duplicate", message: `${plate} 在${site.name}已有進行中的停車紀錄，請直接處理該筆紀錄。` }, { status: 409 });
      }
      console.error("[manual entry]", e);
      return NextResponse.json({ error: "server_error", message: "儲存失敗，請再試一次。" }, { status: 500 });
    }
  }

  const key = `${site.id}:${plate.replace("-", "")}`;
  if (openPlates.has(plate) || openPlates.has(key)) {
    return NextResponse.json({ error: "duplicate", message: `${plate} 在${site.name}已有進行中的停車紀錄，請直接處理該筆紀錄。` }, { status: 409 });
  }
  const schedule = rateSchedules[site.id];
  if (!schedule) return NextResponse.json({ error: "invalid", message: "這個站點尚未設定費率。" }, { status: 422 });

  const now = new Date().toISOString();
  const q = quote(schedule, v.entryAt, now);
  openPlates.add(key);
  audit(q.amount);
  return NextResponse.json({ sessionId: `manual-${Date.now()}`, plate, amount: q.amount, quotedAt: now, mock: true }, { status: 201 });
}
