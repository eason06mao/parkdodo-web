// 產生計費測試向量，讓工控機（C#）的計費結果和雲端（TypeScript）逐筆比對。
//   npx tsx scripts/gen-fee-vectors.ts   → edge/ParkDodo.Edge.Tests/fee_vectors.json
import { writeFileSync } from "node:fs";
import { DEFAULT_PLAN, exitCheck, quote, type RatePlan, type RateSchedule } from "../src/lib/billing/fee";

const plans: RatePlan[] = [
  DEFAULT_PLAN,
  { ...DEFAULT_PLAN, precision: "second" },
  { ...DEFAULT_PLAN, unitPrice: 20, dailyCap: 150 },
  { ...DEFAULT_PLAN, unitPrice: 40, dailyCap: 200, capWindow: "rolling_24h" },
  { ...DEFAULT_PLAN, freeMinutes: 0, unitMinutes: 60, unitPrice: 50 },
  { ...DEFAULT_PLAN, overstayMode: "from_grace_end" },
  { ...DEFAULT_PLAN, promoMode: "segmented" },
];
const promo = [{ id: "p1", name: "週末優惠", startsAt: "2026-11-07T00:00:00+08:00", endsAt: "2026-11-09T00:00:00+08:00", overrides: { unitPrice: 10, dailyCap: null } }];
const schedules: RateSchedule[] = [
  ...plans.map((base) => ({ base, promotions: [] })),
  { base: plans[0], promotions: promo },
  { base: plans[6], promotions: promo },
  { base: { ...plans[2] }, promotions: [{ ...promo[0], overrides: { freeMinutes: 30 } }] },
];
const entries = ["2026-11-06T22:47:13+08:00", "2026-11-07T10:00:00+08:00", "2026-11-08T23:30:30+08:00"];
const durationsSec = [0, 59, 600, 659, 660, 661, 1799, 1800, 1801, 3600, 3661, 5400, 7261, 36000, 86399, 86400, 90061, 180000];

const vectors: unknown[] = [];
schedules.forEach((s, si) => {
  for (const entry of entries) for (const d of durationsSec) {
    const at = new Date(Date.parse(entry) + d * 1000).toISOString();
    vectors.push({ kind: "quote", schedule: si, entry, at, amount: quote(s, entry, at).amount });
  }
  for (const entry of entries) for (const [paidAfter, exitAfter] of [[3600, 3600 + 600], [3600, 3600 + 900], [3600, 3600 + 901], [3600, 3600 + 2700], [7000, 7000 + 5000]]) {
    const paidAt = new Date(Date.parse(entry) + paidAfter * 1000).toISOString();
    const exit = new Date(Date.parse(entry) + exitAfter * 1000).toISOString();
    const paidAmount = quote(s, entry, paidAt).amount;
    const r = exitCheck(s, { entryAt: entry, paidAt, paidAmount }, exit);
    vectors.push({ kind: "exit", schedule: si, entry, paidAt, paidAmount, exit, extra: r.allow ? null : r.extra });
  }
});
writeFileSync("edge/ParkDodo.Edge.Tests/fee_vectors.json", JSON.stringify({ generatedBy: "scripts/gen-fee-vectors.ts", schedules, vectors }, null, 1));
console.log(`寫入 ${vectors.length} 筆計費向量`);
