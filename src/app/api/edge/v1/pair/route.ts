import { NextResponse } from "next/server";
import { dbConfigured, tx } from "@/lib/db";
import { clientIp, jsonError, readJson } from "@/lib/edge/http";
import { EdgeError, pairEdge, type Hardware } from "@/lib/edge/service";

// POST /api/edge/v1/pair  { code: "12345678", hardware: {...} } → { gatewayId, deviceKey, site }
// 配對碼由總部在後台「配對工控機」產生，10 分鐘內有效，只能用一次。
export async function POST(req: Request) {
  if (!dbConfigured()) return jsonError("db_not_configured", "雲端資料庫尚未設定。", 503);
  try {
    const b = await readJson<{ code?: string; hardware?: Hardware }>(req, 10_000);
    const r = await tx((c) => pairEdge(c, { code: String(b.code ?? ""), hardware: b.hardware ?? {}, ip: clientIp(req) }));
    return NextResponse.json(r, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof EdgeError) {
      if (e.status === 401) await new Promise((r) => setTimeout(r, 800));   // 放慢猜配對碼
      return jsonError(e.code, e.message, e.status);
    }
    console.error("[edge pair]", e);
    return jsonError("server_error", "配對失敗，請稍後再試。", 500);
  }
}
