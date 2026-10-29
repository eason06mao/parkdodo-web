// 用 DATABASE_URL 直接套用 migration（雲端與 CI 用；本機 Docker 請用 npm run db:migrate）。
//   node scripts/migrate.mjs            只套用還沒跑過的 migration
//   node scripts/migrate.mjs --seed     另外寫入測試站種子資料（可重複執行）
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("請設定 DATABASE_URL"); process.exit(1); }
const dir = new URL("../db/migrations/", import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();

const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  await c.query("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  await c.query("SELECT pg_advisory_lock(424242)");   // 避免兩個部署同時套用
  const done = new Set((await c.query("SELECT version FROM schema_migrations")).rows.map((r) => r.version));
  let n = 0;
  for (const f of files) {
    const v = f.replace(/\.sql$/, "");
    if (done.has(v)) continue;
    await c.query(readFileSync(join(dir, f), "utf8"));
    await c.query("INSERT INTO schema_migrations (version) VALUES ($1)", [v]);
    console.log(`已套用 ${v}`); n++;
  }
  console.log(n ? `資料表更新完成（${n} 個）。` : "資料表已是最新。");
  if (process.argv.includes("--seed")) {
    await c.query(readFileSync(new URL("../db/seed/staging_seed.sql", import.meta.url).pathname, "utf8"));
    console.log("已寫入測試站種子資料。");
  }
} finally {
  await c.query("SELECT pg_advisory_unlock(424242)").catch(() => {});
  await c.end();
}
