// 統一編號查營業人名稱（財政部營業稅籍開放資料，每日匯入 tax_registry）。
// 沒有雲端資料庫時（Mock）只認得幾個示範統編。查不到不代表統編無效：新設立的公司會晚幾天才有資料，
// 學校、機關、協會等非營業人也不在這份資料裡。
import { dbConfigured, pool } from "./db";
import { isTaxId } from "./invoice";

export type TaxLookup = { status: "found"; name: string } | { status: "not_found" } | { status: "invalid" };

const DEMO: Record<string, string> = {
  "10000004": "示範停車股份有限公司",
  "10000010": "示範物流有限公司",
};

export async function lookupTaxId(id: string): Promise<TaxLookup> {
  if (!isTaxId(id)) return { status: "invalid" };
  if (!dbConfigured()) return DEMO[id] ? { status: "found", name: DEMO[id] } : { status: "not_found" };
  const r = await pool().query("SELECT name FROM tax_registry WHERE tax_id = $1", [id]);
  return r.rows[0] ? { status: "found", name: r.rows[0].name as string } : { status: "not_found" };
}
