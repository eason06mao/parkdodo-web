import { NextResponse } from "next/server";
import { dbConfigured, tx } from "@/lib/db";
import { jsonError } from "@/lib/edge/http";
import { authenticate, takeCommands } from "@/lib/edge/service";

// GET /api/edge/v1/commands?wait=20：長輪詢。有遠端開閘指令就立刻回傳（並標記為已派送），否則最多等 wait 秒。
export async function GET(req: Request) {
  if (!dbConfigured()) return jsonError("db_not_configured", "雲端資料庫尚未設定。", 503);
  const wait = Math.min(25, Math.max(0, Number(new URL(req.url).searchParams.get("wait") ?? 0) || 0));
  const deadline = Date.now() + wait * 1000;
  try {
    for (;;) {
      const r = await tx(async (c) => {
        const gw = await authenticate(c, req.headers.get("authorization"));
        return gw ? { gw, commands: await takeCommands(c, gw) } : null;
      });
      if (!r) return jsonError("unauthorized", "裝置金鑰無效或工控機已停用，請重新配對。", 401);
      if (r.commands.length || Date.now() >= deadline || req.signal.aborted) {
        return NextResponse.json({ commands: r.commands, serverTime: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
      }
      await new Promise((res) => setTimeout(res, 700));
    }
  } catch (e) {
    console.error("[edge commands]", e);
    return jsonError("server_error", "雲端處理失敗。", 500);
  }
}
