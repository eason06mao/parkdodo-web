import type { Metadata } from "next";
import Link from "next/link";
import { Chip } from "@/components/Chip";
import { getCurrentUser } from "@/lib/auth";
import { getMonthlyPlans, getMonthlyRecords, getSiteRecords } from "@/lib/data";
import { contractState, daysBetween, EXPIRING_DAYS, PLAN_TYPE_LABELS, STATE_LABELS, todayTaipei, type ContractState } from "@/lib/monthly";
import { can } from "@/lib/permissions";
import type { ChipTone } from "@/lib/types";

export const metadata: Metadata = { title: "月租管理" };
export const dynamic = "force-dynamic";

const TONE: Record<ContractState, ChipTone> = { pending: "info", active: "ok", expiring: "warn", expired: "neutral", suspended: "danger", cancelled: "neutral" };
const md = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}`;

export default async function MonthlyPage({ searchParams }: { searchParams: Promise<{ q?: string; plan?: string; state?: string }> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const [records, plans, sites] = await Promise.all([getMonthlyRecords(user), getMonthlyPlans(user), getSiteRecords(user)]);
  const canCreate = sites.some((s) => can(user, "monthly.manage", { orgId: s.orgId, siteId: s.id }));
  const today = todayTaipei();
  const rows = records.map((r) => ({ r, state: contractState(r, today), plan: plans.find((p) => p.id === r.planId) }));
  const q = (sp.q ?? "").trim().toUpperCase().replace(/[\s-]/g, "");
  const shown = rows.filter(({ r, state, plan }) =>
    (!q || r.customer.name.toUpperCase().includes(q) || r.customer.phone.replace(/\D/g, "").includes(q) || r.contractNo.toUpperCase().includes(q)
      || r.vehicles.some((x) => x.plate.replace("-", "").includes(q)) || r.customer.companyName.toUpperCase().includes(q))
    && (!sp.plan || plan?.type === sp.plan) && (!sp.state || state === sp.state));

  const count = (f: (x: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  const liveState = (s: ContractState) => s === "active" || s === "expiring";
  const fixed = count((x) => x.plan?.type === "fixed" && liveState(x.state));
  const shared = count((x) => x.plan?.type === "shared" && liveState(x.state));
  const expiring = count((x) => x.state === "expiring");
  const pending = count((x) => x.state === "pending");

  return (
    <main className="pd-main">
      <header className="pd-page-head">
        <div>
          <nav aria-label="路徑" className="pd-label"><Link href="/console">營運總覽</Link> ／ 月租管理</nav>
          <h1 className="pd-page-title">月租管理</h1>
        </div>
        {canCreate && <Link href="/console/monthly/new" className="pd-btn pd-btn--primary">新增月租</Link>}
      </header>

      <section aria-label="月租概況" className="pd-grid pd-grid-4">
        <div className="pd-card"><div className="pd-label">固定車位（有效）</div><div style={{ marginTop: 8 }}><span className="pd-mono" style={{ fontSize: 32, fontWeight: 600 }}>{fixed}</span><span className="pd-label"> 份</span></div></div>
        <div className="pd-card"><div className="pd-label">共用月租（有效）</div><div style={{ marginTop: 8 }}><span className="pd-mono" style={{ fontSize: 32, fontWeight: 600 }}>{shared}</span><span className="pd-label"> 份</span></div></div>
        <Link href="/console/monthly?state=expiring" className={`pd-card${expiring ? " pd-card--warn" : ""}`} style={{ textDecoration: "none", color: "inherit" }}>
          <div className="pd-label" style={expiring ? { color: "var(--pd-warn-ink)" } : undefined}>{EXPIRING_DAYS} 天內到期</div>
          <div style={{ marginTop: 8 }}><span className="pd-mono" style={{ fontSize: 32, fontWeight: 600, color: expiring ? "var(--pd-warn-ink)" : undefined }}>{expiring}</span><span className="pd-label"> 份</span></div>
        </Link>
        <Link href="/console/monthly?state=pending" className="pd-card" style={{ textDecoration: "none", color: "inherit" }}>
          <div className="pd-label">待開通（未付款或未到啟用日）</div><div style={{ marginTop: 8 }}><span className="pd-mono" style={{ fontSize: 32, fontWeight: 600 }}>{pending}</span><span className="pd-label"> 份</span></div>
        </Link>
      </section>

      <section aria-label="月租合約" className="pd-card" style={{ padding: 0, overflow: "hidden" }}>
        <form role="search" aria-label="篩選月租" style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: "16px 18px", borderBottom: "1px solid var(--pd-line-soft)", alignItems: "flex-end" }}>
          <div className="pd-field" style={{ flex: "1 1 220px" }}><label htmlFor="q">搜尋車牌、姓名、電話或合約編號</label><input id="q" name="q" className="pd-input" defaultValue={sp.q ?? ""} placeholder="ABC-1234、王小明、0912…" /></div>
          <div className="pd-field" style={{ flex: "0 1 150px" }}><label htmlFor="plan">方案</label>
            <select id="plan" name="plan" className="pd-select" defaultValue={sp.plan ?? ""}><option value="">全部</option><option value="fixed">固定車位</option><option value="shared">共用月租</option></select></div>
          <div className="pd-field" style={{ flex: "0 1 150px" }}><label htmlFor="st">狀態</label>
            <select id="st" name="state" className="pd-select" defaultValue={sp.state ?? ""}><option value="">全部</option>
              {(Object.keys(STATE_LABELS) as ContractState[]).map((s) => <option key={s} value={s}>{STATE_LABELS[s]}</option>)}</select></div>
          <button type="submit" className="pd-btn">篩選</button>
          {(sp.q || sp.plan || sp.state) && <Link href="/console/monthly" className="pd-btn">清除</Link>}
        </form>
        <div className="pd-table-wrap">
          <table className="pd-table">
            <thead><tr><th>客戶</th><th>車牌</th><th>方案</th><th>期間</th><th>剩餘</th><th>付款</th><th>狀態</th><th><span className="pd-sr-only">操作</span></th></tr></thead>
            <tbody>
              {shown.map(({ r, state, plan }) => {
                const left = daysBetween(today, r.endsOn);
                return (
                  <tr key={r.id}>
                    <td><div style={{ fontWeight: 500 }}>{r.customer.type === "company" ? r.customer.companyName : r.customer.name}</div><div className="pd-label pd-mono">{r.contractNo}</div></td>
                    <td>{r.vehicles.map((x) => <div key={x.plate}><span className="pd-plate">{x.plate}</span></div>)}</td>
                    <td><Chip tone={plan?.type === "fixed" ? "info" : "ok"}>{plan ? PLAN_TYPE_LABELS[plan.type] : "—"}</Chip>{r.space && <span className="pd-mono pd-label">　{r.space}</span>}</td>
                    <td className="pd-mono">{md(r.startsOn)} – {md(r.endsOn)}</td>
                    <td className="pd-mono">{state === "expired" || state === "cancelled" ? "—" : `${left} 天`}</td>
                    <td>{r.paymentStatus === "paid" ? <span className="pd-label">已付款</span> : <Chip tone="warn">待付款</Chip>}</td>
                    <td><Chip tone={TONE[state]}>{STATE_LABELS[state]}</Chip></td>
                    <td><Link href={`/console/monthly/${r.id}`}>管理</Link></td>
                  </tr>
                );
              })}
              {shown.length === 0 && <tr><td colSpan={8} className="pd-label" style={{ textAlign: "center", padding: 28 }}>沒有符合條件的合約。</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
