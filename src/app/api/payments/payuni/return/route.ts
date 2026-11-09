import { NextResponse } from "next/server";
import { origin } from "@/lib/memberOAuth";
import { loadPayuniConfig, parseCallback } from "@/lib/payments/payuni/client";
import { str } from "@/lib/payments/payuni/crypto";

// 付款完成後統一金流把車主導回這裡（ReturnURL，瀏覽器 POST）。只用來找出訂單編號、轉到結果頁；不以此入帳。
export async function POST(req: Request) {
  const base = origin(req);
  const site = new URL(req.url).searchParams.get("site");
  const cfg = loadPayuniConfig(process.env, site);
  let orderNo = "";
  try {
    const form = Object.fromEntries((await req.formData()).entries()) as Record<string, string>;
    if (cfg) orderNo = str(parseCallback(cfg, form).data, "MerTradeNo") ?? "";
  } catch { /* 驗證失敗：只導回繳費頁 */ }
  const to = /^PD[A-Z0-9]{8,23}$/.test(orderNo) ? `${base}/pay/result?order=${orderNo}` : `${base}/pay${site ? `?site=${encodeURIComponent(site)}` : ""}`;
  return NextResponse.redirect(to, 303);
}

export async function GET(req: Request) {
  const site = new URL(req.url).searchParams.get("site");
  return NextResponse.redirect(`${origin(req)}/pay${site ? `?site=${encodeURIComponent(site)}` : ""}`, 303);
}
