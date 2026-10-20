import type { Metadata } from "next";
import Link from "next/link";
import { Forbidden } from "@/components/Forbidden";
import { getCurrentUser } from "@/lib/auth";
import { getOrganizations } from "@/lib/data";
import { can } from "@/lib/permissions";
import { SiteWizard } from "./SiteWizard";

export const metadata: Metadata = { title: "新增站點" };
export const dynamic = "force-dynamic";

export default async function NewSitePage() {
  const user = await getCurrentUser();
  if (!can(user, "site.create")) {
    return <Forbidden title="新增站點只限總部" message="新站點牽涉硬體出貨、工控機配對與軟體授權，由 ParkDodo 總部建立後再指派給你的組織。需要開新站，請聯絡總部業務窗口。" />;
  }
  const orgs = (await getOrganizations(user)).filter((o) => o.status === "active" || o.status === "pending");
  return (
    <main className="pd-main">
      <header className="pd-page-head">
        <div>
          <nav aria-label="路徑" className="pd-label"><Link href="/console">營運總覽</Link> ／ <Link href="/console/sites">場站與設備</Link> ／ 新增站點</nav>
          <h1 className="pd-page-title">新增站點</h1>
        </div>
      </header>
      <SiteWizard orgs={orgs.map((o) => ({ id: o.id, name: o.name, type: o.type }))} today={new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date())} />
    </main>
  );
}
