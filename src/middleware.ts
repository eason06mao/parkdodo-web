import { NextResponse, type NextRequest } from "next/server";

// 測試站門禁：設定 STAGING_BASIC_AUTH="帳號:密碼" 時，整站需要先登入才能看。
// 兩種登入方式都可以：
//   1. 登入頁 /__gate（表單＋簽章 cookie，12 小時）：桌面版 App 內建瀏覽器、手機都能用
//   2. HTTP Basic Auth：給 curl、腳本使用
// cookie 用 STAGING_BASIC_AUTH 做 HMAC 簽章；換密碼後舊的登入自動失效。
// 例外：統一金流的背景通知必須能直接打進來（它自己有 HashInfo 驗證）。
// 正式站不設這個變數，改用正式登入與 MFA。
const OPEN_PATHS = ["/api/payments/payuni/notify"];
const GATE = "/__gate";
const COOKIE = "pd_staging_gate";
const MAX_AGE = 12 * 60 * 60;

export async function middleware(req: NextRequest) {
  const expected = process.env.STAGING_BASIC_AUTH;
  const { pathname } = req.nextUrl;
  if (!expected || OPEN_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  if (pathname === GATE) return gate(req, expected);

  if (await validCookie(req.cookies.get(COOKIE)?.value, expected)) return NextResponse.next();

  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    let given = "";
    try { given = new TextDecoder().decode(Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0))); } catch { /* 格式錯誤 */ }
    if (safeEqual(given, expected)) return NextResponse.next();
  }

  // 瀏覽器開頁面 → 轉到登入頁；API、curl → 401
  const wantsHtml = req.method === "GET" && (req.headers.get("accept") ?? "").includes("text/html");
  if (wantsHtml) {
    const url = req.nextUrl.clone();
    url.pathname = GATE;
    url.search = `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url, 303);
  }
  return new NextResponse("需要登入測試站", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="ParkDodo staging", charset="UTF-8"', "X-Robots-Tag": "noindex" },
  });
}

async function gate(req: NextRequest, expected: string) {
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const secure = (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")) === "https";

  if (req.nextUrl.searchParams.has("logout")) {
    const res = page("", next, 200);
    res.cookies.set(COOKIE, "", { path: "/", maxAge: 0, httpOnly: true, secure, sameSite: "lax" });
    return res;
  }
  if (req.method === "GET") {
    if (await validCookie(req.cookies.get(COOKIE)?.value, expected)) return redirect(req, next);
    return page("", next, 200);
  }
  if (req.method !== "POST") return new NextResponse(null, { status: 405 });

  let user = "", pass = "";
  try {
    const form = await req.formData();
    user = String(form.get("user") ?? "");
    pass = String(form.get("pass") ?? "");
  } catch { /* 空表單 */ }

  if (!safeEqual(`${user}:${pass}`, expected)) {
    await new Promise((r) => setTimeout(r, 600)); // 放慢猜密碼
    return page("帳號或密碼不正確。", next, 401);
  }
  const res = redirect(req, next);
  res.cookies.set(COOKIE, await sign(expected), { path: "/", maxAge: MAX_AGE, httpOnly: true, secure, sameSite: "lax" });
  return res;
}

function redirect(req: NextRequest, next: string) {
  const url = req.nextUrl.clone();
  const [path, query = ""] = next.split("?");
  url.pathname = path;
  url.search = query ? `?${query}` : "";
  return NextResponse.redirect(url, 303);
}

/** 只允許站內路徑，避免被拿來轉址到外站 */
function safeNext(v: string | null) {
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\") || v.startsWith(GATE)) return "/";
  return v;
}

// ---------- 簽章 cookie：「到期秒數.HMAC」 ----------

async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sign(secret: string) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  return `${exp}.${await hmac(secret, `pd-staging-gate:${exp}`)}`;
}

async function validCookie(value: string | undefined, secret: string) {
  if (!value) return false;
  const [exp, sig] = value.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, await hmac(secret, `pd-staging-gate:${exp}`));
}

function safeEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// ---------- 登入頁（不依賴任何靜態檔，門禁前就能顯示） ----------

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function page(error: string, next: string, status: number) {
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>登入測試站・ParkDodo</title>
<style>
:root{color-scheme:light dark;--bg:#F5F3EF;--card:#fff;--ink:#1D2A2E;--muted:#5E6B6E;--line:#D9D4CC;--accent:#1F7A6D;--danger:#B4442F}
@media (prefers-color-scheme:dark){:root{--bg:#141B1D;--card:#1D2629;--ink:#E8ECEC;--muted:#9AA7A9;--line:#33403F;--accent:#3FA796;--danger:#E07A63}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--ink);
font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif}
form{width:100%;max-width:360px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px 24px;display:grid;gap:16px}
h1{margin:0;font-size:22px;font-weight:600}p{margin:0;color:var(--muted);font-size:14px;line-height:1.7}
label{display:grid;gap:6px;font-size:14px}input{font:inherit;font-size:16px;min-height:44px;padding:0 12px;border:1px solid var(--line);border-radius:10px;background:transparent;color:inherit}
input:focus{outline:2px solid var(--accent);outline-offset:1px}button{font:inherit;min-height:44px;border:0;border-radius:10px;background:var(--accent);color:#fff;font-weight:600;cursor:pointer}
.err{color:var(--danger)}
</style></head><body>
<form method="post" action="${GATE}?next=${esc(encodeURIComponent(next))}">
<h1>ParkDodo 測試站</h1>
<p>這是內部測試環境，請輸入測試站帳號與密碼。登入會保留 12 小時。</p>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ""}
<label>帳號<input name="user" autocomplete="username" required autofocus></label>
<label>密碼<input name="pass" type="password" autocomplete="current-password" required></label>
<button type="submit">登入</button>
</form></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "X-Robots-Tag": "noindex" },
  });
}

export const config = { matcher: ["/((?!_next/static|_next/image|icon.svg).*)"] };
