import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getMember, MEMBER_COOKIE, MEMBER_MAX_AGE, MemberError, readMemberCookie, signMember } from "@/lib/membersServer";

export function fail(e: unknown, where: string) {
  if (e instanceof MemberError) {
    return NextResponse.json({ error: "invalid", message: e.message, errors: e.errors, waitSec: e.waitSec }, { status: e.status });
  }
  console.error(`[members ${where}]`, e);
  return NextResponse.json({ error: "server_error", message: "系統忙碌，請再試一次。" }, { status: 500 });
}

export async function currentMember() {
  const id = readMemberCookie((await cookies()).get(MEMBER_COOKIE)?.value);
  return id ? getMember(id) : null;
}

export const isHttps = (req: Request) => (req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")) === "https";

export function setMemberCookie(res: NextResponse, req: Request, memberId: string) {
  res.cookies.set(MEMBER_COOKIE, signMember(memberId), { path: "/", maxAge: MEMBER_MAX_AGE, httpOnly: true, secure: isHttps(req), sameSite: "lax" });
}
