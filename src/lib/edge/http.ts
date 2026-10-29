import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { dbConfigured, tx } from "../db";
import { authenticate, EdgeError, type Gateway } from "./service";

export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

export function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ error: code, message }, { status, headers: { "cache-control": "no-store" } });
}

/** Edge API 共用：檢查資料庫、驗證裝置金鑰、在交易中執行 */
export async function withEdge(req: Request, fn: (c: PoolClient, gw: Gateway) => Promise<unknown>) {
  if (!dbConfigured()) return jsonError("db_not_configured", "雲端資料庫尚未設定。", 503);
  try {
    const result = await tx(async (c) => {
      const gw = await authenticate(c, req.headers.get("authorization"));
      if (!gw) throw new EdgeError("unauthorized", "裝置金鑰無效或工控機已停用，請重新配對。", 401);
      return fn(c, gw);
    });
    return result instanceof Response ? result : NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof EdgeError) return jsonError(e.code, e.message, e.status);
    console.error("[edge]", e);
    return jsonError("server_error", "雲端處理失敗，請稍後重送。", 500);
  }
}

export async function readJson<T>(req: Request, maxBytes = 2_000_000): Promise<T> {
  const text = await req.text();
  if (text.length > maxBytes) throw new EdgeError("too_large", "資料太大。", 413);
  try { return JSON.parse(text) as T; } catch { throw new EdgeError("invalid_json", "JSON 格式錯誤。", 400); }
}
