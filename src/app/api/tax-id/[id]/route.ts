import { NextResponse } from "next/server";
import { lookupTaxId } from "@/lib/taxRegistry";

// GET /api/tax-id/{統編} → { status: "found", name } | { status: "not_found" } | { status: "invalid" }
// 資料是政府公開資料；結果快取 1 小時。
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const r = await lookupTaxId(id);
    return NextResponse.json(r, { status: r.status === "invalid" ? 400 : 200, headers: { "cache-control": "public, max-age=3600" } });
  } catch (e) {
    console.error("[tax-id]", e);
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
