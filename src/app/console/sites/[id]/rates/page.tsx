import type { Metadata } from "next";
import Link from "next/link";
import { Forbidden } from "@/components/Forbidden";
import { getCurrentUser } from "@/lib/auth";
import { getSiteRecord } from "@/lib/data";
import { rateSchedules } from "@/lib/mock/tenancy";
import { can } from "@/lib/permissions";
import { RatesEditor } from "./RatesEditor";

export const metadata: Metadata = { title: "費率設定" };
export const dynamic = "force-dynamic";

export default async function RatesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const site = await getSiteRecord(user, id);
  if (!site) return <Forbidden title="找不到這個站點" message="站點不存在，或你的帳號沒有這個站點的檢視權限。" />;
  const schedule = rateSchedules[id];
  const canEdit = can(user, "rate.publish", { orgId: site.orgId, siteId: site.id });

  return (
    <main className="pd-main">
      <header className="pd-page-head">
        <div>
          <nav aria-label="路徑" className="pd-label">
            <Link href="/console">營運總覽</Link> ／ <Link href="/console/sites">場站與設備</Link> ／ <Link href={`/console/sites/${site.id}`}>{site.name}</Link> ／ 費率設定
          </nav>
          <h1 className="pd-page-title">費率設定・{site.name}</h1>
        </div>
        {schedule && (
          <p className="pd-label" style={{ margin: 0 }}>
            目前第 <span className="pd-mono">{schedule.version}</span> 版・{schedule.updatedBy}・{new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "short", timeStyle: "short" }).format(new Date(schedule.updatedAt))}
          </p>
        )}
      </header>
      {schedule
        ? <RatesEditor siteId={site.id} initial={{ base: schedule.base, promotions: schedule.promotions }} canEdit={canEdit} key={user.id} />
        : <p className="pd-card">這個站點尚未設定費率。</p>}
    </main>
  );
}
