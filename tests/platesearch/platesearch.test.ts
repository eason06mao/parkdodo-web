import { test } from "node:test";
import assert from "node:assert/strict";
import { canon, maskPlate, matchPlates, withinOneEdit } from "../../src/lib/payments/plateSearch";

const inside = ["ES2234", "ABC1234", "BBB2234", "XYZ9999", "2234AB", "RAA8812"];

test("完整車牌：大小寫、-、空白都可以", () => {
  for (const q of ["ES-2234", "es2234", "ES 2234", " es-2234 "]) assert.deepEqual(matchPlates(q, inside), { mode: "exact", plates: ["ES2234"] });
});

test("只打數字：列出含這串數字的車", () => {
  assert.deepEqual(matchPlates("2234", inside), { mode: "digits", plates: ["2234AB", "BBB2234", "ES2234"] });
  assert.deepEqual(matchPlates("9999", inside)?.plates, ["XYZ9999"]);
  assert.deepEqual(matchPlates("5555", inside)?.plates, []);
});

test("太短不查", () => {
  assert.equal(matchPlates("22", inside), null);
});

test("辨識混淆：8/B、0/D、1/I", () => {
  assert.deepEqual(matchPlates("RAA88I2", inside)?.plates, ["RAA8812"]);
  assert.deepEqual(matchPlates("RAABB12", inside)?.plates, ["RAA8812"]);
});

test("差一個字也列為候選，完全混淆吻合排前面", () => {
  assert.deepEqual(matchPlates("ABC1235", inside)?.plates, ["ABC1234"]);
  assert.deepEqual(matchPlates("AC1234", inside)?.plates, ["ABC1234"]);
});

test("編輯距離", () => {
  assert.ok(withinOneEdit("ABC", "ABD"));
  assert.ok(withinOneEdit("ABC", "AB"));
  assert.ok(!withinOneEdit("ABC", "AXY"));
  assert.equal(canon("BOS"), "805");
});

test("遮蔽英文字", () => {
  assert.equal(maskPlate("ABC1234"), "A**-1234");
  assert.equal(maskPlate("ES2234"), "E*-2234");
  assert.equal(maskPlate("2234AB"), "2234-A*");
});
