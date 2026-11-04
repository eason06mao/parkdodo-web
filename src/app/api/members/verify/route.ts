import { NextResponse } from "next/server";
import { normalizePhone } from "@/lib/members";
import { signIn, verifyOtp } from "@/lib/membersServer";
import { currentMember, fail, setMemberCookie } from "../_util";

// POST { phone, code, site, agree }：簡訊碼正確 → 建立、登入，或綁定到目前登入的會員。
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { phone?: string; code?: string; site?: string; agree?: boolean } | null;
  const phone = normalizePhone(b?.phone ?? "");
  const code = String(b?.code ?? "").replace(/\D/g, "");
  if (!phone || code.length !== 6) return NextResponse.json({ error: "invalid", message: "請輸入 6 位數驗證碼。" }, { status: 422 });
  if (b?.agree !== true) return NextResponse.json({ error: "invalid", message: "請先閱讀個人資料告知事項。" }, { status: 422 });
  try {
    await verifyOtp(phone, code);
    const cur = await currentMember();
    const r = await signIn({ provider: "phone", subject: phone }, cur?.id ?? null, b?.site ?? null);
    const res = NextResponse.json(r);
    setMemberCookie(res, req, r.member.id);
    return res;
  } catch (e) { return fail(e, "verify"); }
}
