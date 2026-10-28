import type { Metadata } from "next";
import { features } from "@/lib/features";
import { PayFlow } from "./PayFlow";

export const metadata: Metadata = { title: "停車繳費" };

// 車主手機掃場內 QR 進入：/pay?site=TXG001。Mock：不連接計費、金流與發票。
export default async function PayPage({ searchParams }: { searchParams: Promise<{ site?: string }> }) {
  const { site } = await searchParams;
  return <PayFlow siteCode={site ?? "TXG001"} siteName="中航站" paperEnabled={features.cashKiosk} />;
}
