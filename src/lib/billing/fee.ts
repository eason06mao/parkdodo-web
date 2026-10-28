// 計費引擎（純函式，雲端報價與 Edge 離線計費共用同一套規則）
// 規則（2026-10 確定）：
//   1. 免費短停 freeMinutes（預設 10 分鐘）；超過就「從入場時間起算」，不扣免費時間
//   2. 每 unitMinutes（預設 30 分鐘）一個計費單位，未滿以一單位計：11–30 分＝1 單位、31–60 分＝2 單位、剛好 30 分＝1 單位
//   3. 計時精度預設「分鐘」（不足 1 分鐘的秒數捨去）；可改「秒」（多 1 秒就進位）
//   4. 付款後 exitGraceMinutes（預設 15 分鐘）內須離場；超時補收差額
//   5. 當日上限預設不設；場站可設定。上限期間可選「日曆日（台北）」或「入場起每 24 小時」
//   6. 單價依場站設定，可預排促銷檔期。跨檔期計價可選：
//        entry_time（預設）＝整趟用入場時生效的費率；segmented＝每個計費單位用它開始時生效的單價
//   7. 付款後超時離場可選：
//        recalc_from_entry（預設）＝從入場重算總額、補收差額；from_grace_end＝從寬限期結束起另計，不再給免費時間
// 金額一律新台幣整數。

export type Precision = "minute" | "second";
export type CapWindow = "calendar_day" | "rolling_24h";
export type PromoMode = "entry_time" | "segmented";
export type OverstayMode = "recalc_from_entry" | "from_grace_end";

export interface RatePlan {
  freeMinutes: number;
  unitMinutes: number;
  unitPrice: number;
  precision: Precision;
  dailyCap: number | null;
  capWindow: CapWindow;
  exitGraceMinutes: number;
  promoMode: PromoMode;
  overstayMode: OverstayMode;
}

export const DEFAULT_PLAN: RatePlan = {
  freeMinutes: 10, unitMinutes: 30, unitPrice: 30, precision: "minute",
  dailyCap: null, capWindow: "calendar_day", exitGraceMinutes: 15,
  promoMode: "entry_time", overstayMode: "recalc_from_entry",
};

export interface Promotion {
  id: string;
  name: string;
  startsAt: string;            // ISO，含時區
  endsAt: string;              // ISO，不含（[startsAt, endsAt)）
  overrides: Partial<Pick<RatePlan, "unitPrice" | "freeMinutes" | "dailyCap">>;
}

export interface RateSchedule { base: RatePlan; promotions: Promotion[] }

export interface FeeResult {
  amount: number;
  billableUnits: number;
  /** 停車時長（依精度計算後），分鐘或秒 */
  duration: { minutes: number; seconds: number };
  free: boolean;
  capped: boolean;
  /** 每個上限期間的明細（有設上限時才有意義） */
  periods: { key: string; units: number; raw: number; charged: number }[];
  plan: RatePlan;
  promotion?: { id: string; name: string };
}

const TZ = "Asia/Taipei";
const dayKey = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(ms));

export function validatePlan(p: RatePlan): string | null {
  const int = (n: number) => Number.isInteger(n);
  if (!int(p.freeMinutes) || p.freeMinutes < 0 || p.freeMinutes > 120) return "免費時間需為 0 到 120 分鐘的整數。";
  if (!int(p.unitMinutes) || p.unitMinutes < 1 || p.unitMinutes > 240) return "計費單位需為 1 到 240 分鐘的整數。";
  if (!int(p.unitPrice) || p.unitPrice < 0 || p.unitPrice > 10000) return "單價需為 0 到 10,000 元的整數。";
  if (p.dailyCap !== null && (!int(p.dailyCap) || p.dailyCap < p.unitPrice)) return "當日上限需為整數，且不能低於單價。";
  if (!int(p.exitGraceMinutes) || p.exitGraceMinutes < 5 || p.exitGraceMinutes > 60) return "付款後離場時間需為 5 到 60 分鐘。";
  if (p.precision !== "minute" && p.precision !== "second") return "計時精度設定錯誤。";
  if (p.capWindow !== "calendar_day" && p.capWindow !== "rolling_24h") return "當日上限期間設定錯誤。";
  if (p.promoMode !== "entry_time" && p.promoMode !== "segmented") return "跨檔期計價方式設定錯誤。";
  if (p.overstayMode !== "recalc_from_entry" && p.overstayMode !== "from_grace_end") return "超時離場計費方式設定錯誤。";
  return null;
}

/** 入場當下生效的費率（基本費率＋當時進行中的促銷） */
export function planAt(schedule: RateSchedule, atIso: string): { plan: RatePlan; promotion?: Promotion } {
  const t = Date.parse(atIso);
  const promo = schedule.promotions
    .filter((p) => Date.parse(p.startsAt) <= t && t < Date.parse(p.endsAt))
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))[0];
  return promo ? { plan: { ...schedule.base, ...promo.overrides }, promotion: promo } : { plan: schedule.base };
}

