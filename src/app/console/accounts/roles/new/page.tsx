import type { Metadata } from "next";
import Link from "next/link";
import { Forbidden } from "@/components/Forbidden";
import { getCurrentUser } from "@/lib/auth";
import { manageableOrgs } from "../editorOrgs";
import { RoleEditor } from "../RoleEditor";

export const metadata: Metadata = { title: "新增角色" };
export const dynamic = "force-dynamic";

export default async function NewRolePage() {
  const user = await getCurrentUser();
  const orgs = await manageableOrgs(user);
  if (orgs.length === 0) return <Forbidden title="沒有角色管理權限" message="建立角色需要全組織的「建立與修改自訂角色」權限。只負責特定站點的主管無法建立角色。" />;
  return (
    <main className="pd-main">
      <header className="pd-page-head">
        <div>
          <nav aria-label="路徑" className="pd-label"><Link href="/console">營運總覽</Link> ／ <Link href="/console/accounts">帳號權限</Link> ／ <Link href="/console/accounts/roles">角色管理</Link> ／ 新增角色</nav>
          <h1 className="pd-page-title">新增角色</h1>
        </div>
      </header>
      <RoleEditor key={user.id} orgs={orgs} mode="new" />
    </main>
  );
}
