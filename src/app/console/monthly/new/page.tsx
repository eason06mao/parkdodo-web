import type { Metadata } from "next";
import Link from "next/link";
import { Forbidden } from "@/components/Forbidden";
import { getCurrentUser } from "@/lib/auth";
import { getFixedSpaces, getMonthlyPlans, getMonthlyRecords, getSiteRecords } from "@/lib/data";
import { formatPhone } from "@/lib/members";
import { listLeads } from "@/lib/membersServer";
import { isLive } from "@/lib/monthlyServer";
import { can } from "@/lib/permissions";
import { MonthlyForm, type FormPrefill, type FormSite } from "../MonthlyForm";

export const metadata: Metadata = { title: "新增月租" };
export const dynamic = "force-dynamic";

export default async function NewMonthlyPage({ searchParams }: { searchParams: Promise<{ lead?: string }> }) {
  const { lead: leadId } = await searchParams;
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

  let prefill: FormPrefill | undefined;
  if (leadId) {
    const lead = (await listLeads(allowed.map((s) => s.code))).find((l) => l.id === leadId);
    const site = lead && allowed.find((s) => s.code === lead.siteCode);
    if (lead && site) prefill = { leadId: lead.id, siteId: site.id, planId: lead.planId, name: lead.name, phone: formatPhone(lead.phone), plates: lead.plates };
  }

  return (
    <main className="pd-main">
      <header className="pd-page-head">
        <div>
          <nav aria-label="路徑" className="pd-label"><Link href="/console">營運總覽</Link> ／ <Link href="/console/monthly">月租管理</Link> ／ 新增月租</nav>
          <h1 className="pd-page-title">新增月租</h1>
        </div>
      </header>
      {prefill && <p className="pd-card pd-card--selected" style={{ margin: 0, padding: "12px 16px" }}>已從月租登記單帶入稱呼、手機、車牌與方案，請補齊其他資料。建約後登記單會自動標為「已建約」。</p>}
      <MonthlyForm key={user.id} sites={formSites} plans={plans.filter((p) => allowed.some((s) => s.id === p.siteId))} operator={user.name} prefill={prefill} />
    </main>
  );
}
