// 以官方 PHP SDK 產生的向量驗證 TypeScript 實作：npm run test:payuni
// 向量重新產生：php tests/payuni/gen-vectors.php <PayuniApi.php 路徑> > tests/payuni/vectors.json
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { classifyError } from "../../src/lib/payments/payuni/errors";
import { decrypt, encrypt, hashInfo, httpBuildQuery, verifyAndDecrypt } from "../../src/lib/payments/payuni/crypto";

const v = JSON.parse(readFileSync(new URL("./vectors.json", import.meta.url), "utf8"));
const keys = { hashKey: v.key, hashIV: v.iv };

for (const [i, c] of v.cases.entries()) {
  test(`向量 ${i + 1}：http_build_query 與 PHP 相同`, () => assert.equal(httpBuildQuery(c.input), c.query));
  test(`向量 ${i + 1}：EncryptInfo 與官方 SDK 相同`, () => assert.equal(encrypt(c.input, keys), c.encryptInfo));
  test(`向量 ${i + 1}：HashInfo 與官方 SDK 相同`, () => assert.equal(hashInfo(c.encryptInfo, keys), c.hashInfo));
  test(`向量 ${i + 1}：解密結果與官方 SDK 相同`, () => assert.deepEqual(decrypt(c.encryptInfo, keys), c.decrypted));
}

test("HashInfo 不符時拒絕", () => {
  const c = v.cases[0];
  assert.throws(() => verifyAndDecrypt({ EncryptInfo: c.encryptInfo, HashInfo: "0".repeat(64) }, keys), /HashInfo/);
});

test("密文被竄改時拒絕（GCM tag）", () => {
  const c = v.cases[0];
  const raw = Buffer.from(c.encryptInfo, "hex").toString("utf8");
  const tampered = Buffer.from((raw[0] === "A" ? "B" : "A") + raw.slice(1), "utf8").toString("hex");
  assert.throws(() => decrypt(tampered, keys), /解密失敗/);
});

test("金鑰錯誤時拒絕", () => {
  const c = v.cases[0];
  assert.throws(() => decrypt(c.encryptInfo, { hashKey: "x".repeat(32), hashIV: v.iv }), /解密失敗/);
});

import { buildUppForm, mapQueryResult, mapResult, parseCallback, queryRows } from "../../src/lib/payments/payuni/client";

test("UPP 表單：測試區網址、外層四個欄位、可被自己解回", () => {
  const cfg = { env: "sandbox" as const, merId: "ABC", ...keys };
  const f = buildUppForm(cfg, { merTradeNo: "PD0001", amount: 120, prodDesc: "中航站 停車費", returnUrl: "https://example.com/r", notifyUrl: "https://example.com/n" });
  assert.equal(f.action, "https://sandbox-api.payuni.com.tw/api/upp");
  assert.deepEqual(Object.keys(f.fields), ["MerID", "Version", "EncryptInfo", "HashInfo"]);
  const back = parseCallback(cfg, { MerID: "ABC", Status: "SUCCESS", EncryptInfo: f.fields.EncryptInfo, HashInfo: f.fields.HashInfo });
  assert.equal(back.data.MerTradeNo, "PD0001");
  assert.equal(back.data.TradeAmt, "120");
  assert.equal(f.fields.Version, "2.0");
  assert.equal(back.data.ProdDesc, "中航站 停車費");
  assert.equal(back.data.Credit, "1");
  assert.equal(back.data.ATM, undefined, "停車繳費不開 ATM");
});

test("訂單編號格式不符時拒絕", () => {
  const cfg = { env: "sandbox" as const, merId: "ABC", ...keys };
  assert.throws(() => buildUppForm(cfg, { merTradeNo: "PD 001", amount: 30, prodDesc: "x", returnUrl: "", notifyUrl: "" }), /MerTradeNo/);
  assert.throws(() => buildUppForm(cfg, { merTradeNo: "P".repeat(26), amount: 30, prodDesc: "x", returnUrl: "", notifyUrl: "" }), /MerTradeNo/);
});

const order = { merTradeNo: "PD0001", amount: 120 };
const base = { MerTradeNo: "PD0001", TradeNo: "1700000000000", TradeAmt: "120", PaymentType: "1" };
test("結果對應：SUCCESS + TradeStatus 1 → paid", () => {
  assert.deepEqual(mapResult({ ...base, Status: "SUCCESS", TradeStatus: "1" }, order), { kind: "paid", tradeNo: "1700000000000", amount: 120, paymentType: "信用卡" });
});
test("結果對應：付款失敗、付款取消 → failed", () => {
  assert.equal(mapResult({ ...base, Status: "SUCCESS", TradeStatus: "2" }, order).kind, "failed");
  assert.equal(mapResult({ ...base, Status: "SUCCESS", TradeStatus: "3" }, order).kind, "failed");
  assert.equal(mapResult({ ...base, Status: "CRD00001", Message: "授權失敗" }, order).kind, "failed");
});
test("結果對應：UNKNOWN、UNAPPROVED、待確認 → unknown（之後交易查詢）", () => {
  assert.equal(mapResult({ ...base, Status: "UNKNOWN" }, order).kind, "unknown");
  assert.equal(mapResult({ ...base, Status: "Unapproved" }, order).kind, "unknown");
  assert.equal(mapResult({ ...base, Status: "SUCCESS", TradeStatus: "8" }, order).kind, "unknown");
});
test("結果對應：金額或訂單編號不符時拒絕，不入帳", () => {
  assert.throws(() => mapResult({ ...base, Status: "SUCCESS", TradeStatus: "1", TradeAmt: "1" }, order), /金額不符/);
  assert.throws(() => mapResult({ ...base, MerTradeNo: "OTHER", Status: "SUCCESS", TradeStatus: "1" }, order), /MerTradeNo/);
});

