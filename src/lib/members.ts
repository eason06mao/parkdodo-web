// 會員（手機號碼）與月租登記單：前後端共用的規則。
import { formatPlate, isTwPlate } from "./monthly";

export const PRIVACY_VERSION = "2026-11";
export const MAX_MEMBER_PLATES = 3;
export const OTP_TTL_SEC = 5 * 60;
export const OTP_RESEND_SEC = 60;
export const OTP_MAX_PER_HOUR = 5;
export const OTP_MAX_ATTEMPTS = 5;

/** 台灣手機 → 09XXXXXXXX；不是手機號碼回傳 null。接受 0912-345-678、+886 912 345 678 */
export function normalizePhone(s: string): string | null {
  let d = (s ?? "").replace(/\D/g, "");
  if (d.startsWith("886")) d = "0" + d.slice(3);
  if (d.length === 9 && d.startsWith("9")) d = "0" + d;
  return /^09\d{8}$/.test(d) ? d : null;
}
export const formatPhone = (p: string) => (p.length === 10 ? `${p.slice(0, 4)}-${p.slice(4, 7)}-${p.slice(7)}` : p);
/** 後台清單用：0912-***-678 */
export const maskPhone = (p: string) => (p.length === 10 ? `${p.slice(0, 4)}-***-${p.slice(7)}` : p);

/** 車主常忘了打「-」：英文、數字只有一個交界時自動補上（ABC1234 → ABC-1234） */
export function memberPlate(s: string) {
  const f = formatPlate(s);
  if (f.includes("-")) return f;
  const m = /^([A-Z]+)(\d+)$/.exec(f) ?? /^(\d+)([A-Z]+)$/.exec(f);
  return m ? `${m[1]}-${m[2]}` : f;
}

export type Provider = "line" | "google" | "phone";
export const PROVIDER_LABELS: Record<Provider, string> = { line: "LINE", google: "Google", phone: "手機簡訊" };

export type LeadStatus = "new" | "contacted" | "converted" | "closed";
export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = { new: "新登記", contacted: "已聯絡", converted: "已建約", closed: "不租了" };

export interface MemberProfileInput {
  name: string;
  plates: string[];
  lead?: { siteCode: string; planId: string | null; name: string; phone: string; note: string } | null;
}
export type ProfileErrors = { name?: string; plates?: Record<number, string>; lead?: string; leadName?: string; leadPhone?: string };

export function validateProfile(v: MemberProfileInput): ProfileErrors {
  const e: ProfileErrors = {};
  if (v.name.trim().length > 30) e.name = "稱呼最多 30 個字。";
  const plates: Record<number, string> = {};
  const seen = new Set<string>();
  const list = v.plates.map((p) => p.trim()).filter(Boolean);
  if (list.length > MAX_MEMBER_PLATES) e.lead = `車牌最多 ${MAX_MEMBER_PLATES} 台。`;
  list.forEach((p, i) => {
    const f = memberPlate(p);
    if (!isTwPlate(f)) plates[i] = "車牌格式應為 ABC-1234。";
    else if (seen.has(f.replace("-", ""))) plates[i] = "車牌重複。";
    seen.add(f.replace("-", ""));
  });
  if (Object.keys(plates).length) e.plates = plates;
  if (v.lead) {
    if (!v.lead.siteCode) e.lead = "請選擇想租的停車場。";
    const n = v.lead.name.trim() || v.name.trim();
    if (!n) e.leadName = "請留個稱呼，客服才知道怎麼稱呼你。";
    if (!normalizePhone(v.lead.phone)) e.leadPhone = "請留 09 開頭的手機號碼，客服會打這支電話。";
    if (v.lead.note.length > 200) e.lead = "備註最多 200 字。";
  }
  return e;
}
export const hasProfileErrors = (e: ProfileErrors) => Object.keys(e).length > 0;

/** 送驗證碼的頻率限制（純函式，方便測試） */
export interface OtpState { codeHash: string; expiresAt: number; attempts: number; sentAt: number; sendsHour: number; hourStart: number }
export function canSend(s: OtpState | null, now: number): { ok: true; sendsHour: number; hourStart: number } | { ok: false; waitSec: number; reason: "resend" | "hourly" } {
  if (!s) return { ok: true, sendsHour: 1, hourStart: now };
  const since = (now - s.sentAt) / 1000;
  if (since < OTP_RESEND_SEC) return { ok: false, waitSec: Math.ceil(OTP_RESEND_SEC - since), reason: "resend" };
  const sameHour = now - s.hourStart < 3600_000;
  if (sameHour && s.sendsHour >= OTP_MAX_PER_HOUR) return { ok: false, waitSec: Math.ceil((s.hourStart + 3600_000 - now) / 1000), reason: "hourly" };
  return sameHour ? { ok: true, sendsHour: s.sendsHour + 1, hourStart: s.hourStart } : { ok: true, sendsHour: 1, hourStart: now };
}
export type VerifyResult = "ok" | "wrong" | "expired" | "locked" | "none";
export function checkCode(s: OtpState | null, hash: string, now: number): VerifyResult {
  if (!s) return "none";
  if (s.attempts >= OTP_MAX_ATTEMPTS) return "locked";
  if (now > s.expiresAt) return "expired";
  return s.codeHash === hash ? "ok" : "wrong";
}
