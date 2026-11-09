import type { Metadata } from "next";
import { PayResult } from "./PayResult";

export const metadata: Metadata = { title: "付款結果" };

// 統一金流付款後導回這裡：/pay/result?order=PD...。結果以 NotifyURL 入帳為準，這頁只輪詢顯示。
export default async function PayResultPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const { order } = await searchParams;
  return <PayResult orderNo={order ?? ""} />;
}
