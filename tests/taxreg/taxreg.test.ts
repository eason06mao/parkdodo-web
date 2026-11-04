// npm run test:taxreg — 營業稅籍資料解析
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
// @ts-expect-error JS 模組
import { findColumns, parseCsvLine, records } from "../../scripts/import-tax-registry.mjs";

test("CSV：引號、引號內逗號、跳脫的雙引號", () => {
  assert.deepEqual(parseCsvLine('a,"b,c","d ""e""",f'), ["a", "b,c", 'd "e"', "f"]);
});

test("找欄位：不管順序，不會誤抓「總機構統一編號」", () => {
  assert.deepEqual(findColumns(["營業地址", "統一編號", "總機構統一編號", "營業人名稱"]), { idIdx: 1, nameIdx: 3 });
  assert.deepEqual(findColumns(["﻿營業人名稱", "總機構統一編號", "統一編號"]), { idIdx: 2, nameIdx: 0 });
  assert.equal(findColumns(["a", "b"]), null);
});

test("逐行讀取：略過標題前的說明、壞資料；格式變了要報錯", async () => {
  const lines = ["資料日期：1151103", "營業地址,統一編號,總機構統一編號,營業人名稱", '臺中市,10000004,,"示範停車股份有限公司"', "臺北市,ABC,,壞資料", "臺北市,10000010,10000004,示範物流有限公司\r"];
  const got = [];
  for await (const r of records(Readable.from(lines))) got.push(r);
  assert.deepEqual(got, [["10000004", "示範停車股份有限公司"], ["10000010", "示範物流有限公司"]]);
  await assert.rejects(async () => { for await (const _ of records(Readable.from(["x,y", "1,2"]))) void _; }, /標題列/);
});
