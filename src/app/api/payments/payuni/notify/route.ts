import { NextResponse } from "next/server";
import { dbConfigured, pool } from "@/lib/db";
import { applyOutcome, maskRaw } from "@/lib/payments/parking";
import { loadPayuniConfig, mapResult, parseCallback } from "@/lib/payments/payuni/client";
import { str } from "@/lib/payments/payuni/crypto";

// PAYUNi 背景通知（NotifyURL）：入帳的依據。網址帶 ?site=站點代碼，用該站的商店金鑰驗證。
//   1. 驗 HashInfo、解密、比對 MerID；任何一項失敗回 400，不更新訂單。
//   2. 用 MerTradeNo 找訂單、比對金額；重複通知只處理一次。
//   3. 已付款 → 建立出場授權與待開立發票；結果不明 → 交易查詢補齊。
export async function POST(req: Request) {
  const site = new URL(req.url).searchParams.get("site");
  const cfg = loadPayuniConfig(process.env, site);
  if (!cfg || !dbConfigured()) return NextResponse.json({ error: "payuni_not_configured" }, { status: 503 });

  const form = Object.fromEntries((await req.formData()).entries()) as Record<string, string>;
  let data;
  try {
    data = parseCallback(cfg, form).data;
  } catch (e) {
    console.warn("[payuni notify] rejected:", e instanceof Error ? e.message : "invalid");
    return NextResponse.json({ error: "rejected" }, { status: 400 });
  }
  const orderNo = str(data, "MerTradeNo") ?? "";
  try {
    const o = (await pool().query(
      "SELECT o.amount, s.code FROM payment_orders o JOIN sites s ON s.id = o.site_id WHERE o.order_no = $1", [orderNo])).rows[0];
    if (!o) {
      console.warn("[payuni notify] unknown order", orderNo);
      return NextResponse.json({ error: "unknown_order" }, { status: 404 });
    }
    if (site && o.code !== site) {
      console.warn("[payuni notify] site mismatch", orderNo);
      return NextResponse.json({ error: "rejected" }, { status: 400 });
    }
    const outcome = mapResult(data, { merTradeNo: orderNo, amount: Number(o.amount) });
    const r = await applyOutcome(orderNo, outcome, "webhook", maskRaw(data as Record<string, unknown>));
    console.info("[payuni notify]", { orderNo, status: r.status, duplicate: r.duplicate });
    return new NextResponse("OK", { status: 200 });
  } catch (e) {
    // 金額不符等：不入帳，記錄後回 400 讓我們從後台處理
    console.error("[payuni notify] failed", orderNo, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "rejected" }, { status: 400 });
  }
}