/** 計算停車費。priceAt 用於「分段計價」：回傳某個計費單位開始時的單價；沒給就全部用 plan.unitPrice。 */
export function calculateFee(plan: RatePlan, entryIso: string, exitIso: string, priceAt?: (unitStartMs: number) => number): FeeResult {
  const entry = Date.parse(entryIso);
  const exit = Date.parse(exitIso);
  if (Number.isNaN(entry) || Number.isNaN(exit)) throw new Error("時間格式錯誤");
  const ms = Math.max(0, exit - entry);
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const base = { duration: { minutes, seconds }, plan, periods: [] as FeeResult["periods"] };

  // 1. 免費短停：分鐘精度看整分鐘；秒精度看秒數
  const withinFree = plan.precision === "minute" ? minutes <= plan.freeMinutes : seconds <= plan.freeMinutes * 60;
  if (withinFree || (plan.unitPrice === 0 && !priceAt)) return { ...base, amount: 0, billableUnits: 0, free: withinFree, capped: false };

  // 2. 從入場起算的計費單位數
  const unitSec = plan.unitMinutes * 60;
  const units = plan.precision === "minute" ? Math.ceil(minutes / plan.unitMinutes) : Math.ceil(seconds / unitSec);

  const unitPrice = (k: number) => (priceAt ? priceAt(entry + k * unitSec * 1000) : plan.unitPrice);

  if (plan.dailyCap === null) {
    let amount = 0;
    for (let k = 0; k < units; k++) amount += unitPrice(k);
    return { ...base, amount, billableUnits: units, free: false, capped: false };
  }

  // 3. 當日上限：每個計費單位歸屬於它「開始時」所在的期間，避免跨午夜多收一個單位
  const buckets = new Map<string, { units: number; raw: number }>();
  for (let k = 0; k < units; k++) {
    const startMs = entry + k * unitSec * 1000;
    const key = plan.capWindow === "calendar_day" ? dayKey(startMs) : `D${Math.floor((k * unitSec) / 86400) + 1}`;
    const b = buckets.get(key) ?? { units: 0, raw: 0 };
    b.units += 1; b.raw += unitPrice(k);
    buckets.set(key, b);
  }
  const periods = [...buckets.entries()].map(([key, b]) => ({ key, units: b.units, raw: b.raw, charged: Math.min(b.raw, plan.dailyCap!) }));
  const amount = periods.reduce((s, p) => s + p.charged, 0);
  return { ...base, periods, amount, billableUnits: units, free: false, capped: periods.some((p) => p.raw > p.charged) };
}

/** 依排程計費。免費時間、精度、上限一律用入場時的設定；單價依 promoMode 決定。 */
export function quote(schedule: RateSchedule, entryIso: string, atIso: string): FeeResult {
  const { plan, promotion } = planAt(schedule, entryIso);
  if (plan.promoMode === "segmented" && schedule.promotions.length > 0) {
    const r = calculateFee(plan, entryIso, atIso, (ms) => planAt(schedule, new Date(ms).toISOString()).plan.unitPrice);
    return promotion ? { ...r, promotion: { id: promotion.id, name: promotion.name } } : r;
  }
  const r = calculateFee(plan, entryIso, atIso);
  return promotion ? { ...r, promotion: { id: promotion.id, name: promotion.name } } : r;
}

/**
 * 出口判斷：付款後在寬限時間內離場 → 放行；超時 → 依 overstayMode 補收：
 *   recalc_from_entry：從入場重算總額 − 已付；from_grace_end：寬限期結束到離場另計（不給免費時間）
 */
export function exitCheck(schedule: RateSchedule, s: { entryAt: string; paidAt: string; paidAmount: number }, exitIso: string):
  { allow: true } | { allow: false; extra: number; reason: string } {
  const { plan } = planAt(schedule, s.entryAt);
  const overMs = Date.parse(exitIso) - Date.parse(s.paidAt) - plan.exitGraceMinutes * 60_000;
  if (overMs <= 0) return { allow: true };
  const graceEnd = new Date(Date.parse(s.paidAt) + plan.exitGraceMinutes * 60_000).toISOString();
  const extra = plan.overstayMode === "from_grace_end"
    ? calculateFee({ ...plan, freeMinutes: 0 }, graceEnd, exitIso).amount
    : Math.max(0, quote(schedule, s.entryAt, exitIso).amount - s.paidAmount);
  if (extra === 0) return { allow: true };
  return { allow: false, extra, reason: `付款後超過 ${plan.exitGraceMinutes} 分鐘才離場，需補繳 ${extra} 元` };
}
