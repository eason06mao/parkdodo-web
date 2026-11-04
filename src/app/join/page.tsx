import type { Metadata } from "next";
import { monthlyPlans } from "@/lib/mock/monthly";
import { siteRecords } from "@/lib/mock/tenancy";
import { oauthMode, safeNext } from "@/lib/memberOAuth";
import { smsMode } from "@/lib/membersServer";
import { JoinFlow, type JoinSite } from "./JoinFlow";

export const metadata: Metadata = { title: "加入會員" };
export const dynamic = "force-dynamic";

// 車主手機開 /join?site=TXG001（場內 QR、繳費頁連結）。附近住家想租月租也從這裡先登記。
export default async function JoinPage({ searchParams }: { searchParams: Promise<{ site?: string; next?: string; login?: string; linked?: string; new?: string; error?: string }> }) {
  const sp = await searchParams;
  // 只列出有開放月租方案的站點；方案只給名稱與月費
  const sites: JoinSite[] = siteRecords
    .map((s) => ({ code: s.code, name: s.name, plans: monthlyPlans.filter((p) => p.siteId === s.id && p.active).map((p) => ({ id: p.id, name: p.name, price: p.monthlyPrice })) }))
    .filter((s) => s.plans.length);
  const next = safeNext(sp.next);
  return <JoinFlow sites={sites} siteCode={sites.find((s) => s.code === sp.site)?.code ?? null} next={next} mock={smsMode() === "mock" || oauthMode("line") === "mock" || oauthMode("google") === "mock"}
    notice={{ login: sp.login, linked: sp.linked === "1", isNew: sp.new === "1", error: sp.error }} />;
}
