import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchange, oauthMode, origin, STATE_COOKIE, unpackState } from "@/lib/memberOAuth";
import { MemberError, signIn, type IdentityProfile } from "@/lib/membersServer";
import { currentMember, setMemberCookie } from "../../../_util";

// LINE／Google 登入完成後回到這裡：檢查 state → 換 token → 建立、登入或綁定會員 → 回到 /join
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const u = new URL(req.url);
  const base = origin(req);
  const s = unpackState((await cookies()).get(STATE_COOKIE)?.value);
  const back = (q: Record<string, string>) => {
    const sp = new URLSearchParams(q);
    if (s?.site) sp.set("site", s.site);
    if (s?.next) sp.set("next", s.next);
    const res = NextResponse.redirect(`${base}/join?${sp}`, 303);
    res.cookies.set(STATE_COOKIE, "", { path: "/api/members/oauth", maxAge: 0 });
    return res;
  };
  if (!s || s.p !== provider || u.searchParams.get("state") !== s.state) return back({ error: "expired" });
  if (u.searchParams.get("error")) return back({ error: "cancelled" });
  const code = u.searchParams.get("code") ?? "";

  try {
    let id: IdentityProfile;
    if (oauthMode(s.p) === "live") {
      id = await exchange(s, code, `${base}/api/members/oauth/${s.p}/callback`);
    } else if (oauthMode(s.p) === "mock" && code.startsWith("mock_")) {
      const m = JSON.parse(Buffer.from(code.slice(5), "base64url").toString()) as { sub: string; name?: string; email?: string };
      id = { provider: s.p, subject: `mock-${m.sub}`.slice(0, 80), name: m.name, email: m.email ?? null };
    } else {
      return back({ error: "unavailable" });
    }
    const cur = await currentMember();
    const r = await signIn(id, cur?.id ?? null, s.site);
    const res = back({ login: s.p, ...(r.linked ? { linked: "1" } : {}), ...(r.isNew ? { new: "1" } : {}) });
    setMemberCookie(res, req, r.member.id);
    return res;
  } catch (e) {
    if (e instanceof MemberError) return back({ error: "conflict" });
    console.error("[members oauth]", e);
    return back({ error: "failed" });
  }
}
