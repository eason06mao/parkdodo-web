import { Pool, type PoolClient } from "pg";

// 資料庫連線。DATABASE_URL 沒設定時回傳 null，畫面繼續用 Mock 資料。
// Cloud Run 透過 Cloud SQL 連線器以 Unix socket 連線（DATABASE_URL 內 host=/cloudsql/...）。
const g = globalThis as unknown as { __pdPool?: Pool };

export function dbConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}

export function pool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  g.__pdPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 5, idleTimeoutMillis: 30_000 });
  return g.__pdPool;
}

/** 在一個交易內執行；出錯自動 ROLLBACK */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
