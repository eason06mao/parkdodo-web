import { NextResponse } from "next/server";
import { PERSONA_COOKIE } from "@/lib/auth";
import { mockPersonas } from "@/lib/mock/tenancy";

// 只在 Mock 版存在：切換「預覽身分」，用來檢查不同角色看到的畫面。正式版必須移除。
export async function POST(req: Request) {
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!mockPersonas.some((p) => p.id === id)) return NextResponse.json({ error: "unknown_persona" }, { status: 400 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PERSONA_COOKIE, id!, { path: "/", httpOnly: true, sameSite: "lax" });
  return res;
}
