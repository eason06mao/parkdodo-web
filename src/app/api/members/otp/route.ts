import { NextResponse } from "next/server";
import { normalizePhone } from "@/lib/members";
import { requestOtp } from "@/lib/membersServer";
import { fail } from "../_util";

// POST { phone }：寄簡訊驗證碼。模擬模式回傳 devCode。
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { phone?: string } | null;
  const phone = normalizePhone(b?.phone ?? "");
  if (!phone) return NextResponse.json({ error: "invalid", message: "請輸入 09 開頭的 10 碼手機號碼。" }, { status: 422 });
  try {
    return NextResponse.json(await requestOtp(phone), { headers: { "cache-control": "no-store" } });
  } catch (e) { return fail(e, "otp"); }
}
