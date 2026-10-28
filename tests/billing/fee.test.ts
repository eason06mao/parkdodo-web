// npm run test:billing
import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateFee, DEFAULT_PLAN, exitCheck, planAt, quote, validatePlan, type RatePlan, type RateSchedule } from "../../src/lib/billing/fee";

const T0 = "2026-11-01T10:00:00+08:00";
const at = (sec: number, from = T0) => new Date(Date.parse(from) + sec * 1000).toISOString();
const m = (min: number, sec = 0) => at(min * 60 + sec);
const fee = (p: RatePlan, min: number, sec = 0) => calculateFee(p, T0, m(min, sec)).amount;
const P = DEFAULT_PLAN; // 免費 10 分、每 30 分 30 元、分鐘精度

test("免費短停：10 分鐘以內 0 元（含剛好 10 分、10 分 59 秒）", () => {
  assert.equal(fee(P, 0), 0);
  assert.equal(fee(P, 9, 59), 0);
  assert.equal(fee(P, 10), 0);
  assert.equal(fee(P, 10, 59), 0); // 分鐘精度：秒數捨去
});

test("超過 10 分鐘從入場起算：11–30 分收半小時", () => {
  assert.equal(fee(P, 11), 30);
  assert.equal(fee(P, 29, 59), 30);
  assert.equal(fee(P, 30), 30);      // 剛好 30 分收半小時
  assert.equal(fee(P, 30, 59), 30);  // 分鐘精度：仍算 30 分
});

test("31–60 分收 1 小時；之後每 30 分累加", () => {
  assert.equal(fee(P, 31), 60);
  assert.equal(fee(P, 60), 60);
  assert.equal(fee(P, 61), 90);
  assert.equal(fee(P, 135), 150);    // 2 時 15 分 → 5 單位
});

test("秒精度：多 1 秒就進位", () => {
  const S: RatePlan = { ...P, precision: "second" };
  assert.equal(fee(S, 10), 0);
  assert.equal(fee(S, 10, 1), 30);   // 超過免費時間 1 秒
  assert.equal(fee(S, 30), 30);
  assert.equal(fee(S, 30, 1), 60);   // 分鐘精度這裡是 30 元
  assert.equal(fee(P, 30, 1), 30);
});

test("免費時間不扣除：11 分鐘收的是 11 分鐘的費用，不是 1 分鐘", () => {
  const r = calculateFee(P, T0, m(11));
  assert.equal(r.billableUnits, 1);
  assert.equal(r.free, false);
});

test("沒有設定當日上限時不封頂", () => {
  assert.equal(fee(P, 24 * 60), 48 * 30); // 24 小時 = 48 單位
});

test("當日上限（日曆日）：每天最多收上限，跨午夜不多收一個單位", () => {
  const C: RatePlan = { ...P, dailyCap: 200, capWindow: "calendar_day" };
  assert.equal(fee(C, 600), 200);                      // 10 小時 600 元 → 200
  const late = "2026-11-01T23:50:00+08:00";
  const r = calculateFee(C, late, at(20 * 60, late));  // 23:50 → 00:10，20 分鐘
  assert.equal(r.amount, 30);
  assert.equal(r.billableUnits, 1);                    // 不會因跨日變 2 單位
  const two = calculateFee(C, "2026-11-01T20:00:00+08:00", "2026-11-02T20:00:00+08:00");
  assert.deepEqual(two.periods.map((p) => [p.key, p.charged]), [["2026-11-01", 200], ["2026-11-02", 200]]);
  assert.equal(two.amount, 400);
  assert.equal(two.capped, true);
});

test("當日上限（入場起每 24 小時）", () => {
  const R: RatePlan = { ...P, dailyCap: 200, capWindow: "rolling_24h" };
  const r = calculateFee(R, "2026-11-01T20:00:00+08:00", "2026-11-02T21:00:00+08:00"); // 25 小時
  assert.deepEqual(r.periods.map((p) => [p.key, p.units, p.charged]), [["D1", 48, 200], ["D2", 2, 60]]);
  assert.equal(r.amount, 260);
});

