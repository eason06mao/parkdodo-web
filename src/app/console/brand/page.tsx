import type { Metadata } from "next";
import Link from "next/link";
import { Forbidden } from "@/components/Forbidden";
import { getCurrentUser } from "@/lib/auth";
import { editableOrgs, getBrand } from "@/lib/brandingServer";
import { BrandForm } from "./BrandForm";

export const metadata: Metadata = { title: "品牌設定" };
export const dynamic = "force-dynamic";

const ORG_TYPE: Record<string, string> = { hq: "總部", operator: "自營商", franchisee: "加盟主", licensee: "系統客戶" };

export default async function BrandPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const orgs = editableOrgs(user);
  if (!orgs.length) return <Forbidden title="無法修改品牌" message="需要組織管理員的「修改品牌」權限。" />;
  const org = orgs.find((o) => o.id === sp.org) ?? orgs.find((o) => o.id === user.bindings[0]?.orgId) ?? orgs[0];
  const brand = await getBrand(org.id);

  return (
    <main className="pd-main">
      <header className="pd-page-head">
        <div>
          <nav aria-label="路徑" className="pd-label"><Link href="/console">營運總覽</Link> ／ 品牌設定</nav>
          <h1 className="pd-page-title">品牌設定</h1>
          <p className="pd-label" style={{ margin: "6px 0 0" }}>後台左上角，以及車主看到的繳費頁、會員頁，都會使用這裡的名稱、Logo 與主題色。</p>
        </div>
      </header>
      {orgs.length > 1 && (
        <nav aria-label="選擇組織" className="pd-choice-grid">
          {orgs.map((o) => (
            <Link key={o.id} href={`/console/brand?org=${o.id}`} className="pd-choice" aria-pressed={o.id === org.id} style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
              {o.name}<span style={{ opacity: 0.7, marginLeft: 6, fontSize: 12 }}>{ORG_TYPE[o.type]}</span>
            </Link>
          ))}
        </nav>
      )}
      <BrandForm key={org.id} orgId={org.id} orgName={org.name} initial={brand} />
    </main>
  );
}
