import { NextResponse } from "next/server";
import { loadPayuniConfig, parseCallback } from "@/lib/payments/payuni/client";
import { PayuniCryptoError } from "@/lib/payments/payuni/crypto";

// PAYUNi 背景通知（NotifyURL）。
// 規則（F 版規格「支付模組與狀態機」）：
//   1. 先驗 HashInfo、解密、比對 MerID；任何一項失敗回 400，不更新訂單。
//   2. 用 MerTradeNo 找 payment_orders，比對金額；同一通知重送要冪等（payment_transactions 以 TradeNo 唯一）。
//   3. 文件規定「交易結果請以 NotifyURL 為主」：HashInfo 驗證通過、金額與訂單相符時，以 mapResult() 的結果轉換狀態；
//      paid → 建立出場授權；unknown（UNKNOWN／待確認）→ 15 分鐘後發動交易查詢。ReturnURL 只顯示結果，不入帳。
//   4. 要回給 PAYUNi 的回應內容「待文件確認」，目前回 200 OK。
export async function POST(req: Request) {
  const cfg = loadPayuniConfig();
  if (!cfg) return NextResponse.json({ error: "payuni_not_configured" }, { status: 503 });

  const form = Object.fromEntries((await req.formData()).entries()) as Record<string, string>;
  try {
    const { outerStatus, data } = parseCallback(cfg, form);
    // TODO(接資料庫)：以 data.MerTradeNo 取 payment_orders，呼叫 mapResult(data, { merTradeNo, amount }) 後在同一交易內轉狀態。
    console.info("[payuni notify]", { outerStatus, merTradeNo: data.MerTradeNo, tradeNo: data.TradeNo, amount: data.TradeAmt, tradeStatus: data.TradeStatus });
    return new NextResponse("OK", { status: 200 });
  } catch (e) {
    const reason = e instanceof PayuniCryptoError ? e.message : "invalid";
    console.warn("[payuni notify] rejected:", reason);
    return NextResponse.json({ error: "rejected" }, { status: 400 });
  }
}
