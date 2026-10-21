import { NextResponse } from "next/server";
import { loadPayuniConfig, parseCallback } from "@/lib/payments/payuni/client";
import { PayuniCryptoError } from "@/lib/payments/payuni/crypto";

// PAYUNi 背景通知（NotifyURL）。
// 規則（F 版規格「支付模組與狀態機」）：
//   1. 先驗 HashInfo、解密、比對 MerID；任何一項失敗回 400，不更新訂單。
//   2. 用 MerTradeNo 找 payment_orders，比對金額；同一通知重送要冪等（payment_transactions 以 TradeNo 唯一）。
//   3. 不直接相信通知內的狀態：呼叫 trade/query 確認後才把訂單轉為 paid，並建立出場授權。
//   4. 狀態碼對照與要回給 PAYUNi 的回應內容「待文件確認」，確認前只記錄、不轉 paid。
export async function POST(req: Request) {
  const cfg = loadPayuniConfig();
  if (!cfg) return NextResponse.json({ error: "payuni_not_configured" }, { status: 503 });

  const form = Object.fromEntries((await req.formData()).entries()) as Record<string, string>;
  try {
    const { outerStatus, data } = parseCallback(cfg, form);
    // TODO(待文件確認)：依 data.TradeStatus 等欄位對應 payment_orders 狀態；確認前只記錄。
    console.info("[payuni notify]", { outerStatus, merTradeNo: data.MerTradeNo, tradeNo: data.TradeNo, amount: data.TradeAmt });
    return new NextResponse("OK", { status: 200 });
  } catch (e) {
    const reason = e instanceof PayuniCryptoError ? e.message : "invalid";
    console.warn("[payuni notify] rejected:", reason);
    return NextResponse.json({ error: "rejected" }, { status: 400 });
  }
}
