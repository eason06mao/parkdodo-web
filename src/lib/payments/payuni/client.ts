// 統一金流 PAYUNi 串接（伺服器端）。端點與參數依官方 PHP SDK v1.2.4：
//   測試區 https://sandbox-api.payuni.com.tw/api/<路徑>，正式區 https://api.payuni.com.tw/api/<路徑>
//   外層參數：MerID、Version（預設 1.0）、EncryptInfo、HashInfo
//   EncryptInfo 內必填 MerID、Timestamp（Unix 秒）；建立交易另需 MerTradeNo、TradeAmt
// 標「待文件確認」的欄位與狀態碼，需對照統一金流串接文件後再啟用，不可猜。
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
export function buildUppForm(cfg: PayuniConfig, order: {
  merTradeNo: string;   // 我們的 payment_orders.order_no，最長長度待文件確認
  amount: number;       // 新台幣整數
  returnUrl: string;
  notifyUrl: string;
  extra?: Params;       // 商品描述、付款期限、付款方式限制等，欄位名稱待文件確認
}) {
  if (!Number.isInteger(order.amount) || order.amount <= 0) throw new Error("金額必須是正整數");
  return {
    action: apiBase(cfg.env) + "upp",
    fields: envelope(cfg, {
      MerTradeNo: order.merTradeNo, TradeAmt: order.amount,
      ReturnURL: order.returnUrl, NotifyURL: order.notifyUrl, ...order.extra,
    }),
  };
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

/** 交易查詢（trade/query）：以我們的訂單編號查 */
export const queryTrade = (cfg: PayuniConfig, merTradeNo: string) => callApi(cfg, "trade/query", { MerTradeNo: merTradeNo });

/** 驗證 NotifyURL／ReturnURL 收到的資料；MerID 必須是我們的商店 */
export function parseCallback(cfg: PayuniConfig, form: Record<string, string>) {
  const data = verifyAndDecrypt(form, cfg);
  if (form.MerID && form.MerID !== cfg.merId) throw new Error("MerID 不符");
  if (data.MerID && data.MerID !== cfg.merId) throw new Error("MerID 不符");
  return { outerStatus: form.Status ?? "", data };
}
