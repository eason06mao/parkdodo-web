import { NextResponse } from "next/server";
import { authorizeUrl, newState, oauthMode, OAUTH_PROVIDERS, origin, packState, safeNext, STATE_COOKIE, type OAuthProvider } from "@/lib/memberOAuth";
import { isHttps } from "../../../_util";

// GET /api/members/oauth/line/start?site=TXG001&next=/pay?site=TXG001
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const u = new URL(req.url);
  const base = origin(req);
  if (!OAUTH_PROVIDERS.includes(provider as OAuthProvider)) return NextResponse.redirect(`${base}/join`, 303);
  const p = provider as OAuthProvider;
  const site = u.searchParams.get("site");
  const next = safeNext(u.searchParams.get("next"));
  const mode = oauthMode(p);
  if (mode === "unavailable") return NextResponse.redirect(`${base}/join?error=unavailable&p=${p}`, 303);

  const s = newState(p, site, next);
  const redirectUri = `${base}/api/members/oauth/${p}/callback`;
  const to = mode === "live" ? authorizeUrl(s, redirectUri) : `${base}/join/mock-login?p=${p}&state=${s.state}`;
  const res = NextResponse.redirect(to, 303);
  res.cookies.set(STATE_COOKIE, packState(s), { path: "/api/members/oauth", maxAge: 600, httpOnly: true, secure: isHttps(req), sameSite: "lax" });
  return res;
}
