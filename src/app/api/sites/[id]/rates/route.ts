import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { validatePlan, type Promotion, type RatePlan } from "@/lib/billing/fee";
import { dbConfigured, tx } from "@/lib/db";
import { accounts, auditEntries, rateSchedules, siteRecords } from "@/lib/mock/tenancy";
import { can } from "@/lib/permissions";

// Mock：儲存場站費率並「下發」到 Edge。
// 正式版：寫入 fee_rate_versions（新版本、不覆蓋舊版本）→ 推送給該站 Edge → Edge 回報已套用版本；
// 進行中的停車紀錄仍以入場時的費率計算。全程寫入 audit_logs（修改前後內容）。
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const site = siteRecords.find((s) => s.id === id);
  if (!site) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!can(user, "rate.publish", { orgId: site.orgId, siteId: site.id })) {
    return NextResponse.json({ error: "forbidden", message: "你沒有修改這個站點費率的權限。" }, { status: 403 });
  }

  const b = (await req.json().catch(() => null)) as { base?: RatePlan; promotions?: Promotion[]; reason?: string } | null;
  if (!b?.base || !Array.isArray(b.promotions)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const problem = validatePlan(b.base);
  if (problem) return NextResponse.json({ error: "invalid", message: problem }, { status: 422 });
  for (const p of b.promotions) {
    if (!p.name?.trim() || Number.isNaN(Date.parse(p.startsAt)) || Number.isNaN(Date.parse(p.endsAt)) || Date.parse(p.endsAt) <= Date.parse(p.startsAt)) {
      return NextResponse.json({ error: "invalid", message: "促銷檔期需要名稱，且結束時間要晚於開始時間。" }, { status: 422 });
    }
    const pp = validatePlan({ ...b.base, ...p.overrides });
    if (pp) return NextResponse.json({ error: "invalid", message: `促銷「${p.name}」：${pp}` }, { status: 422 });
  }
  const sorted = [...b.promotions].sort((x, y) => Date.parse(x.startsAt) - Date.parse(y.startsAt));
  for (let i = 1; i < sorted.length; i++) {
    if (Date.parse(sorted[i].startsAt) < Date.parse(sorted[i - 1].endsAt)) {
      return NextResponse.json({ error: "invalid", message: `促銷「${sorted[i - 1].name}」與「${sorted[i].name}」時間重疊。` }, { status: 422 });
    }
  }
  if (!b.reason?.trim()) return NextResponse.json({ error: "invalid", message: "請填寫修改原因。" }, { status: 422 });

  // 有雲端資料庫：新增一個費率版本（舊版本保留、結束生效），工控機下次心跳會看到設定版本變更並重新下載
  if (dbConfigured()) {
    const email = accounts.find((a) => a.id === user.id)?.email ?? "";
    const saved = await tx(async (c) => {
      const s = (await c.query("SELECT id FROM sites WHERE code = $1", [site.code])).rows[0];
      if (!s) return false;
      const u = (await c.query("SELECT id FROM users WHERE email = $1", [email])).rows[0];
      await c.query("UPDATE fee_rate_versions SET effective_to = now() WHERE site_id = $1 AND effective_to IS NULL", [s.id]);
      await c.query(
        `INSERT INTO fee_rate_versions (site_id, version_no, rules, effective_from, approved_by)
         SELECT $1, COALESCE(max(version_no), 0) + 1, $2, now(), $3 FROM fee_rate_versions WHERE site_id = $1`,
        [s.id, JSON.stringify({ base: b.base, promotions: sorted }), u?.id ?? null]);
      return true;
    }).catch((e) => { console.error("[rates db]", e); return null; });
    if (saved === null) return NextResponse.json({ error: "server_error", message: "費率寫入雲端資料庫失敗，請再試一次。" }, { status: 500 });
  }

  const prev = rateSchedules[id];
  const next = { base: b.base, promotions: sorted, version: (prev?.version ?? 0) + 1, updatedAt: new Date().toISOString(), updatedBy: user.name };
  rateSchedules[id] = next;
  auditEntries.unshift({ at: next.updatedAt, actor: user.name, action: "修改費率", target: `${site.name}・第 ${next.version} 版`, orgId: site.orgId, reason: b.reason.trim() });
  return NextResponse.json({ version: next.version, edge: "queued", mock: !dbConfigured() });
}
