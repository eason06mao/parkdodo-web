import { NextResponse } from "next/server";
import { features } from "@/lib/features";
import { validateInvoice, type InvoiceChoice } from "@/lib/invoice";

// Mock：建立付款訂單。正式版：
//   1. 以 quoteId 取報價（未過期、金額未變），建立 payment_orders（同一停車紀錄只能有一張進行中訂單）
//   2. 發票選項存在訂單上（統編、載具類型、交付方式分開欄位；載具與統編加密保存）
//   3. 回傳 PAYUNi UPP 表單（buildUppForm），由瀏覽器自動送出
//   4. 付款成功（NotifyURL）後才開立發票；開票失敗會重試，不會重複開票、不會重複收款
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { plate?: string; amount?: number; invoice?: InvoiceChoice } | null;
  if (!b?.plate || !b.invoice || !Number.isInteger(b.amount)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const problem = validateInvoice(b.invoice, { paperEnabled: features.cashKiosk });
  if (problem) return NextResponse.json({ error: "invalid_invoice", message: problem }, { status: 422 });
  return NextResponse.json({ orderNo: `PD${Date.now()}`, mock: true }, { status: 201 });
}
