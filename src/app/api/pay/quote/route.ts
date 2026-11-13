import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { siteRecords } from "@/lib/mock/tenancy";
import { PayError, quoteBySessionRef, searchByPlate } from "@/lib/payments/parking";
import { allow, clientIp } from "@/lib/payments/rateLimit";
import { mockQuote } from "../_mock";

// POST { site, plate }：查詢這台車要付多少（雲端計算）。plate 可為完整車牌（可省略 -）或車牌上的 3～4 位數字。
//   完全吻合 → 直接報價；只打數字／有辨識誤差 → 回傳 kind: "choose" 與候選車（車牌部分遮蔽＋照片）
// POST { site, ref }：車主從候選中選了自己的車
// 每個 IP 10 分鐘最多查 30 次，避免有人用數字掃出場內車輛。
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { site?: string; plate?: string; ref?: string } | null;
  if (!b?.site || (!b.plate && !b.ref)) return NextResponse.json({ error: "invalid", message: "請輸入車牌。" }, { status: 400 });
  if (!allow(`quote:${clientIp(req)}`, 30, 10 * 60_000)) {
    return NextResponse.json({ error: "too_many_requests", message: "查詢太頻繁，請稍後再試，或按出口的對講機求助。" }, { status: 429 });
  }
  if (!dbConfigured()) {
    const site = siteRecords.find((s) => s.code === b.site);
    if (!site) return NextResponse.json({ error: "site_not_found", message: "找不到這個停車場。" }, { status: 404 });
    return NextResponse.json(mockQuote(site.name, (b.plate ?? "ABC-1234").toUpperCase().replace(/\s/g, "")), { headers: { "cache-control": "no-store" } });
  }
  try {
    const r = b.ref ? await quoteBySessionRef(b.site, b.ref) : await searchByPlate(b.site, b.plate!);
    return NextResponse.json(r, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof PayError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    console.error("[pay quote]", e);
    return NextResponse.json({ error: "server_error", message: "系統忙碌，請再試一次。" }, { status: 500 });
  }
}
