// 簡單的每 IP 次數限制（單一執行個體記憶體內；多個執行個體時各自計算，仍可擋住大量嘗試）。
// 用途：繳費頁「只打數字」查詢，避免有人連續輸入數字掃出場內車輛。
const g = globalThis as unknown as { __pdRate?: Map<string, number[]> };
g.__pdRate ??= new Map();

export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const m = g.__pdRate!;
  const hits = (m.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) { m.set(key, hits); return false; }
  hits.push(now);
  m.set(key, hits);
  if (m.size > 20_000) for (const [k, v] of m) if (!v.some((t) => now - t < windowMs)) m.delete(k);
  return true;
}

export const clientIp = (req: Request) =>
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
