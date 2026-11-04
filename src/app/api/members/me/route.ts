import { NextResponse } from "next/server";
import type { MemberProfileInput } from "@/lib/members";
import { MEMBER_COOKIE, saveProfile } from "@/lib/membersServer";
import { currentMember, fail } from "../_util";

const noStore = { "cache-control": "no-store" };

export async function GET() {
  const m = await currentMember();
  return m ? NextResponse.json({ member: m }, { headers: noStore }) : NextResponse.json({ member: null }, { status: 401, headers: noStore });
}

// PUT { name, plates, lead? }：更新稱呼與車牌；lead 有值時同時送出月租登記單
export async function PUT(req: Request) {
  const m = await currentMember();
  if (!m) return NextResponse.json({ error: "unauthorized", message: "請先驗證手機。" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as MemberProfileInput | null;
  if (!b || typeof b.name !== "string" || !Array.isArray(b.plates)) return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  try {
    return NextResponse.json(await saveProfile(m, { name: b.name, plates: b.plates.map(String), lead: b.lead ?? null }));
  } catch (e) { return fail(e, "profile"); }
}

// DELETE：登出這支手機
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(MEMBER_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
