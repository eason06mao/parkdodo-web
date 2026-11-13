// 沒有雲端資料庫時（本機開發）：繳費頁用的示範報價。進場 2 小時 15 分、每 30 分鐘 30 元。
const g = globalThis as unknown as { __pdMockQuotes?: Map<string, { plate: string; amount: number; expiresAt: number }> };
g.__pdMockQuotes ??= new Map();

export function mockQuote(siteName: string, plate: string) {
  const minutes = 135;
  const amount = Math.ceil(minutes / 30) * 30;
  const quoteId = crypto.randomUUID();
  const expiresAt = Date.now() + 10 * 60_000;
  g.__pdMockQuotes!.set(quoteId, { plate, amount, expiresAt });
  return { kind: "pay" as const, quoteId, plate, siteName, entryAt: new Date(Date.now() - minutes * 60_000).toISOString(), minutes, amount,
    expiresAt: new Date(expiresAt).toISOString(), overstay: false, mock: true, photo: null };
}
export const mockQuoteValid = (id: string) => (g.__pdMockQuotes!.get(id)?.expiresAt ?? 0) > Date.now();
