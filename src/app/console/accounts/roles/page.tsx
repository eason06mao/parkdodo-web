import type { Metadata } from "next";
import Link from "next/link";
import { Chip } from "@/components/Chip";
import { Forbidden } from "@/components/Forbidden";
import { getCurrentUser } from "@/lib/auth";
import { getAccounts, getOrganizations } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import {
  can, canManageRoles, customRoles, HQ_ONLY, ORG_TYPE_LABELS, PERMISSION_LABELS, ROLES, SENSITIVE, type Role,
} from "@/lib/permissions";

export const metadata: Metadata = { title: "角色管理" };
export const dynamic = "force-dynamic";

function PermChips({ role }: { role: Role }) {
  return (
    <ul style={{ display: "flex", flexWrap: "wrap", gap: 6, listStyle: "none", padding: 0, margin: "10px 0 0" }}>
      {role.permissions.map((p) => (
        <li key={p}><Chip tone={HQ_ONLY.includes(p) ? "info" : SENSITIVE.includes(p) ? "warn" : "neutral"}>{PERMISSION_LABELS[p]}</Chip></li>
      ))}
    </ul>
  );
}

export default async function RolesPage() {
  const user = await getCurrentUser();
  if (!can(user, "user.manage_org") && !can(user, "role.manage")) {
    return <Forbidden title="沒有角色管理權限" message="角色由你所屬組織的管理員建立。需要調整權限，請聯絡你的管理員。" />;
  }
  const [orgs, accounts] = await Promise.all([getOrganizations(user), getAccounts(user)]);
  const orgIds = new Set(orgs.map((o) => o.id));
  const manageable = orgs.filter((o) => canManageRoles(user, o.id));
  const custom = customRoles().filter((r) => !r.archivedAt && orgIds.has(r.orgId!));
  const archived = customRoles().filter((r) => r.archivedAt && orgIds.has(r.orgId!));
  const usage = (code: string) => accounts.filter((a) => a.bindings.some((b) => b.role === code)).length;
  const systemTypes = [...new Set(orgs.map((o) => o.type))];

  return (
    <main className="pd-main">
      <header className="pd-page-head">
        <div>
          <nav aria-label="路徑" className="pd-label"><Link href="/console">營運總覽</Link> ／ <Link href="/console/accounts">帳號權限</Link> ／ 角色管理</nav>
          <h1 className="pd-page-title">角色管理</h1>
        </div>
        {manageable.length > 0 && <Link href="/console/accounts/roles/new" className="pd-btn pd-btn--primary">新增角色</Link>}
      </header>

      <section aria-labelledby="custom-h" className="pd-card">
        <h2 id="custom-h" className="pd-serif" style={{ margin: 0, fontSize: 20 }}>自訂角色</h2>
        <p className="pd-label" style={{ margin: "6px 0 14px", lineHeight: 1.8 }}>
          依現場分工逐項開放功能。只能開放你自己有的權限；「僅總部」權限不能放進加盟主或系統客戶的角色。
          可以管理哪些站點，在邀請帳號、指派角色時設定。
        </p>
        {custom.length === 0 ? <p className="pd-label" style={{ margin: 0 }}>還沒有自訂角色。</p> : (
          <div className="pd-table-wrap">
            <table className="pd-table">
              <thead><tr><th>角色</th><th>組織</th><th>開放功能</th><th>使用中</th><th>最後修改</th><th><span className="pd-sr-only">操作</span></th></tr></thead>
              <tbody>
                {custom.map((r) => {
                  const org = orgs.find((o) => o.id === r.orgId)!;
                  return (
                    <tr key={r.code}>
                      <td><div style={{ fontWeight: 500 }}>{r.name}</div>{r.description && <div className="pd-label">{r.description}</div>}</td>
                      <td>{org.name}<div className="pd-label">{ORG_TYPE_LABELS[org.type]}</div></td>
                      <td style={{ minWidth: 260 }}><PermChips role={r} /></td>
                      <td className="pd-mono">{usage(r.code)} 人</td>
                      <td><span className="pd-mono">{r.updatedAt ? formatDateTime(r.updatedAt) : "—"}</span><div className="pd-label">{r.createdBy}</div></td>
                      <td>{canManageRoles(user, org.id) && <Link href={`/console/accounts/roles/${r.code}`} className="pd-btn">編輯</Link>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {archived.length > 0 && (
          <details style={{ marginTop: 14 }}>
            <summary className="pd-label" style={{ cursor: "pointer", minHeight: 28 }}>已封存 {archived.length} 個角色</summary>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.8 }}>
              {archived.map((r) => <li key={r.code}>{r.name}<span className="pd-label">・封存於 {formatDateTime(r.archivedAt!)}</span></li>)}
            </ul>
          </details>
        )}
      </section>

      <section aria-labelledby="system-h" className="pd-card">
        <h2 id="system-h" className="pd-serif" style={{ margin: 0, fontSize: 20 }}>系統預設角色</h2>
        <p className="pd-label" style={{ margin: "6px 0 4px" }}>預設角色不能修改。需要不同組合時，請新增自訂角色。</p>
        {systemTypes.map((t) => (
          <div key={t} style={{ marginTop: 10 }}>
            <h3 style={{ fontSize: 15, margin: "12px 0 6px" }}>{ORG_TYPE_LABELS[t]}</h3>
            {ROLES.filter((r) => r.orgType === t).map((r) => (
              <details key={r.code} style={{ borderTop: "1px solid var(--pd-line-soft)", padding: "10px 0" }}>
                <summary style={{ cursor: "pointer", minHeight: 28 }}><strong style={{ fontWeight: 500 }}>{r.name}</strong><span className="pd-label">　{r.description}・{usage(r.code)} 人</span></summary>
                <PermChips role={r} />
              </details>
            ))}
          </div>
        ))}
        <p className="pd-label" style={{ margin: "14px 0 0" }}>黃色標籤為敏感功能{user.isHq ? "；藍色標籤為「僅總部」權限" : ""}。</p>
      </section>
    </main>
  );
}
