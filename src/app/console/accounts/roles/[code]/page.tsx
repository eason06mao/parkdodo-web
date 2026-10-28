import type { Metadata } from "next";
import Link from "next/link";
import { Forbidden } from "@/components/Forbidden";
import { getCurrentUser } from "@/lib/auth";
import { getAccounts } from "@/lib/data";
import { customRoles } from "@/lib/permissions";
import { manageableOrgs } from "../editorOrgs";
import { RoleEditor } from "../RoleEditor";

export const metadata: Metadata = { title: "編輯角色" };
export const dynamic = "force-dynamic";

export default async function EditRolePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const user = await getCurrentUser();
  const role = customRoles().find((r) => r.code === code && !r.archivedAt);
  const org = role && (await manageableOrgs(user)).find((o) => o.id === role.orgId);
  if (!role || !org) return <Forbidden title="無法編輯這個角色" message="角色不存在、已封存、是系統預設角色，或你沒有管理這個組織角色的權限。" />;
  const inUse = (await getAccounts(user)).filter((a) => a.bindings.some((b) => b.role === code)).length;
  return (
    <main className="pd-main">
      <header className="pd-page-head">
        <div>
          <nav aria-label="路徑" className="pd-label"><Link href="/console">營運總覽</Link> ／ <Link href="/console/accounts">帳號權限</Link> ／ <Link href="/console/accounts/roles">角色管理</Link> ／ {role.name}</nav>
          <h1 className="pd-page-title">編輯角色・{role.name}</h1>
        </div>
      </header>
      <RoleEditor key={`${user.id}-${role.updatedAt}`} orgs={[org]} mode="edit" code={role.code} inUse={inUse}
        initial={{ orgId: org.id, name: role.name, description: role.description, permissions: role.permissions }} />
    </main>
  );
}
