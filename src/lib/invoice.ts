// 電子發票買受人選項（F 版規格「電子發票」）。前端即時檢查與後端共用。
// 這裡只做「格式」檢查；手機條碼是否存在、統編是否登記，正式版由後端呼叫加值中心／財政部服務驗證。

export type InvoiceChoice =
  | { kind: "member" }                                   // 會員載具（預設）
  | { kind: "mobile"; barcode: string }                  // 手機條碼載具
  | { kind: "donate"; loveCode: string }                 // 捐贈（愛心碼）
  | { kind: "company"; taxId: string; title: string; email: string } // 公司統一編號（B2B，寄 Email）
  | { kind: "paper" };                                   // 紙本證明聯：僅 Kiosk，手機端預留未啟用

export const INVOICE_LABELS: Record<InvoiceChoice["kind"], string> = {
  member: "存入會員載具",
  mobile: "存入手機條碼",
  donate: "捐贈發票",
  company: "公司報帳（統一編號）",
  paper: "列印紙本",
};

/** 手機條碼：「/」開頭，後面 7 碼為數字、大寫英文或 + - . */
export const isMobileBarcode = (s: string) => /^\/[0-9A-Z+\-.]{7}$/.test(s);

/** 愛心碼：3–7 位數字 */
export const isLoveCode = (s: string) => /^\d{3,7}$/.test(s);

/**
 * 統一編號檢查碼。權重 1,2,1,2,1,2,4,1，乘積取十位與個位相加後加總。
 * 財政部擴充後的規則：總和能被 5 整除即有效；第 7 碼為 7 時，總和或總和 +1 能被 5 整除即有效。
 */
export function isTaxId(s: string): boolean {
  if (!/^\d{8}$/.test(s)) return false;
  const w = [1, 2, 1, 2, 1, 2, 4, 1];
  const sum = s.split("").reduce((acc, ch, i) => {
    const p = Number(ch) * w[i];
    return acc + Math.floor(p / 10) + (p % 10);
  }, 0);
  if (sum % 5 === 0) return true;
  return s[6] === "7" && (sum + 1) % 5 === 0;
}

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** 回傳錯誤訊息；沒有錯誤回傳 null */
export function validateInvoice(c: InvoiceChoice, opts: { paperEnabled: boolean }): string | null {
  switch (c.kind) {
    case "member": return null;
    case "mobile": return isMobileBarcode(c.barcode) ? null : "手機條碼格式為「/」加 7 碼英數字，例如 /ABC+123。";
    case "donate": return isLoveCode(c.loveCode) ? null : "愛心碼為 3 到 7 位數字。";
    case "company":
      if (!isTaxId(c.taxId)) return "統一編號格式不正確，請確認 8 位數字。";
      if (!isEmail(c.email)) return "請填寫正確的 Email，電子發票會寄到這裡。";
      return null;
    case "paper": return opts.paperEnabled ? null : "此站目前沒有繳費機，無法列印紙本發票。";
  }
}
