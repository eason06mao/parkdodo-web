// npm run test:invoice
import assert from "node:assert/strict";
import { test } from "node:test";
import { isLoveCode, isMobileBarcode, isTaxId, validateInvoice } from "../../src/lib/invoice";

test("統一編號：公開範例與擴充規則", () => {
  assert.equal(isTaxId("04595257"), true);   // 財政部常用範例
  assert.equal(isTaxId("10458575"), true);   // 第 7 碼為 7 的特例
  assert.equal(isTaxId("12345678"), false);
  assert.equal(isTaxId("1234567"), false);
  assert.equal(isTaxId("ABCDEFGH"), false);
});

test("手機條碼格式", () => {
  assert.equal(isMobileBarcode("/ABC+123"), true);
  assert.equal(isMobileBarcode("/AB.-1Z9"), true);
  assert.equal(isMobileBarcode("ABC+1234"), false);
  assert.equal(isMobileBarcode("/abc+123"), false);
  assert.equal(isMobileBarcode("/ABC+12"), false);
});

test("愛心碼格式", () => {
  assert.equal(isLoveCode("919"), true);
  assert.equal(isLoveCode("8585858"), true);
  assert.equal(isLoveCode("12"), false);
  assert.equal(isLoveCode("12345678"), false);
});

test("沒有繳費機時不能選紙本", () => {
  assert.match(validateInvoice({ kind: "paper" }, { paperEnabled: false }) ?? "", /繳費機/);
  assert.equal(validateInvoice({ kind: "paper" }, { paperEnabled: true }), null);
});

test("公司報帳需要統編與 Email", () => {
  assert.equal(validateInvoice({ kind: "company", taxId: "04595257", title: "", email: "a@b.co" }, { paperEnabled: false }), null);
  assert.match(validateInvoice({ kind: "company", taxId: "04595257", title: "", email: "x" }, { paperEnabled: false }) ?? "", /Email/);
});
