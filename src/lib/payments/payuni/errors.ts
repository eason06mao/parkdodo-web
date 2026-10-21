// PAYUNi 錯誤代碼分類（依《所有 API 通用錯誤代碼》與《交易建立（UPP）錯誤代碼》，2026-10-22 取得）。
// 目的：決定「給車主看什麼」與「要不要通知值班／工程」。代碼本身一律寫入 payment_transactions 與稽核紀錄。

export type ErrorKind =
  | "config"      // 我們的設定或程式有誤：商店代號、金鑰、參數格式、支付工具未開通 → 通知工程，車主改用其他方式
  | "retry"       // 暫時性：連線上限、處理中、系統異常 → 稍後重試（同一筆訂單用交易查詢確認，不重複建單）
  | "expired"     // 付款頁或交易逾期 → 車主重新取得報價再付款
  | "declined"    // 風控拒絕、授權失敗 → 請車主換一張卡或其他付款方式
  | "duplicate";  // 已存在相同商店訂單編號 → 不重建，改用交易查詢取得該筆結果

const EXACT: Record<string, { kind: ErrorKind; note: string }> = {
  API00009: { kind: "retry", note: "已有相同資料處理中" },
  DEF01002: { kind: "config", note: "資料解密失敗（金鑰不符）" },
  DEF01005: { kind: "config", note: "商店不存在" },
  DEF01006: { kind: "config", note: "商店狀態不符合" },
  DEF01007: { kind: "config", note: "Hash 比對不符合（金鑰不符）" },
  UPP00000: { kind: "retry", note: "系統異常" },
  UPP01001: { kind: "retry", note: "已達連線處理上限" },
  UPP01003: { kind: "config", note: "資料 HASH 比對不符合" },
  UPP01004: { kind: "config", note: "資料解密失敗" },
  UPP01007: { kind: "duplicate", note: "已存在相同商店訂單編號" },
  UPP01013: { kind: "config", note: "商店未啟用" },
  UPP02010: { kind: "config", note: "時間戳記已過期（檢查伺服器時鐘）" },
  UPP02022: { kind: "config", note: "無合適的支付工具可供使用" },
  UPP02048: { kind: "expired", note: "交易時間已截止" },
  UPP03000: { kind: "expired", note: "交易已逾期" },
  UPP03001: { kind: "expired", note: "交易 Token 已失效" },
  UPP03021: { kind: "config", note: "訂單金額不符合" },
  UPP04001: { kind: "expired", note: "等待 Token 已失效" },
};

export function classifyError(code: string | undefined): { kind: ErrorKind; note: string } {
  if (!code) return { kind: "retry", note: "沒有錯誤代碼" };
  if (EXACT[code]) return EXACT[code];
  if (/^UPP050\d\d$/.test(code)) return { kind: "declined", note: "交易風控（拒絕交易）" };
  // UPP02xxx：參數格式錯誤或支付工具未啟用／金額不適用 → 都是我們的設定問題
  if (/^(API000|API010|DEF010|UPP010|UPP020|UPP021)\d+$/.test(code)) return { kind: "config", note: "參數或商店設定錯誤" };
  // 信用卡、LINE Pay 等支付工具本身的失敗代碼
  return { kind: "declined", note: "付款失敗" };
}

/** 車主看到的訊息（不顯示內部代碼以外的技術細節） */
export const PAYER_MESSAGE: Record<ErrorKind, string> = {
  config: "目前無法使用線上付款，請改用其他付款方式或按對講機聯絡客服。",
  retry: "付款系統忙碌中，請稍候再試。若已扣款，系統會自動確認，不會重複收費。",
  expired: "付款時間已超過，請重新整理取得最新金額後再付款。",
  declined: "付款未成功，請換一張卡或改用其他付款方式。",
  duplicate: "這筆付款正在確認中，請稍候。",
};

/** 需要立即通知值班／工程的類型 */
export const ALERT_OPS: ErrorKind[] = ["config"];
