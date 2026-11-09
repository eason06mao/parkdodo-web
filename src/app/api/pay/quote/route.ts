import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { siteRecords } from "@/lib/mock/tenancy";
import { PayError, quoteByPlate } from "@/lib/payments/parking";
import { mockQuote } from "../_mock";

// POST { site, plate }：查詢這台車要付多少（雲端計算）。
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { site?: string; plate?: string } | null;
  if (!b?.site || !b.plate) return NextResponse.json({ error: "invalid", message: "請輸入車牌。" }, { status: 400 });
  if (!dbConfigured()) {
    const site = siteRecords.find((s) => s.code === b.site);
    if (!site) return NextResponse.json({ error: "site_not_found", message: "找不到這個停車場。" }, { status: 404 });
    return NextResponse.json(mockQuote(site.name, b.plate.toUpperCase().replace(/\s/g, "")), { headers: { "cache-control": "no-store" } });
  }
  try {
    return NextResponse.json(await quoteByPlate(b.site, b.plate), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof PayError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    console.error("[pay quote]", e);
    return NextResponse.json({ error: "server_error", message: "系統忙碌，請再試一次。" }, { status: 500 });
  }
}
