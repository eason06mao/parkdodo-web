// 開發用：直接在資料庫產生配對碼（正式環境請用後台「配對工控機」）
//   DATABASE_URL=... npx tsx scripts/dev-pairing-code.ts [站點代碼，預設 TXG001]
import pg from "pg";
import { createPairingCode } from "../src/lib/edge/service";

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    const s = (await c.query("SELECT id FROM sites WHERE code = $1", [process.argv[2] ?? "TXG001"])).rows[0];
    if (!s) throw new Error("找不到站點");
    console.log((await createPairingCode(c, { siteId: s.id, edgeName: "開發測試工控機" })).code);
  } finally { await c.end(); }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