test("促銷檔期：入場時在檔期內就用促銷價，到期自動切回", () => {
  const sch: RateSchedule = { base: P, promotions: [{ id: "p1", name: "週年慶", startsAt: "2026-11-01T00:00:00+08:00", endsAt: "2026-11-08T00:00:00+08:00", overrides: { unitPrice: 20 } }] };
  assert.equal(quote(sch, T0, m(60)).amount, 40);
  assert.equal(quote(sch, T0, m(60)).promotion?.name, "週年慶");
  assert.equal(quote(sch, "2026-11-08T00:00:00+08:00", "2026-11-08T01:00:00+08:00").amount, 60); // endsAt 不含
  assert.equal(planAt(sch, "2026-10-31T23:59:59+08:00").promotion, undefined);
});

test("付款後 15 分鐘內離場放行；超時補差額", () => {
  const sch: RateSchedule = { base: P, promotions: [] };
  const s = { entryAt: T0, paidAt: m(25), paidAmount: 30 };
  assert.deepEqual(exitCheck(sch, s, m(40)), { allow: true });        // 付款後 15 分
  const late = exitCheck(sch, s, m(41));                               // 付款後 16 分，停 41 分 → 60 元
  assert.equal(late.allow, false);
  assert.equal(late.allow === false && late.extra, 30);
});

test("寬限超時但金額沒變（同一單位內）就放行", () => {
  const sch: RateSchedule = { base: P, promotions: [] };
  assert.deepEqual(exitCheck(sch, { entryAt: T0, paidAt: m(31), paidAmount: 60 }, m(55)), { allow: true });
});

test("費率參數檢查", () => {
  assert.equal(validatePlan(P), null);
  assert.match(validatePlan({ ...P, dailyCap: 10 }) ?? "", /上限/);
  assert.match(validatePlan({ ...P, unitMinutes: 0 }) ?? "", /計費單位/);
});

test("跨檔期計價（分段）：每個單位用它開始時的單價", () => {
  const promo = { id: "p", name: "早鳥", startsAt: "2026-11-01T09:00:00+08:00", endsAt: "2026-11-01T10:30:00+08:00", overrides: { unitPrice: 10 } };
  const entry = "2026-11-01T10:00:00+08:00", exit = "2026-11-01T11:00:00+08:00"; // 10:00、10:30 兩個單位
  const byEntry: RateSchedule = { base: P, promotions: [promo] };
  const seg: RateSchedule = { base: { ...P, promoMode: "segmented" }, promotions: [promo] };
  assert.equal(quote(byEntry, entry, exit).amount, 20);  // 預設：入場在檔期內 → 兩個單位都 10 元
  assert.equal(quote(seg, entry, exit).amount, 40);      // 分段：10:00 單位 10 元、10:30 單位 30 元
  const lateEntry = "2026-11-01T08:40:00+08:00";        // 入場在檔期前，09:10、09:40 落在檔期內
  assert.equal(quote(byEntry, lateEntry, "2026-11-01T10:10:00+08:00").amount, 90); // 3 單位 × 30
  assert.equal(quote(seg, lateEntry, "2026-11-01T10:10:00+08:00").amount, 50);     // 30 + 10 + 10
});

test("超時離場（從寬限期結束起算）：不再給免費時間", () => {
  const sch: RateSchedule = { base: { ...P, overstayMode: "from_grace_end" }, promotions: [] };
  const s = { entryAt: T0, paidAt: m(25), paidAmount: 30 };   // 寬限到 40 分
  assert.deepEqual(exitCheck(sch, s, m(40)), { allow: true });
  const r = exitCheck(sch, s, m(42));                          // 超過 2 分 → 1 單位
  assert.equal(r.allow === false && r.extra, 30);
  const r2 = exitCheck(sch, s, m(40 + 61));                    // 超過 61 分 → 3 單位
  assert.equal(r2.allow === false && r2.extra, 90);
  const def: RateSchedule = { base: P, promotions: [] };       // 對照預設：停 101 分 → 4 單位 120 − 30
  const r3 = exitCheck(def, s, m(101));
  assert.equal(r3.allow === false && r3.extra, 90);
});

test("新設定的參數檢查", () => {
  assert.match(validatePlan({ ...P, promoMode: "x" as never }) ?? "", /跨檔期/);
  assert.match(validatePlan({ ...P, overstayMode: "x" as never }) ?? "", /超時/);
});
