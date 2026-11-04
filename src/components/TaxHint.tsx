"use client";

import { isTaxId } from "@/lib/invoice";
import type { TaxNameState } from "@/lib/useTaxName";

/** 統編輸入後的提示：查到的公司名稱讓客戶自己核對；查不到不擋，讓客戶自己填抬頭 */
export function TaxHint({ id, taxId, state }: { id: string; taxId: string; state: TaxNameState }) {
  const style = { fontSize: 13, lineHeight: 1.6, margin: 0 } as const;
  if (taxId.length === 8 && !isTaxId(taxId)) return <p id={id} role="alert" style={{ ...style, color: "var(--pd-danger)" }}>統一編號檢查碼不正確，請再確認一次。</p>;
  if (state.status === "loading") return <p id={id} className="pd-label" style={style}>查詢公司名稱…</p>;
  if (state.status === "found") return <p id={id} aria-live="polite" style={{ ...style, color: "var(--pd-accent)" }}>✓ {state.name}<span className="pd-label">　請確認是不是你的公司</span></p>;
  if (state.status === "not_found") return <p id={id} aria-live="polite" className="pd-label" style={style}>查不到這個統編的公司名稱（新設立的公司可能還沒有資料），可以自己填抬頭。</p>;
  return <p id={id} className="pd-label" style={style} />;
}
