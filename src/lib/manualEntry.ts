// 人工補登入場：找不到入場紀錄時，客服輸入車牌與入場時間，系統算出應付金額，付款後放行。
// 前端即時檢查與後端 API 共用同一套規則。

export const MANUAL_REASONS = [
  { code: "no_entry_record", label: "找不到入場紀錄" },
  { code: "plate_misread", label: "入場時車牌辨識錯誤" },
  { code: "device_offline", label: "入口設備斷線或故障" },
  { code: "followed_vehicle", label: "跟車進場" },
  { code: "other", label: "其他" },
] as const;
export type ManualReason = (typeof MANUAL_REASONS)[number]["code"];

export const MAX_BACKFILL_DAYS = 7; // 補登的入場時間最多往前 7 天（待決：依營運調整）

export interface ManualEntryInput {
  siteId: string;
  plate: string;
  entryAt: string;        // ISO
  reason: ManualReason;
  note: string;
  evidence: string;       // 依據：車主說法、監視器畫面時間、停車券等
}

export const normalizePlate = (s: string) => s.toUpperCase().replace(/\s/g, "");
export const isPlate = (s: string) => /^[A-Z0-9]{2,4}-?[A-Z0-9]{2,4}$/.test(normalizePlate(s));

export function validateManualEntry(v: ManualEntryInput, now = Date.now()): Partial<Record<keyof ManualEntryInput, string>> {
  const e: Partial<Record<keyof ManualEntryInput, string>> = {};
  if (!v.siteId) e.siteId = "請選擇站點。";
  if (!isPlate(v.plate)) e.plate = "請輸入完整車牌，例如 ABC-1234。";
  const t = Date.parse(v.entryAt);
  if (Number.isNaN(t)) e.entryAt = "請填寫入場時間。";
  else if (t > now) e.entryAt = "入場時間不能晚於現在。";
  else if (now - t > MAX_BACKFILL_DAYS * 86400_000) e.entryAt = `只能補登 ${MAX_BACKFILL_DAYS} 天內的入場；更早的請主管處理。`;
  if (!MANUAL_REASONS.some((r) => r.code === v.reason)) e.reason = "請選擇原因。";
  if (v.reason === "other" && !v.note.trim()) e.note = "原因選「其他」時請填寫說明。";
  if (!v.evidence.trim()) e.evidence = "請填寫入場時間的依據，例如監視器畫面時間或車主說法。";
  return e;
}
