import { NextResponse, type NextRequest } from "next/server";

// 測試站門禁：設定 STAGING_BASIC_AUTH="帳號:密碼" 時，整站需要先輸入帳密才能看。
// 例外：統一金流的背景通知必須能直接打進來（它自己有 HashInfo 驗證）。
// 正式站不設這個變數，改用正式登入與 MFA。
const OPEN_PATHS = ["/api/payments/payuni/notify"];

export function middleware(req: NextRequest) {
  const expected = process.env.STAGING_BASIC_AUTH;
  if (!expected || OPEN_PATHS.some((p) => req.nextUrl.pathname.startsWith(p))) return NextResponse.next();

  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Basic ") ? atob(header.slice(6)) : "";
  if (given.length === expected.length && timingSafeEqualStr(given, expected)) return NextResponse.next();

  return new NextResponse("需要登入測試站", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="ParkDodo staging", charset="UTF-8"', "X-Robots-Tag": "noindex" },
  });
}

function timingSafeEqualStr(a: string, b: string) {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const config = { matcher: ["/((?!_next/static|_next/image|icon.svg).*)"] };
