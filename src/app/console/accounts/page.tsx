import type { Metadata } from "next";
import Link from "next/link";
import { Chip } from "@/components/Chip";
import { Forbidden } from "@/components/Forbidden";
import { getCurrentUser } from "@/lib/auth";
import { getAccounts, getAuditEntries, getOrganizations, getSiteRecords } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import {
  can, grantableRoles, grantableSiteScope, HQ_ONLY, ORG_TYPE_LABELS, PERMISSION_LABELS, roleByCode, ROLES, type OrgType,
} from "@/lib/permissions";
import { InviteButton, type InviteOrg } from "./InviteButton";

export const metadata: Metadata = { title: "帳號權限" };
export const dynamic = "force-dynamic";

const STATUS = { invited: { label: "已邀請", tone: "info" }, active: { label: "啟用", tone: "ok" }, locked: { label: "鎖定", tone: "danger" }, disabled: { label: "停用", tone: "neutral" } } as const;

export default async function AccountsPage() {
  const user = await getCurrentUser();
  if (!can(user, "user.manage_org")) {
    return <Forbidden title="沒有帳號管理權限" message="帳號由你所屬組織的管理員建立與指派角色。需要調整權限，請聯絡你的管理員。" />;
  }
  const [accounts, orgs, sites, audit] = await Promise.all([getAccounts(user), getOrganizations(user), getSiteRecords(user), getAuditEntries(user)]);
  const orgName = (id: string) => orgs.find((o) => o.id === id)?.name ?? "—";
  const siteName = (id?: string) => (id ? sites.find((s) => s.id === id)?.name ?? "—" : "全部站點");

  const inviteOrgs: InviteOrg[] = orgs
    .map((o) => {
      const scope = grantableSiteScope(user, o.id);
      return {
        id: o.id, name: o.name, typeLabel: ORG_TYPE_LABELS[o.type],
        roles: grantableRoles(user, o).map((r) => ({ code: r.code, name: r.name, description: r.description })),
        sites: sites.filter((s) => s.orgId === o.id && (!scope || scope.includes(s.id))).map((s) => ({ id: s.id, name: s.name })),
        allowAllSites: scope === null,
      };
    })
    .filter((o) => o.roles.length > 0);

  const visibleTypes = [...new Set(user.isHq ? ROLES.map((r) => r.orgType) : orgs.map((o) => o.type))] as OrgType[];

  return (
    <main className="pd-main">
      <header className="pd-page-head">
        <div>
          <nav aria-label="路徑" className="pd-label"><Link href="/console">營運總覽</Link> ／ 帳號權限</nav>
          <h1 className="pd-page-title">帳號權限</h1>
        </div>
        {inviteOrgs.length > 0 && <InviteButton key={user.id} orgs={inviteOrgs} />}
      </header>

      <section aria-label="帳號清單" className="pd-card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="pd-table-wrap">
          <table className="pd-table">
            <thead><tr><th>姓名</th><th>角色與範圍</th><th>MFA</th><th>狀態</th><th>最後登入</th></tr></thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td><div style={{ fontWeight: 500 }}>{a.name}{a.id === user.id && <span className="pd-label">（你）</span>}</div><div className="pd-label">{a.email}</div></td>
                  <td>
                    {a.bindings.map((b, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: i ? 6 : 0 }}>
                        <Chip tone={roleByCode(b.role).orgType === "hq" ? "info" : "neutral"}>{roleByCode(b.role).name}</Chip>
                        <span className="pd-label">{orgName(b.orgId)}・{siteName(b.siteId)}</span>
                      </div>
                    ))}
                  </td>
                  <td>{a.mfa ? <Chip tone="ok">已啟用</Chip> : <Chip tone="warn">未設定</Chip>}</td>
                  <td><Chip tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Chip></td>
                  <td className="pd-mono">{a.lastLoginAt ? formatDateTime(a.lastLoginAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="pd-split">
        <section aria-labelledby="roles-h" className="pd-card" style={{ flex: "999 1 520px", minWidth: 0 }}>
          <h2 id="roles-h" className="pd-serif" style={{ margin: 0, fontSize: 20 }}>角色與權限</h2>
          <p className="pd-label" style={{ margin: "6px 0 14px", lineHeight: 1.8 }}>
            你只能指派「不超過自己權限」的角色；只負責特定站點的人，只能為那些站點建立帳號。
            遠端開閘與退款核准都需要 MFA，並寫入稽核紀錄。
          </p>
          {visibleTypes.map((t) => (
            <div key={t} style={{ marginTop: 10 }}>
              <h3 style={{ fontSize: 15, margin: "12px 0 6px" }}>{ORG_TYPE_LABELS[t]}</h3>
              {ROLES.filter((r) => r.orgType === t).map((r) => (
                <details key={r.code} style={{ borderTop: "1px solid var(--pd-line-soft)", padding: "10px 0" }}>
                  <summary style={{ cursor: "pointer", minHeight: 28 }}><strong style={{ fontWeight: 500 }}>{r.name}</strong><span className="pd-label">　{r.description}</span></summary>
                  <ul style={{ display: "flex", flexWrap: "wrap", gap: 6, listStyle: "none", padding: 0, margin: "10px 0 0" }}>
                    {r.permissions.map((p) => (
                      <li key={p}><Chip tone={HQ_ONLY.includes(p) ? "info" : "neutral"}>{PERMISSION_LABELS[p]}</Chip></li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          ))}
          {user.isHq && <p className="pd-label" style={{ margin: "14px 0 0" }}>藍色標籤為「僅總部」權限，資料庫層禁止加到其他組織的角色。</p>}
        </section>

        {can(user, "audit.view") && (
          <section aria-labelledby="audit-h" className="pd-card" style={{ flex: "1 1 320px", minWidth: 0 }}>
            <h2 id="audit-h" className="pd-serif" style={{ margin: "0 0 12px", fontSize: 20 }}>稽核紀錄</h2>
            <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {audit.slice(0, 8).map((e, i) => (
                <li key={i} style={{ borderTop: i ? "1px solid var(--pd-line-soft)" : 0, padding: "10px 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <strong style={{ fontWeight: 500 }}>{e.action}</strong>
                    <span className="pd-mono pd-label">{formatDateTime(e.at)}</span>
                  </div>
                  <div style={{ fontSize: 14, marginTop: 2 }}>{e.target}</div>
                  <div className="pd-label">{e.actor}{e.reason ? `・原因：${e.reason}` : ""}</div>
                </li>
              ))}
            </ol>
            <p className="pd-label" style={{ margin: "8px 0 0" }}>稽核紀錄只能新增，任何人都無法修改或刪除。</p>
          </section>
        )}
      </div>
    </main>
  );
}
