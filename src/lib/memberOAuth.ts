// LINE 登入、Google 登入（OpenID Connect 授權碼流程）。
// 沒設定金鑰時：測試站／本機走模擬登入頁 /join/mock-login；正式站顯示「暫時無法使用」。
// 金鑰只放環境變數／Secret Manager：LINE_LOGIN_CHANNEL_ID、LINE_LOGIN_CHANNEL_SECRET、GOOGLE_OAUTH_CLIENT_ID、GOOGLE_OAUTH_CLIENT_SECRET
import { randomBytes } from "node:crypto";
import type { IdentityProfile } from "./membersServer";
import { mac, macEqual, mockAllowed } from "./membersServer";

export type OAuthProvider = "line" | "google";
export const OAUTH_PROVIDERS: OAuthProvider[] = ["line", "google"];

const CONF = {
  line: {
    id: () => process.env.LINE_LOGIN_CHANNEL_ID, secret: () => process.env.LINE_LOGIN_CHANNEL_SECRET,
    authorize: "https://access.line.me/oauth2/v2.1/authorize", token: "https://api.line.me/oauth2/v2.1/token", scope: "openid profile email",
  },
  google: {
    id: () => process.env.GOOGLE_OAUTH_CLIENT_ID, secret: () => process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    authorize: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", scope: "openid email profile",
  },
} as const;

export function oauthMode(p: OAuthProvider): "live" | "mock" | "unavailable" {
  if (CONF[p].id() && CONF[p].secret()) return "live";
  return mockAllowed() ? "mock" : "unavailable";
}

/** 登入流程的暫存（state cookie）：防 CSRF、帶回來源站與返回頁 */
export interface OAuthState { p: OAuthProvider; state: string; nonce: string; site: string | null; next: string | null; exp: number }
export const STATE_COOKIE = "pd_oauth";
export function newState(p: OAuthProvider, site: string | null, next: string | null): OAuthState {
  return { p, state: randomBytes(16).toString("hex"), nonce: randomBytes(16).toString("hex"), site, next, exp: Date.now() + 10 * 60_000 };
}
export function packState(s: OAuthState) {
  const body = Buffer.from(JSON.stringify(s)).toString("base64url");
  return `${body}.${mac(`oauth:${body}`)}`;
}
export function unpackState(v: string | undefined): OAuthState | null {
  if (!v) return null;
  const [body, sig] = v.split(".");
  if (!body || !sig || !macEqual(sig, mac(`oauth:${body}`))) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString()) as OAuthState;
    return s.exp > Date.now() ? s : null;
  } catch { return null; }
}

export function authorizeUrl(s: OAuthState, redirectUri: string) {
  const c = CONF[s.p];
  const q = new URLSearchParams({ response_type: "code", client_id: c.id()!, redirect_uri: redirectUri, scope: c.scope, state: s.state, nonce: s.nonce });
  if (s.p === "google") q.set("prompt", "select_account");
  return `${c.authorize}?${q}`;
}

const decodeJwt = (t: string) => JSON.parse(Buffer.from(t.split(".")[1] ?? "", "base64url").toString()) as Record<string, unknown>;

/** 用授權碼換 ID token，取得使用者 ID、名稱、Email */
export async function exchange(s: OAuthState, code: string, redirectUri: string): Promise<IdentityProfile> {
  const c = CONF[s.p];
  const res = await fetch(c.token, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: c.id()!, client_secret: c.secret()! }),
  });
  if (!res.ok) throw new Error(`${s.p} token ${res.status}`);
  const idToken = ((await res.json()) as { id_token?: string }).id_token;
  if (!idToken) throw new Error(`${s.p} token: no id_token`);

  if (s.p === "line") {
    // LINE 官方建議用 verify API 驗證 ID token（簽章、aud、nonce、到期）
    const v = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: c.id()!, nonce: s.nonce }),
    });
    if (!v.ok) throw new Error(`line verify ${v.status}`);
    const p = (await v.json()) as { sub: string; name?: string; email?: string };
    return { provider: "line", subject: p.sub, name: p.name, email: p.email ?? null };
  }

  // Google：ID token 是直接從 Google 的 token 端點以 HTTPS 取得，依 OpenID Connect 規範可不驗簽，但仍檢查 iss、aud、exp、nonce
  const p = decodeJwt(idToken);
  if (!["accounts.google.com", "https://accounts.google.com"].includes(String(p.iss))) throw new Error("google iss");
  if (p.aud !== c.id()) throw new Error("google aud");
  if (Number(p.exp) * 1000 < Date.now()) throw new Error("google exp");
  if (p.nonce !== s.nonce) throw new Error("google nonce");
  return { provider: "google", subject: String(p.sub), name: p.name as string | undefined, email: p.email_verified ? (p.email as string) : null };
}

/** 對外網址（Cloud Run 在 proxy 後面） */
export function origin(req: Request) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const u = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host;
  return `${proto}://${host}`;
}
export const safeNext = (v: string | null | undefined) => (v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : null);
