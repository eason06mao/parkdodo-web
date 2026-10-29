import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { MonthlyError, updateContract, type MonthlyAction } from "@/lib/monthlyServer";

// POST：合約操作 confirm_payment（確認收款）、renew（續約）、suspend／resume（停用／恢復）、update_vehicles（變更車牌）
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const b = (await req.json().catch(() => null)) as MonthlyAction | null;
  if (!b?.action) return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  try {
    const r = await updateContract(user, id, b);
    return NextResponse.json({ ok: true, endsOn: r.endsOn });
  } catch (e) {
    if (e instanceof MonthlyError) return NextResponse.json({ error: "invalid", message: e.message, errors: e.errors }, { status: e.status });
    console.error("[monthly update]", e);
    return NextResponse.json({ error: "server_error", message: "儲存失敗，請再試一次。" }, { status: 500 });
  }
}
