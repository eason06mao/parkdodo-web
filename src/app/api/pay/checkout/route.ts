import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { features } from "@/lib/features";
import { validateInvoice, type InvoiceChoice } from "@/lib/invoice";
import { origin } from "@/lib/memberOAuth";
import { checkout, PayError } from "@/lib/payments/parking";
import { currentMember } from "../../members/_util";
import { mockQuoteValid } from "../_mock";

// POST { quoteId, invoice }：建立付款訂單，回傳要送到統一金流的表單（瀏覽器自動送出）。
// 入帳只依 NotifyURL（/api/payments/payuni/notify）；這裡不會把訂單標為已付款。
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { quoteId?: string; invoice?: InvoiceChoice } | null;
  if (!b?.quoteId || !b.invoice) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const problem = validateInvoice(b.invoice, { paperEnabled: features.cashKiosk });
  if (problem) return NextResponse.json({ error: "invalid_invoice", message: problem }, { status: 422 });
  const member = await currentMember();
  if (b.invoice.kind === "member" && !member) {
    return NextResponse.json({ error: "invalid_invoice", message: "存入會員載具需要先加入會員（LINE、Google 或手機一鍵登入），或改選其他發票方式。" }, { status: 422 });
  }
  if (!dbConfigured()) {
    if (!mockQuoteValid(b.quoteId)) return NextResponse.json({ error: "quote_expired", message: "金額已更新，請重新查詢。" }, { status: 409 });
    return NextResponse.json({ mock: true, orderNo: `PD${Date.now()}` }, { status: 201 });
  }
  try {
    const r = await checkout({ quoteId: b.quoteId, invoice: b.invoice, memberId: member?.id ?? null, origin: origin(req) });
    return NextResponse.json(r, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof PayError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    console.error("[pay checkout]", e);
    return NextResponse.json({ error: "server_error", message: "建立付款失敗，請再試一次。" }, { status: 500 });
  }
}
