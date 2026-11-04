// 匯入財政部「全國營業(稅籍)登記資料集」的統一編號與營業人名稱到 tax_registry。
//   DATABASE_URL=... node scripts/import-tax-registry.mjs              下載官方 ZIP 後匯入
//   DATABASE_URL=... node scripts/import-tax-registry.mjs --file x.csv  匯入本機 CSV（或 ZIP）
// 規則：
//   - 自動找出標題列中的「統一編號」「營業人名稱」欄位（欄位順序變動也能處理）
//   - 分批 upsert；全部成功、且筆數合理（超過 100 萬筆）時，才刪除這次沒出現的統編（＝已歇業）
//   - 筆數太少視為下載不完整：只更新、不刪除，並讓這次執行失敗，GitHub 會寄信通知
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import pg from "pg";

export const SOURCE_URL = "https://eip.fia.gov.tw/data/BGMOPEN1.zip";
const MIN_ROWS_FOR_DELETE = 1_000_000;
const BATCH = 5000;

/** 解析一行 CSV（支援雙引號與引號內逗號） */
export function parseCsvLine(line) {
  const out = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** 從標題列找欄位位置；找不到回傳 null */
export function findColumns(cells) {
  const clean = cells.map((c) => c.replace(/^﻿/, "").trim());
  const idIdx = clean.findIndex((c) => c === "統一編號");
  const nameIdx = clean.findIndex((c) => c === "營業人名稱");
  return idIdx >= 0 && nameIdx >= 0 ? { idIdx, nameIdx } : null;
}

/** 逐行讀取，回傳 [統編, 名稱] 的 async iterator */
export async function* records(lines) {
  let cols = null;
  for await (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    if (!cols) { cols = findColumns(cells); continue; }   // 標題列之前的說明文字略過
    const id = (cells[cols.idIdx] ?? "").replace(/\D/g, "");
    const name = (cells[cols.nameIdx] ?? "").trim();
    if (/^\d{8}$/.test(id) && name) yield [id, name.slice(0, 200)];
  }
  if (!cols) throw new Error("找不到「統一編號」「營業人名稱」標題列，資料格式可能變了");
}

async function download(dir) {
  const zip = join(dir, "BGMOPEN1.zip");
  const r = await fetch(SOURCE_URL, { headers: { "User-Agent": "ParkDodo-TaxRegistrySync/1.0" } });
  if (!r.ok || !r.body) throw new Error(`下載失敗：${r.status}`);
  await pipeline(r.body, createWriteStream(zip));
  return zip;
}

/** 逐行讀檔：ZIP 用系統的 unzip 直接串流解壓（不落地），CSV 直接讀 */
export function linesOf(file) {
  const input = file.toLowerCase().endsWith(".zip")
    ? spawn("unzip", ["-p", file], { stdio: ["ignore", "pipe", "inherit"] }).stdout
    : createReadStream(file, "utf8");
  return createInterface({ input, crlfDelay: Infinity });
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("請設定 DATABASE_URL");
  const i = process.argv.indexOf("--file");
  const dir = mkdtempSync(join(tmpdir(), "taxreg-"));
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  const sync = (await c.query("INSERT INTO tax_registry_syncs (source) VALUES ($1) RETURNING id, started_at", [i > 0 ? process.argv[i + 1] : SOURCE_URL])).rows[0];
  let read = 0, upserted = 0, removed = 0;
  try {
    const file = i > 0 ? process.argv[i + 1] : await download(dir);
    const input = linesOf(file);
    let ids = [], names = [];
    const flush = async () => {
      if (!ids.length) return;
      const r = await c.query(
        `INSERT INTO tax_registry (tax_id, name, synced_at) SELECT * , $3::timestamptz FROM unnest($1::text[], $2::text[])
         ON CONFLICT (tax_id) DO UPDATE SET name = EXCLUDED.name, synced_at = EXCLUDED.synced_at`, [ids, names, sync.started_at]);
      upserted += r.rowCount ?? 0; ids = []; names = [];
    };
    const seen = new Set();
    for await (const [id, name] of records(input)) {
      read++;
      if (seen.has(id)) continue;   // 同一統編出現多次（總／分機構）只取第一筆
      seen.add(id); ids.push(id); names.push(name);
      if (ids.length >= BATCH) await flush();
    }
    await flush();
    if (seen.size >= MIN_ROWS_FOR_DELETE) {
      removed = (await c.query("DELETE FROM tax_registry WHERE synced_at < $1", [sync.started_at])).rowCount ?? 0;
    }
    await c.query("UPDATE tax_registry_syncs SET finished_at = now(), rows_read = $2, rows_upserted = $3, rows_removed = $4 WHERE id = $1", [sync.id, read, upserted, removed]);
    console.log(`完成：讀取 ${read} 筆、更新 ${upserted} 筆、移除歇業 ${removed} 筆`);
    if (seen.size < MIN_ROWS_FOR_DELETE && i < 0) throw new Error(`只讀到 ${seen.size} 筆，少於 ${MIN_ROWS_FOR_DELETE}，可能下載不完整（已更新、未刪除）`);
  } catch (e) {
    await c.query("UPDATE tax_registry_syncs SET finished_at = now(), rows_read = $2, rows_upserted = $3, error = $4 WHERE id = $1", [sync.id, read, upserted, String(e.message ?? e)]).catch(() => {});
    throw e;
  } finally {
    await c.end();
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error("❌", e.message); process.exit(1); });
