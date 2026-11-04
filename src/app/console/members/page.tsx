import type { Metadata } from "next";
import Link from "next/link";
import { Chip } from "@/components/Chip";
import { Forbidden } from "@/components/Forbidden";
import { getCurrentUser } from "@/lib/auth";
import { getMonthlyPlans, getSiteRecords } from "@/lib/data";
import { formatPhone, LEAD_STATUS_LABELS, maskPhone, PROVIDER_LABELS, type LeadStatus } from "@/lib/members";
import { listLeads, listMembers } from "@/lib/membersServer";
import { can } from "@/lib/permissions";
import type { ChipTone } from "@/lib/types";
import { LeadActions } from "./LeadActions";

export const metadata: Metadata = { title: "會員與月租登記" };
export const dynamic = "force-dynamic";

const TONE: Record<LeadStatus, ChipTone> = { new: "warn", contacted: "info", converted: "ok", closed: "neutral" };
const dt = (iso: string) => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const [sites, plans] = await Promise.all([getSiteRecords(user), getMonthlyPlans(user)]);
  const allowed = sites.filter((s) => can(user, "monthly.manage", { orgId: s.orgId, siteId: s.id }));
  if (!allowed.length) return <Forbidden title="無法查看會員" message="你沒有任何站點的月租管理權限。" />;
  const codes = allowed.map((s) => s.code);
  const [leads, members] = await Promise.all([listLeads(codes), listMembers(codes)]);
  const siteName = (code: string | null) => allowed.find((s) => s.code === code)?.name ?? "—";
  const showAll = sp.show === "all";
  const shownLeads = showAll ? leads : leads.filter((l) => l.status === "new" || l.status === "contacted");
  const openCount = leads.filter((l) => l.status === "new").length;
  const joinUrl = `/join?site=${allowed[0].code}`;

  return (
    <main className="pd-main">
      <header className="pd-page-head">
        <div>
          <nav aria-label="路徑" className="pd-label"><Link href="/console">營運總覽</Link> ／ 會員與月租登記</nav>
          <h1 className="pd-page-title">會員與月租登記</h1>
        </div>
        <Link href={joinUrl} className="pd-btn" target="_blank">開啟會員加入頁</Link>
      </header>

      <section aria-labelledby="leads-h" className="pd-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "16px 18px", borderBottom: "1px solid var(--pd-line-soft)" }}>
          <div>
            <h2 id="leads-h" className="pd-section-title">月租登記單</h2>
            <p className="pd-label" style={{ margin: "4px 0 0" }}>附近住戶、車主線上登記想租月租。{openCount > 0 ? `${openCount} 張還沒聯絡。` : "目前沒有待聯絡的登記。"}</p>
          </div>
          <Link href={showAll ? "/console/members" : "/console/members?show=all"} className="pd-btn">{showAll ? "只看處理中" : "顯示全部（含已建約、不租了）"}</Link>
        </div>
        <div className="pd-table-wrap">
          <table className="pd-table">
            <thead><tr><th>登記</th><th>稱呼／聯絡手機</th><th>停車場／方案</th><th>車牌</th><th>想說的話</th><th>狀態</th><th><span className="pd-sr-only">操作</span></th></tr></thead>
            <tbody>
              {shownLeads.map((l) => (
                <tr key={l.id}>
                  <td className="pd-mono">{dt(l.createdAt)}</td>
                  <td><div style={{ fontWeight: 500 }}>{l.name}</div><a className="pd-mono" href={`tel:${l.phone}`}>{formatPhone(l.phone)}</a></td>
                  <td><div>{siteName(l.siteCode)}</div><div className="pd-label">{l.planName ?? "還不確定"}{l.planId && (() => { const p = plans.find((x) => x.id === l.planId); return p ? `・NT$${p.monthlyPrice.toLocaleString()}/月` : ""; })()}</div></td>
                  <td>{l.plates.length ? l.plates.map((p) => <div key={p} className="pd-plate">{p}</div>) : <span className="pd-label">—</span>}</td>
                  <td style={{ whiteSpace: "normal", maxWidth: 260 }}>{l.note || <span className="pd-label">—</span>}</td>
                  <td><Chip tone={TONE[l.status]}>{LEAD_STATUS_LABELS[l.status]}</Chip>{l.updatedBy && l.status !== "new" && <div className="pd-label">{l.updatedBy}</div>}</td>
                  <td><LeadActions id={l.id} status={l.status} /></td>
                </tr>
              ))}
              {shownLeads.length === 0 && <tr><td colSpan={7} className="pd-label" style={{ textAlign: "center", padding: 28 }}>沒有月租登記單。</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="members-h" className="pd-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--pd-line-soft)" }}>
          <h2 id="members-h" className="pd-section-title">會員</h2>
          <p className="pd-label" style={{ margin: "4px 0 0" }}>共 <span className="pd-mono">{members.length}</span> 位（依加入的站點）。手機只顯示部分號碼。</p>
        </div>
        <div className="pd-table-wrap">
          <table className="pd-table">
            <thead><tr><th>加入</th><th>稱呼</th><th>登入方式</th><th>手機</th><th>車牌</th><th>加入站點</th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td className="pd-mono">{dt(m.createdAt)}</td>
                  <td>{m.name || <span className="pd-label">未填</span>}</td>
                  <td><div style={{ display: "flex", gap: 6 }}>{m.providers.map((p) => <Chip key={p} tone={p === "line" ? "ok" : p === "google" ? "info" : "neutral"}>{PROVIDER_LABELS[p]}</Chip>)}</div></td>
                  <td className="pd-mono">{m.phone ? maskPhone(m.phone) : <span className="pd-label">—</span>}</td>
                  <td>{m.plates.length ? m.plates.map((p) => <div key={p} className="pd-plate">{p}</div>) : <span className="pd-label">—</span>}</td>
                  <td>{siteName(m.sourceSiteCode)}</td>
                </tr>
              ))}
              {members.length === 0 && <tr><td colSpan={6} className="pd-label" style={{ textAlign: "center", padding: 28 }}>還沒有會員。</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
