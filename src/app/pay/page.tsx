import type { Metadata } from "next";
import { brandForSite } from "@/lib/brandingServer";
import { dbConfigured } from "@/lib/db";
import { features } from "@/lib/features";
import { siteRecords } from "@/lib/mock/tenancy";
import { PayFlow } from "./PayFlow";

export const metadata: Metadata = { title: "停車繳費" };
export const dynamic = "force-dynamic";

// 車主手機掃場內 QR 進入：/pay?site=TXG001。
// 有雲端資料庫時：真實停車紀錄與計費，付款走統一金流（PAYUNI_ENV=production 才是正式扣款）。
export default async function PayPage({ searchParams }: { searchParams: Promise<{ site?: string }> }) {
  const { site } = await searchParams;
  const code = site ?? "TXG001";
  const banner = !dbConfigured() ? "模擬環境・不會扣款、不會開立發票"
    : process.env.PAYUNI_ENV !== "production" ? "測試環境・使用統一金流測試區，不會真的扣款" : null;
  return <PayFlow siteCode={code} siteName={siteRecords.find((x) => x.code === code)?.name ?? "停車場"} paperEnabled={features.cashKiosk}
    brand={await brandForSite(code)} banner={banner} />;
}
