import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import type { ContractInput } from "@/lib/monthly";
import { createContract, MonthlyError } from "@/lib/monthlyServer";

// POST：新增月租合約（需 monthly.manage）。檢查車位、車牌、合約上限；有雲端資料庫時同步，工控機白名單會更新。
export async function POST(req: Request) {
  const user = await getCurrentUser();
  const b = (await req.json().catch(() => null)) as ContractInput | null;
  if (!b?.customer || !Array.isArray(b.vehicles)) return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  try {
    const r = await createContract(user, b);
    return NextResponse.json({ id: r.id, contractNo: r.contractNo, endsOn: r.endsOn }, { status: 201 });
  } catch (e) {
    if (e instanceof MonthlyError) return NextResponse.json({ error: "invalid", message: e.message, errors: e.errors }, { status: e.status });
    console.error("[monthly create]", e);
    return NextResponse.json({ error: "server_error", message: "儲存失敗，請再試一次。" }, { status: 500 });
  }
}
