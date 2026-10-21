// 統一金流 PAYUNi 串接（伺服器端）。
// 依據：PAYUNi 開發專區《整合式支付頁 UNiPaypage (UPP)》Ver 2.0（2026-10-21 取得）與官方 PHP SDK v1.2.4。
//   測試區 https://sandbox-api.payuni.com.tw/api/<路徑>，正式區 https://api.payuni.com.tw/api/<路徑>（TLS 1.2 以上）
//   外層參數：MerID、Version、EncryptInfo、HashInfo。UPP 的 Version 固定 2.0。
// 標「待文件確認」的部分（交易查詢、請退款、Notify 回應內容）需取得對應文件頁後再啟用，不可猜。
import { encrypt, hashInfo, verifyAndDecrypt, type Params, type PayuniKeys } from "./crypto";

export type PayuniEnv = "sandbox" | "production";

export interface PayuniConfig extends PayuniKeys { env: PayuniEnv; merId: string }

/** 從環境變數讀設定。金鑰只放 .env.local 或伺服器環境變數，不寫進程式、不寫進 log。 */
export function loadPayuniConfig(env: NodeJS.ProcessEnv = process.env): PayuniConfig | null {
  const merId = env.PAYUNI_MER_ID?.trim();
  const hashKey = env.PAYUNI_HASH_KEY?.trim();
  const hashIV = env.PAYUNI_HASH_IV?.trim();
  if (!merId || !hashKey || !hashIV) return null;
  if (hashKey.length !== 32) throw new Error("PAYUNI_HASH_KEY 長度應為 32 個字元");
  if (hashIV.length !== 16) throw new Error("PAYUNI_HASH_IV 長度應為 16 個字元");
  const e = env.PAYUNI_ENV === "production" ? "production" : "sandbox";
  return { env: e, merId, hashKey, hashIV };
}

export const apiBase = (env: PayuniEnv) => `https://${env === "sandbox" ? "sandbox-" : ""}api.payuni.com.tw/api/`;

function envelope(cfg: PayuniConfig, inner: Params, version = "1.0") {
  const info = { MerID: cfg.merId, Timestamp: Math.floor(Date.now() / 1000), ...inner };
  const EncryptInfo = encrypt(info, cfg);
  return { MerID: cfg.merId, Version: version, EncryptInfo, HashInfo: hashInfo(EncryptInfo, cfg) };
}

/**
 * 整合式支付頁（UPP）：回傳要由瀏覽器 POST 過去的表單。
 * 車主在 PAYUNi 頁面選付款方式；結果以 NotifyURL（背景，權威）與 ReturnURL（導回頁面，只顯示）回傳。
 */
/** 停車繳費只開「當下完成」的付款方式；ATM、超商代碼要等很久才入帳，車主不能等，不開。 */
export type UppMethod = "Credit" | "ApplePay" | "GooglePay" | "SamsungPay" | "LinePay" | "JKoPay" | "ICash";
export const DEFAULT_PARKING_METHODS: UppMethod[] = ["Credit", "ApplePay", "GooglePay", "LinePay"];

export function buildUppForm(cfg: PayuniConfig, order: {
  merTradeNo: string;      // payment_orders.order_no：[A-Za-z0-9_-]，最長 25；10 分鐘內不可重複
  amount: number;          // 新台幣正整數
  prodDesc: string;        // 必填，例：「中航站 停車費」；最長 550 字
  returnUrl: string;       // 付款完成導回（只顯示結果，不以此入帳）
  notifyUrl: string;       // 背景通知（入帳依據），只能用 80／443 port
  backUrl?: string;        // 付款頁「返回商店」按鈕
  methods?: UppMethod[];   // 指定付款方式；未帶則依 PAYUNi 後台商店設定
  expireSec?: number;      // 付款頁截止秒數 60–600，預設 600；配合報價有效期
}) {
  if (!/^[A-Za-z0-9_-]{1,25}$/.test(order.merTradeNo)) throw new Error("MerTradeNo 只能是英數、底線、連字號，最長 25 字");
  if (!Number.isInteger(order.amount) || order.amount <= 0) throw new Error("金額必須是正整數");
  if (!order.prodDesc.trim() || order.prodDesc.length > 550) throw new Error("ProdDesc 必填，最長 550 字");
  if (order.expireSec !== undefined && (order.expireSec < 60 || order.expireSec > 600)) throw new Error("expireSec 需在 60–600 秒");
  const methods = Object.fromEntries((order.methods ?? DEFAULT_PARKING_METHODS).map((m) => [m, 1]));
  return {
    action: apiBase(cfg.env) + "upp",
    fields: envelope(cfg, {
      MerTradeNo: order.merTradeNo, TradeAmt: order.amount, ProdDesc: order.prodDesc,
      ReturnURL: order.returnUrl, NotifyURL: order.notifyUrl, BackURL: order.backUrl,
      TradeLExpireSec: order.expireSec, Lang: "zh-tw", ...methods,
    }, "2.0"),
  };
}

