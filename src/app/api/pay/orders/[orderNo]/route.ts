import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { getOrder, refreshOrder } from "@/lib/payments/parking";

// GET：付款結果頁輪詢訂單狀態。?refresh=1 且結果未定時，向統一金流查詢一次。
// 只回傳車主需要看的欄位（車牌、金額、狀態、可離場時間），訂單編號本身就是查詢憑證。
export async function GET(req: Request, { params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await params;
  if (!dbConfigured()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    const refresh = new URL(req.url).searchParams.get("refresh") === "1";
    const o = refresh ? await refreshOrder(orderNo) : await getOrder(orderNo);
    if (!o) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(o, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[pay order]", e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
