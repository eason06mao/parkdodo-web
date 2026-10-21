// 檢查 PAYUNi 測試區金鑰是否設定正確：npm run payuni:check
// 讀 .env.local 的 PAYUNI_MER_ID／PAYUNI_HASH_KEY／PAYUNI_HASH_IV，對測試區查一筆不存在的訂單。
// 能拿到「HashInfo 驗證通過」的回應，就代表商店代號與金鑰都正確。不會建立交易、不會扣款。
import { readFileSync } from "node:fs";
import { loadPayuniConfig, queryTrade } from "../src/lib/payments/payuni/client";
import { str } from "../src/lib/payments/payuni/crypto";

try {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch { /* 沒有 .env.local */ }

const cfg = loadPayuniConfig();
if (!cfg) { console.error("請先在 .env.local 填入 PAYUNI_MER_ID、PAYUNI_HASH_KEY、PAYUNI_HASH_IV。"); process.exit(1); }
if (cfg.env !== "sandbox") { console.error("這個檢查只對測試區執行，請把 PAYUNI_ENV 設為 sandbox。"); process.exit(1); }

const r = await queryTrade(cfg, `PDCHECK${Date.now()}`);
if (r.data) {
  console.log("連線成功，HashInfo 驗證通過，金鑰正確。");
  console.log("回應狀態：", r.status, "／訊息：", str(r.data, "Message") ?? "（無）");
} else {
  console.log("PAYUNi 回應：", r.status, r.raw);
  console.log("沒有加密回應，通常代表商店代號錯誤或測試區未開通；請對照回應代碼。");
}
