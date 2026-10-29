import type { Metadata } from "next";
import Link from "next/link";
import { Forbidden } from "@/components/Forbidden";
import { getCurrentUser } from "@/lib/auth";
import { getFixedSpaces, getMonthlyPlans, getMonthlyRecords, getSiteRecords } from "@/lib/data";
import { isLive } from "@/lib/monthlyServer";
import { can } from "@/lib/permissions";
import { MonthlyForm, type FormSite } from "../MonthlyForm";

export const metadata: Metadata = { title: "新增月租" };
export const dynamic = "force-dynamic";

export default async function NewMonthlyPage() {
  const user = await getCurrentUser();
  const [sites, plans, records] = await Promise.all([getSiteRecords(user), getMonthlyPlans(user), getMonthlyRecords(user)]);
  const allowed = sites.filter((s) => can(user, "monthly.manage", { orgId: s.orgId, siteId: s.id }) && plans.some((p) => p.siteId === s.id));
  if (allowed.length === 0) return <Forbidden title="無法新增月租" message="你沒有月租管理權限，或你負責的站點還沒有設定月租方案。" />;

  const formSites: FormSite[] = allowed.map((s) => ({
    id: s.id, name: s.name,
    spaces: getFixedSpaces(s.id).map((code) => {
      const taken = records.filter((r) => r.siteId === s.id && r.space === code && isLive(r)).sort((a, b) => b.endsOn.localeCompare(a.endsOn))[0];
      return { code, takenUntil: taken?.endsOn };
    }),
  }));

  return (
    <main className="pd-main">
      <header className="pd-page-head">
        <div>
          <nav aria-label="路徑" className="pd-label"><Link href="/console">營運總覽</Link> ／ <Link href="/console/monthly">月租管理</Link> ／ 新增月租</nav>
          <h1 className="pd-page-title">新增月租</h1>
        </div>
      </header>
      <MonthlyForm key={user.id} sites={formSites} plans={plans.filter((p) => allowed.some((s) => s.id === p.siteId))} operator={user.name} />
    </main>
  );
}
