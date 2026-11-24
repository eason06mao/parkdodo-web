// npm run test:payuni — 付款時請統一金流一併開立電子發票（TradeInvoice=1）的開關
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUppForm, invoiceEnabled, type PayuniConfig } from "../../src/lib/payments/payuni/client";
import { decrypt } from "../../src/lib/payments/payuni/crypto";

const cfg: PayuniConfig = { env: "sandbox", merId: "S00000000", hashKey: "12345678901234567890123456789012", hashIV: "1234567890123456" };
const order = { merTradeNo: "T20261125A", amount: 60, prodDesc: "測試 停車費", returnUrl: "https://x/r", notifyUrl: "https://x/n" };
const inner = (invoice?: boolean) => decrypt(buildUppForm(cfg, { ...order, invoice }).fields.EncryptInfo, cfg);

test("沒設定 PAYUNI_INVOICE：一律關閉", () => {
  assert.equal(invoiceEnabled({}, "TXG001"), false);
  assert.equal(invoiceEnabled({ PAYUNI_INVOICE: "" }, "TXG001"), false);
});

test("on：全部站點開啟", () => {
  assert.equal(invoiceEnabled({ PAYUNI_INVOICE: "on" }, "TXG001"), true);
  assert.equal(invoiceEnabled({ PAYUNI_INVOICE: "ON" }, "TXG002"), true);
});

test("站點清單：只有列出的站點開啟（每個商店各自註冊光貿）", () => {
  const env = { PAYUNI_INVOICE: "TXG001, txg003" };
  assert.equal(invoiceEnabled(env, "TXG001"), true);
  assert.equal(invoiceEnabled(env, "txg003"), true);
  assert.equal(invoiceEnabled(env, "TXG002"), false);
  assert.equal(invoiceEnabled(env, null), false);
});

test("開啟時 UPP 加密內容帶 TradeInvoice=1；關閉時完全不帶", () => {
  assert.equal(inner(true).TradeInvoice, "1");
  assert.equal(inner(false).TradeInvoice, undefined);
  assert.equal(inner(undefined).TradeInvoice, undefined);
});
