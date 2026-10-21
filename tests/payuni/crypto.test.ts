// 以官方 PHP SDK 產生的向量驗證 TypeScript 實作：npm run test:payuni
// 向量重新產生：php tests/payuni/gen-vectors.php <PayuniApi.php 路徑> > tests/payuni/vectors.json
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
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

import { buildUppForm, parseCallback } from "../../src/lib/payments/payuni/client";

test("UPP 表單：測試區網址、外層四個欄位、可被自己解回", () => {
  const cfg = { env: "sandbox" as const, merId: "ABC", ...keys };
  const f = buildUppForm(cfg, { merTradeNo: "PD0001", amount: 120, returnUrl: "https://example.com/r", notifyUrl: "https://example.com/n" });
  assert.equal(f.action, "https://sandbox-api.payuni.com.tw/api/upp");
  assert.deepEqual(Object.keys(f.fields), ["MerID", "Version", "EncryptInfo", "HashInfo"]);
  const back = parseCallback(cfg, { MerID: "ABC", Status: "SUCCESS", EncryptInfo: f.fields.EncryptInfo, HashInfo: f.fields.HashInfo });
  assert.equal(back.data.MerTradeNo, "PD0001");
  assert.equal(back.data.TradeAmt, "120");
});

test("回呼的 MerID 不是我們的商店時拒絕", () => {
  const cfg = { env: "sandbox" as const, merId: "ABC", ...keys };
  const f = buildUppForm(cfg, { merTradeNo: "PD0002", amount: 30, returnUrl: "https://example.com/r", notifyUrl: "https://example.com/n" });
  assert.throws(() => parseCallback({ ...cfg, merId: "XYZ" }, { MerID: "ABC", EncryptInfo: f.fields.EncryptInfo, HashInfo: f.fields.HashInfo }), /MerID/);
});

test("金額必須是正整數", () => {
  const cfg = { env: "sandbox" as const, merId: "ABC", ...keys };
  assert.throws(() => buildUppForm(cfg, { merTradeNo: "x", amount: 12.5, returnUrl: "", notifyUrl: "" }), /正整數/);
});
