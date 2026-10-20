import type { Metadata } from "next";
import Link from "next/link";
import { Chip } from "@/components/Chip";
import { getCurrentUser } from "@/lib/auth";
import { getOrganizations, getSiteRecords } from "@/lib/data";
import { can, ORG_TYPE_LABELS } from "@/lib/permissions";
import { OPERATION_LABELS, PLAN_LABELS } from "@/lib/siteForm";
import { daysUntil, EDGE_STATUS, SITE_STATUS } from "@/lib/siteLabels";

export const metadata: Metadata = { title: "場站與設備" };
export const dynamic = "force-dynamic";

export default async function SitesPage() {
  const user = await getCurrentUser();
  const [sites, orgs] = await Promise.all([getSiteRecords(user), getOrganizations(user)]);
  const orgName = (id: string) => orgs.find((o) => o.id === id)?.name ?? "—";
  const canCreate = can(user, "site.create");
  const running = sites.filter((s) => s.status === "active" || s.status === "trial").length;
  const planning = sites.filter((s) => s.status === "planning").length;
  const expiring = sites.filter((s) => s.license && daysUntil(s.license.endsOn) <= 30).length;

  return (
    <main className="pd-main">
      <header className="pd-page-head">
        <div>
          <nav aria-label="路徑" className="pd-label"><Link href="/console">營運總覽</Link> ／ 場站與設備</nav>
          <h1 className="pd-page-title">場站與設備</h1>
        </div>
        {canCreate ? (
          <Link href="/console/sites/new" className="pd-btn pd-btn--primary">新增站點</Link>
        ) : (
          <p className="pd-label" style={{ margin: 0, maxWidth: 360 }}>新站點由 ParkDodo 總部建立並配對設備。需要開新站，請聯絡總部業務窗口。</p>
        )}
      </header>

      <section aria-label="站點概況" className="pd-grid pd-grid-4">
        <div className="pd-card"><div className="pd-label">站點</div><div style={{ marginTop: 8 }}><span className="pd-mono" style={{ fontSize: 32, fontWeight: 600 }}>{sites.length}</span><span className="pd-label"> 站</span></div></div>
        <div className="pd-card"><div className="pd-label">營運中／試營運</div><div style={{ marginTop: 8 }}><span className="pd-mono" style={{ fontSize: 32, fontWeight: 600 }}>{running}</span><span className="pd-label"> 站</span></div></div>
        <div className="pd-card"><div className="pd-label">籌備中</div><div style={{ marginTop: 8 }}><span className="pd-mono" style={{ fontSize: 32, fontWeight: 600 }}>{planning}</span><span className="pd-label"> 站</span></div></div>
        <div className={`pd-card${expiring ? " pd-card--warn" : ""}`}><div className="pd-label">授權 30 天內到期</div><div style={{ marginTop: 8 }}><span className="pd-mono" style={{ fontSize: 32, fontWeight: 600 }}>{expiring}</span><span className="pd-label"> 站</span></div></div>
      </section>

      <section aria-label="站點清單" className="pd-card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="pd-table-wrap">
          <table className="pd-table">
            <thead><tr><th>站點</th><th>經營組織</th><th>經營方式</th><th>狀態</th><th className="pd-num">車位</th><th className="pd-num">車道</th><th>工控機</th><th>授權</th><th><span className="pd-sr-only">操作</span></th></tr></thead>
            <tbody>
              {sites.map((s) => {
                const st = SITE_STATUS[s.status];
                const edge = EDGE_STATUS[s.edge?.status ?? "provisioning"];
                const days = s.license ? daysUntil(s.license.endsOn) : null;
                return (
                  <tr key={s.id}>
                    <td><div style={{ fontWeight: 500 }}>{s.name}</div><div className="pd-mono pd-label">{s.code}・{s.city}{s.district ?? ""}</div></td>
                    <td>{orgName(s.orgId)}</td>
                    <td>{OPERATION_LABELS[s.operationType]}</td>
                    <td><Chip tone={st.tone}>{st.label}</Chip></td>
                    <td className="pd-num">{s.totalSpaces}</td>
                    <td className="pd-num">{s.lanes.length}</td>
                    <td><Chip tone={edge.tone} dot={s.edge?.status === "online"}>{edge.label}</Chip></td>
                    <td>
                      {s.license ? (
                        <><div>{PLAN_LABELS[s.license.plan]}</div><div className="pd-mono pd-label" style={{ color: days !== null && days <= 30 ? "var(--pd-warn-ink)" : undefined }}>至 {s.license.endsOn}</div></>
                      ) : <span className="pd-label">總部自營・免授權</span>}
                    </td>
                    <td><Link href={`/console/sites/${s.id}`}>管理</Link></td>
                  </tr>
                );
              })}
              {sites.length === 0 && <tr><td colSpan={9} className="pd-label" style={{ textAlign: "center", padding: 32 }}>目前沒有可檢視的站點。</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {can(user, "org.manage") && (
        <section aria-labelledby="org-h" className="pd-card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "18px 22px" }}>
            <div>
              <h2 id="org-h" className="pd-serif" style={{ margin: 0, fontSize: 20 }}>組織</h2>
              <p className="pd-label" style={{ margin: "4px 0 0" }}>加盟主與系統客戶。建立組織並指派第一位管理員後，對方即可自行管理自己的帳號。</p>
            </div>
            <button type="button" className="pd-btn">新增組織</button>
          </div>
          <div className="pd-table-wrap">
            <table className="pd-table">
              <thead><tr><th>組織</th><th>類型</th><th>統一編號</th><th className="pd-num">站點</th><th>狀態</th></tr></thead>
              <tbody>
                {orgs.map((o) => (
                  <tr key={o.id}>
                    <td>{o.name}</td>
                    <td>{ORG_TYPE_LABELS[o.type]}</td>
                    <td className="pd-mono">{o.taxId ?? "—"}</td>
                    <td className="pd-num">{sites.filter((s) => s.orgId === o.id).length}</td>
                    <td><Chip tone={o.status === "active" ? "ok" : o.status === "pending" ? "warn" : "neutral"}>{{ active: "合作中", pending: "洽談中", suspended: "停權", terminated: "已終止" }[o.status]}</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