test("回呼的 MerID 不是我們的商店時拒絕", () => {
  const cfg = { env: "sandbox" as const, merId: "ABC", ...keys };
  const f = buildUppForm(cfg, { merTradeNo: "PD0002", amount: 30, prodDesc: "停車費", returnUrl: "https://example.com/r", notifyUrl: "https://example.com/n" });
  assert.throws(() => parseCallback({ ...cfg, merId: "XYZ" }, { MerID: "ABC", EncryptInfo: f.fields.EncryptInfo, HashInfo: f.fields.HashInfo }), /MerID/);
});

test("金額必須是正整數", () => {
  const cfg = { env: "sandbox" as const, merId: "ABC", ...keys };
  assert.throws(() => buildUppForm(cfg, { merTradeNo: "x", amount: 12.5, prodDesc: "停車費", returnUrl: "", notifyUrl: "" }), /正整數/);
});

// ---------- 交易查詢（Ver 2.0）：Result 陣列 ----------
const vq = JSON.parse(readFileSync(new URL("./vectors-query.json", import.meta.url), "utf8"));
test("查詢結果：巢狀 Result 陣列解析與官方 SDK 相同", () => {
  assert.deepEqual(verifyAndDecrypt({ EncryptInfo: vq.encryptInfo, HashInfo: vq.hashInfo }, keys), vq.decrypted);
});
test("查詢結果：DataSource=A、已付款 → paid", () => {
  const rows = queryRows(verifyAndDecrypt({ EncryptInfo: vq.encryptInfo, HashInfo: vq.hashInfo }, keys));
  assert.equal(rows.length, 2);
  assert.deepEqual(mapQueryResult(rows[0], { merTradeNo: "PD0001", amount: 120 }), { kind: "paid", tradeNo: "1700000000001", amount: 120, paymentType: "信用卡" });
});
test("查詢結果：DataSource=B → 10 分鐘後再查", () => {
  const rows = queryRows(verifyAndDecrypt({ EncryptInfo: vq.encryptInfo, HashInfo: vq.hashInfo }, keys));
  assert.deepEqual(mapQueryResult(rows[1], { merTradeNo: "PD0002", amount: 30 }), { kind: "unknown", reason: "查詢資料處理中未完整", retryAfterMin: 10 });
});
test("查詢結果：交易逾期 → failed；未付款 → pending", () => {
  const b = { Status: "SUCCESS", MerTradeNo: "PD0003", DataSource: "A", TradeAmt: "30" };
  assert.deepEqual(mapQueryResult({ ...b, TradeStatus: "4" }, { merTradeNo: "PD0003", amount: 30 }), { kind: "failed", reason: "交易逾期" });
  assert.equal(mapQueryResult({ ...b, TradeStatus: "9" }, { merTradeNo: "PD0003", amount: 30 }).kind, "pending");
});
test("parse_str 不會被 __proto__ 鍵污染", () => {
  const cfg = { env: "sandbox" as const, merId: "ABC", ...keys };
  const f = buildUppForm(cfg, { merTradeNo: "PD0009", amount: 30, prodDesc: "x", returnUrl: "https://e.com", notifyUrl: "https://e.com" });
  const d = parseCallback(cfg, { EncryptInfo: f.fields.EncryptInfo, HashInfo: f.fields.HashInfo }).data;
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(d.MerTradeNo, "PD0009");
});

// ---------- 錯誤代碼分類 ----------

test("錯誤代碼分類", () => {
  assert.equal(classifyError("UPP01007").kind, "duplicate");
  assert.equal(classifyError("UPP02048").kind, "expired");
  assert.equal(classifyError("UPP05003").kind, "declined");
  assert.equal(classifyError("UPP02029").kind, "config");
  assert.equal(classifyError("DEF01007").kind, "config");
  assert.equal(classifyError("UPP01001").kind, "retry");
  assert.equal(classifyError("CRD00001").kind, "declined");
});

// ---------- 統一金流開發專區公布的範例（Node.js 範例、PHP 範例頁，2026-10-22 取得） ----------
// 範例頁的密文在 PDF 中被截斷，因此比對開頭；Node.js 範例另公布完整 SHA256，可證明整串 EncryptInfo 一致。
const docKeys = { hashKey: "12345678901234567890123456789012", hashIV: "1234567890123456" };
test("官方 Node.js 範例：EncryptInfo 開頭與 SHA256 完全一致", () => {
  const e = encrypt({ MerID: "AAA", MerTradeNO: "BBB", Prod: "商品說明" }, docKeys);
  assert.ok(e.startsWith("47396636346f66735853533167396942344f587a3775696b34732b596e70452b675270564f73536b7753446c6a4d77526d4e3"));
  assert.equal(hashInfo(e, docKeys), "E97180D78C8378D64A188D292938B9D2717034F292B626019B01DF160AEFC0B7");
  assert.deepEqual(decrypt(e, docKeys), { MerID: "AAA", MerTradeNO: "BBB", Prod: "商品說明" });
});
test("官方 PHP 範例：EncryptInfo 開頭一致，解密為 MerID=AAA&MerTradeNo=BBB", () => {
  const e = encrypt({ MerID: "AAA", MerTradeNo: "BBB" }, docKeys);
  assert.ok(e.startsWith("47396636346f66735853533167396942344f587a3775696b34752b596e70452b3a3a3a4373354a5a5143306"));
  assert.deepEqual(decrypt(e, docKeys), { MerID: "AAA", MerTradeNo: "BBB" });
});