// ---------- 回傳結果對應（UPP Ver 2.0「返回參數」） ----------

export const TRADE_STATUS = { "0": "取號成功", "1": "已付款", "2": "付款失敗", "3": "付款取消", "8": "訂單待確認" } as const;
export const PAYMENT_TYPE: Record<string, string> = {
  "1": "信用卡", "2": "ATM轉帳", "3": "超商代碼", "5": "超商取貨付款", "6": "愛金卡", "7": "AFTEE",
  "9": "LINE Pay", "10": "宅配到付", "11": "街口支付",
};

/** 對應到 payment_orders 狀態（F 版規格的狀態機）。只有「確定」的結果才給 paid／failed，其餘一律 unknown 交給交易查詢。 */
export type OrderOutcome =
  | { kind: "paid"; tradeNo: string; amount: number; paymentType: string }
  | { kind: "failed"; reason: string }
  | { kind: "pending"; reason: string }   // 取號成功（ATM／超商），停車繳費不應出現
  | { kind: "unknown"; reason: string };  // UNKNOWN、UNAPPROVED、訂單待確認：15 分鐘後發動交易查詢

export function mapResult(data: Record<string, string>, expected: { merTradeNo: string; amount: number }): OrderOutcome {
  if (data.MerTradeNo !== expected.merTradeNo) throw new Error("MerTradeNo 不符");
  const status = (data.Status ?? "").toUpperCase();
  if (status === "UNKNOWN" || status === "UNAPPROVED") return { kind: "unknown", reason: data.Message || status };
  if (status !== "SUCCESS") return { kind: "failed", reason: data.Message || status || "付款失敗" };
  switch (data.TradeStatus) {
    case "1": {
      const amount = Number(data.TradeAmt);
      if (amount !== expected.amount) throw new Error(`金額不符：PAYUNi ${data.TradeAmt}，訂單 ${expected.amount}`);
      return { kind: "paid", tradeNo: data.TradeNo, amount, paymentType: PAYMENT_TYPE[data.PaymentType] ?? data.PaymentType };
    }
    case "2": return { kind: "failed", reason: "付款失敗" };
    case "3": return { kind: "failed", reason: "付款取消" };
    case "0": return { kind: "pending", reason: "取號成功，尚未繳費" };
    default: return { kind: "unknown", reason: `訂單狀態 ${data.TradeStatus ?? "未提供"}` };
  }
}

/** 幕後 API（交易查詢、請退款等）：回傳已驗證 HashInfo 並解密的結果 */
async function callApi(cfg: PayuniConfig, path: string, inner: Params, version?: string) {
  const res = await fetch(apiBase(cfg.env) + path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(envelope(cfg, inner, version)),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json()) as { Status?: string; MerID?: string; EncryptInfo?: string; HashInfo?: string; Message?: string };
  if (!body.EncryptInfo) return { status: body.Status ?? `HTTP_${res.status}`, data: null as Record<string, string> | null, raw: body };
  return { status: body.Status ?? "", data: verifyAndDecrypt(body, cfg), raw: { Status: body.Status, MerID: body.MerID } };
}

/** 交易查詢（trade/query）：以我們的訂單編號查。回傳欄位與版本號待「交易查詢」文件頁確認。 */
export const queryTrade = (cfg: PayuniConfig, merTradeNo: string) => callApi(cfg, "trade/query", { MerTradeNo: merTradeNo });

/** 驗證 NotifyURL／ReturnURL 收到的資料；MerID 必須是我們的商店 */
export function parseCallback(cfg: PayuniConfig, form: Record<string, string>) {
  const data = verifyAndDecrypt(form, cfg);
  if (form.MerID && form.MerID !== cfg.merId) throw new Error("MerID 不符");
  if (data.MerID && data.MerID !== cfg.merId) throw new Error("MerID 不符");
  return { outerStatus: form.Status ?? "", data };
}
