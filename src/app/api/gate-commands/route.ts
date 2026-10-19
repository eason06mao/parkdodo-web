import { NextResponse } from "next/server";
import { GATE_REASONS } from "@/lib/types";

// Mock API：說明正式版的請求格式與驗證規則（對應 gate_commands 資料表）。
// 正式版必須：驗證登入與 MFA、檢查 gate.remote_open 權限與場站隔離、寫入稽核紀錄、
// 以 idempotencyKey 防重複，並由 Edge 取回執行。此處不連接任何設備。
export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const b = body as { laneId?: string; reasonCode?: string; reasonNote?: string; idempotencyKey?: string };

  if (!b.laneId || !b.idempotencyKey) return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  if (!GATE_REASONS.some((r) => r.code === b.reasonCode)) return NextResponse.json({ error: "invalid_reason" }, { status: 400 });
  if (b.reasonCode === "other" && !b.reasonNote?.trim()) return NextResponse.json({ error: "reason_note_required" }, { status: 400 });

  const now = Date.now();
  return NextResponse.json({
    id: `mock-${now}`,
    status: "requested",
    expiresAt: new Date(now + 30_000).toISOString(),
    mock: true,
  }, { status: 202 });
}
