import type { Metadata } from "next";
import Link from "next/link";
import { Forbidden } from "@/components/Forbidden";
import { getCurrentUser } from "@/lib/auth";
import { getSiteRecords } from "@/lib/data";
import { rateSchedules } from "@/lib/mock/tenancy";
import { can } from "@/lib/permissions";
import { ManualEntryForm } from "./ManualEntryForm";

export const metadata: Metadata = { title: "人工補登入場" };
export const dynamic = "force-dynamic";

export default async function ManualEntryPage() {
  const user = await getCurrentUser();
  const sites = (await getSiteRecords(user)).filter((s) => can(user, "session.adjust", { orgId: s.orgId, siteId: s.id }) && rateSchedules[s.id]);
  if (sites.length === 0) {
    return <Forbidden title="沒有補登權限" message="人工補登入場需要「人工結案、調整紀錄」權限。請聯絡你的管理員。" />;
  }
  return (
    <main className="pd-main">
      <header className="pd-page-head">
        <div>
          <nav aria-label="路徑" className="pd-label"><Link href="/console">營運總覽</Link> ／ <Link href="/console/sessions">車輛進出紀錄</Link> ／ 人工補登入場</nav>
          <h1 className="pd-page-title">人工補登入場</h1>
        </div>
      </header>
      <ManualEntryForm
        sites={sites.map((s) => ({ id: s.id, name: s.name, schedule: { base: rateSchedules[s.id].base, promotions: rateSchedules[s.id].promotions } }))}
        operator={user.name}
      />
    </main>
  );
}
