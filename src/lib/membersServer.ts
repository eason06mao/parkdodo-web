// 會員與月租登記單的後端。有雲端資料庫時以資料庫為主（Cloud Run 多台機器共用驗證碼與會員），沒有時存在記憶體。
// 登入方式：LINE、Google、手機簡訊（member_identities），都對應到同一位會員；已登入時再用另一種方式登入＝綁定。
// 簡訊：設定 SMS_PROVIDER 前一律是模擬模式，驗證碼直接顯示在畫面上；正式站沒設定簡訊商時拒絕寄送。
import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { dbConfigured, pool, tx } from "./db";
import { normalizePlate as edgePlate } from "./edge/service";
import {
  canSend, checkCode, hasProfileErrors, memberPlate, normalizePhone, OTP_MAX_ATTEMPTS, OTP_TTL_SEC, PRIVACY_VERSION, PROVIDER_LABELS, validateProfile,
  type LeadStatus, type MemberProfileInput, type OtpState, type ProfileErrors, type Provider,
} from "./members";
import { monthlyPlans } from "./mock/monthly";
import { siteRecords } from "./mock/tenancy";

export class MemberError extends Error {
  constructor(message: string, public status = 422, public errors?: ProfileErrors, public waitSec?: number) { super(message); }
}

export interface Member {
  id: string; name: string; phone: string | null; email: string | null; plates: string[];
  providers: Provider[]; sourceSiteCode: string | null; createdAt: string;
}
export interface Lead {
  id: string; memberId: string; phone: string; siteCode: string; planId: string | null; planName: string | null;
  name: string; note: string; plates: string[]; status: LeadStatus; createdAt: string; updatedAt: string; updatedBy: string | null;
}
export interface IdentityProfile { provider: Provider; subject: string; name?: string; email?: string | null }

/** 測試站／本機可以用模擬模式；正式站必須設定真的服務 */
export const mockAllowed = () => process.env.NODE_ENV !== "production" || !!process.env.STAGING_BASIC_AUTH || process.env.MEMBER_AUTH_MOCK === "1";

// ---------- 簡訊 ----------

export function smsMode(): "mock" | "live" | "unavailable" {
  if (process.env.SMS_PROVIDER) return "live";
  return mockAllowed() ? "mock" : "unavailable";
}

async function sendSms(phone: string, text: string) {
  // 正式簡訊商（三竹、Every8d…）申請好後在這裡串接；帳密放 Secret Manager。
  void phone; void text;
  throw new MemberError(`簡訊服務 ${process.env.SMS_PROVIDER} 尚未串接。`, 503);
}

// ---------- 雜湊、簽章 ----------

export function secret() {
  const s = process.env.MEMBER_SESSION_SECRET ?? process.env.STAGING_BASIC_AUTH;
  if (s) return s;
  if (process.env.NODE_ENV === "production" && !mockAllowed()) throw new Error("MEMBER_SESSION_SECRET is not set");
  return "pd-dev-member-secret";
}
const codeHash = (phone: string, code: string) => createHash("sha256").update(`${secret()}:otp:${phone}:${code}`).digest("hex");
export const mac = (msg: string) => createHmac("sha256", secret()).update(msg).digest("hex");
export function macEqual(a: string, b: string) {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export const MEMBER_COOKIE = "pd_member";
export const MEMBER_MAX_AGE = 30 * 24 * 3600;
export function signMember(id: string, now = Date.now()) {
  const exp = Math.floor(now / 1000) + MEMBER_MAX_AGE;
  return `${id}.${exp}.${mac(`member:${id}:${exp}`)}`;
}
export function readMemberCookie(v: string | undefined, now = Date.now()): string | null {
  if (!v) return null;
  const [id, exp, sig] = v.split(".");
  if (!id || !exp || !sig || !/^\d+$/.test(exp) || Number(exp) < now / 1000) return null;
  return macEqual(sig, mac(`member:${id}:${exp}`)) ? id : null;
}

// ---------- 記憶體版 ----------

interface MemIdentity { provider: Provider; subject: string; memberId: string }
interface MemStore { otps: Map<string, OtpState>; members: Member[]; identities: MemIdentity[]; leads: Lead[] }
const g = globalThis as unknown as { __pdMembers?: MemStore };
g.__pdMembers ??= { otps: new Map(), members: [], identities: [], leads: [] };
const mem = g.__pdMembers;

// ---------- 驗證碼 ----------

async function loadOtp(phone: string): Promise<OtpState | null> {
  if (!dbConfigured()) return mem.otps.get(phone) ?? null;
  const r = (await pool().query("SELECT * FROM member_otps WHERE phone = $1", [phone])).rows[0];
  return r ? { codeHash: r.code_hash, expiresAt: +r.expires_at, attempts: r.attempts, sentAt: +r.sent_at, sendsHour: r.sends_hour, hourStart: +r.hour_start } : null;
}
async function saveOtp(phone: string, s: OtpState) {
  if (!dbConfigured()) { mem.otps.set(phone, s); return; }
  await pool().query(
    `INSERT INTO member_otps (phone, code_hash, expires_at, attempts, sent_at, sends_hour, hour_start)
     VALUES ($1, $2, to_timestamp($3 / 1000.0), $4, to_timestamp($5 / 1000.0), $6, to_timestamp($7 / 1000.0))
     ON CONFLICT (phone) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = EXCLUDED.attempts,
       sent_at = EXCLUDED.sent_at, sends_hour = EXCLUDED.sends_hour, hour_start = EXCLUDED.hour_start`,
    [phone, s.codeHash, s.expiresAt, s.attempts, s.sentAt, s.sendsHour, s.hourStart]);
}

/** 寄驗證碼。模擬模式回傳 devCode 給畫面顯示。 */
export async function requestOtp(phone: string, now = Date.now()): Promise<{ devCode?: string; resendSec: number }> {
  const mode = smsMode();
  if (mode === "unavailable") throw new MemberError("簡訊驗證暫時無法使用，請改用 LINE 或 Google 登入。", 503);
  const prev = await loadOtp(phone);
  const allowed = canSend(prev, now);
  if (!allowed.ok) {
    throw new MemberError(allowed.reason === "resend" ? `請等 ${allowed.waitSec} 秒再重寄。` : "這支手機這一小時寄太多次了，請稍後再試。", 429, undefined, allowed.waitSec);
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await saveOtp(phone, { codeHash: codeHash(phone, code), expiresAt: now + OTP_TTL_SEC * 1000, attempts: 0, sentAt: now, sendsHour: allowed.sendsHour, hourStart: allowed.hourStart });
  if (mode === "live") await sendSms(phone, `【ParkDodo】驗證碼 ${code}，5 分鐘內有效。請勿提供給他人。`);
  return { devCode: mode === "mock" ? code : undefined, resendSec: 60 };
}

/** 驗證簡訊碼。成功後交給 signIn（建立、登入或綁定） */
export async function verifyOtp(phone: string, code: string, now = Date.now()): Promise<void> {
  const s = await loadOtp(phone);
  const r = checkCode(s, codeHash(phone, code), now);
  if (r === "none" || r === "expired") throw new MemberError("驗證碼已過期，請重新取得。", 422);
  if (r === "locked") throw new MemberError("輸入錯誤太多次，請重新取得驗證碼。", 429);
  if (r === "wrong") {
    const left = OTP_MAX_ATTEMPTS - s!.attempts - 1;
    await saveOtp(phone, { ...s!, attempts: s!.attempts + 1 });
    throw new MemberError(left > 0 ? `驗證碼不正確，還可以再試 ${left} 次。` : "輸入錯誤太多次，請重新取得驗證碼。", 422);
  }
  if (dbConfigured()) await pool().query("DELETE FROM member_otps WHERE phone = $1", [phone]);
  else mem.otps.delete(phone);
}

// ---------- 登入、綁定 ----------

/**
 * 用某個登入方式登入。
 * - 這個身分已經是某位會員 → 登入他（currentId 是別人時，一樣切換成這位會員；不會把兩個帳號合併）
 * - 還沒用過、目前已登入 → 綁到目前的會員（目前會員已綁同一種方式的另一個帳號時拒絕）
 * - 還沒用過、沒登入 → 建立新會員
 */
export async function signIn(id: IdentityProfile, currentId: string | null, sourceSiteCode: string | null): Promise<{ member: Member; isNew: boolean; linked: boolean }> {
  const site = siteRecords.find((x) => x.code === sourceSiteCode);
  const phone = id.provider === "phone" ? id.subject : null;
  const email = id.email?.trim().toLowerCase() || null;
  const name = (id.name ?? "").trim().slice(0, 30);

  if (!dbConfigured()) {
    const hit = mem.identities.find((x) => x.provider === id.provider && x.subject === id.subject);
    if (hit) return { member: mem.members.find((m) => m.id === hit.memberId)!, isNew: false, linked: false };
    const cur = currentId ? mem.members.find((m) => m.id === currentId) : undefined;
    if (cur) {
      if (cur.providers.includes(id.provider)) throw new MemberError(`這個會員已經綁定另一個 ${PROVIDER_LABELS[id.provider]} 帳號。`, 409);
      mem.identities.push({ provider: id.provider, subject: id.subject, memberId: cur.id });
      cur.providers.push(id.provider);
      if (phone) cur.phone = phone;
      if (email && !cur.email) cur.email = email;
      if (name && !cur.name) cur.name = name;
      return { member: cur, isNew: false, linked: true };
    }
    const m: Member = { id: randomUUID(), name, phone, email, plates: [], providers: [id.provider], sourceSiteCode: site?.code ?? null, createdAt: new Date().toISOString() };
    mem.members.push(m);
    mem.identities.push({ provider: id.provider, subject: id.subject, memberId: m.id });
    return { member: m, isNew: true, linked: false };
  }

  const r = await tx(async (c) => {
    const hit = (await c.query("UPDATE member_identities SET last_login_at = now() WHERE provider = $1 AND subject = $2 RETURNING member_id", [id.provider, id.subject])).rows[0];
    if (hit) return { memberId: hit.member_id as string, isNew: false, linked: false };
    const cur = currentId ? (await c.query("SELECT id FROM members WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [currentId])).rows[0] : null;
    let memberId: string;
    if (cur) {
      memberId = cur.id;
      await c.query(
        `UPDATE members SET phone = COALESCE($2, phone), email = COALESCE(email, $3), display_name = CASE WHEN display_name = '' THEN $4 ELSE display_name END,
           updated_at = now() WHERE id = $1`, [memberId, phone, email, name]);
    } else {
      memberId = (await c.query(
        `INSERT INTO members (display_name, phone, email, source_site_id, privacy_version)
         VALUES ($1, $2, $3, (SELECT id FROM sites WHERE code = $4), $5) RETURNING id`,
        [name, phone, email, site?.code ?? null, PRIVACY_VERSION])).rows[0].id;
    }
    await insertIdentity(c, id, memberId, email, name);
    return { memberId, isNew: !cur, linked: !!cur };
  }).catch((e) => {
    if ((e as { code?: string }).code === "23505") throw new MemberError(`這個會員已經綁定另一個 ${PROVIDER_LABELS[id.provider]} 帳號，或這支手機已是其他會員。`, 409);
    throw e;
  });
  return { member: (await getMember(r.memberId))!, isNew: r.isNew, linked: r.linked };
}

async function insertIdentity(c: PoolClient, id: IdentityProfile, memberId: string, email: string | null, name: string) {
  await c.query("INSERT INTO member_identities (provider, subject, member_id, email, display_name) VALUES ($1, $2, $3, $4, NULLIF($5, ''))",
    [id.provider, id.subject, memberId, email, name]);
}

// ---------- 會員資料 ----------

const MEMBER_SQL = `SELECT m.id, m.phone, m.email, m.display_name, m.created_at, s.code AS site_code,
  COALESCE((SELECT array_agg(plate_no ORDER BY added_at) FROM member_vehicles v WHERE v.member_id = m.id), '{}') AS plates,
  COALESCE((SELECT array_agg(provider ORDER BY linked_at) FROM member_identities i WHERE i.member_id = m.id), '{}') AS providers
  FROM members m LEFT JOIN sites s ON s.id = m.source_site_id
  WHERE m.deleted_at IS NULL`;
const toMember = (r: Record<string, unknown>): Member => ({
  id: r.id as string, name: r.display_name as string, phone: (r.phone as string) ?? null, email: (r.email as string) ?? null,
  sourceSiteCode: (r.site_code as string) ?? null, plates: (r.plates as string[]).map(memberPlate), providers: r.providers as Provider[],
  createdAt: new Date(r.created_at as string).toISOString(),
});

export async function getMember(id: string): Promise<Member | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  if (!dbConfigured()) return mem.members.find((m) => m.id === id) ?? null;
  const r = (await pool().query(`${MEMBER_SQL} AND m.id = $1`, [id])).rows[0];
  return r ? toMember(r) : null;
}

/** 會員自己更新稱呼、車牌，並可同時送出月租登記單 */
export async function saveProfile(m: Member, v: MemberProfileInput): Promise<{ member: Member; lead: Lead | null }> {
  const errors = validateProfile(v);
  if (hasProfileErrors(errors)) throw new MemberError("請檢查標示的欄位。", 422, errors);
  const name = v.name.trim();
  const plates = [...new Set(v.plates.map((p) => p.trim()).filter(Boolean).map(memberPlate))];
  let leadIn: { site: (typeof siteRecords)[number]; planId: string | null; planName: string | null; name: string; phone: string; note: string } | null = null;
  if (v.lead) {
    const site = siteRecords.find((s) => s.code === v.lead!.siteCode);
    if (!site) throw new MemberError("找不到這個停車場。", 404, { lead: "找不到這個停車場。" });
    const plan = v.lead.planId ? monthlyPlans.find((p) => p.id === v.lead!.planId && p.siteId === site.id && p.active) : null;
    if (v.lead.planId && !plan) throw new MemberError("這個方案目前沒有開放。", 422, { lead: "這個方案目前沒有開放。" });
    leadIn = { site, planId: plan?.id ?? null, planName: plan?.name ?? null, name: v.lead.name.trim() || name, phone: normalizePhone(v.lead.phone)!, note: v.lead.note.trim() };
  }
  const now = new Date().toISOString();

  if (!dbConfigured()) {
    const row = mem.members.find((x) => x.id === m.id)!;
    row.name = name; row.plates = plates;
    let lead: Lead | null = null;
    if (leadIn) {
      const open = mem.leads.find((l) => l.memberId === m.id && l.siteCode === leadIn!.site.code && (l.status === "new" || l.status === "contacted"));
      lead = open ?? { id: randomUUID(), memberId: m.id, phone: "", siteCode: leadIn.site.code, planId: null, planName: null, name: "", note: "", plates: [], status: "new", createdAt: now, updatedAt: now, updatedBy: null };
      Object.assign(lead, { planId: leadIn.planId, planName: leadIn.planName, name: leadIn.name, phone: leadIn.phone, note: leadIn.note, plates, updatedAt: now });
      if (!open) mem.leads.unshift(lead);
    }
    return { member: row, lead };
  }

  const leadId = await tx(async (c) => {
    await c.query("UPDATE members SET display_name = $2, updated_at = now() WHERE id = $1", [m.id, name]);
    await c.query("DELETE FROM member_vehicles WHERE member_id = $1", [m.id]);
    for (const p of plates) await c.query("INSERT INTO member_vehicles (member_id, plate_no) VALUES ($1, $2)", [m.id, edgePlate(p)]);
    if (!leadIn) return null;
    const s = (await c.query("SELECT id FROM sites WHERE code = $1", [leadIn.site.code])).rows[0];
    if (!s) throw new MemberError("這個停車場還沒開放線上登記。", 422, { lead: "這個停車場還沒開放線上登記。" });
    let planId: string | null = null;
    const plan = leadIn.planId ? monthlyPlans.find((p) => p.id === leadIn!.planId) : undefined;
    if (plan) {
      // 與月租建約相同：雲端資料庫還沒有這個方案時建立
      planId = (await c.query("SELECT id FROM monthly_plans WHERE site_id = $1 AND name = $2", [s.id, plan.name])).rows[0]?.id
        ?? (await c.query("INSERT INTO monthly_plans (site_id, name, plan_type, monthly_price, max_contracts) VALUES ($1, $2, $3, $4, $5) RETURNING id",
          [s.id, plan.name, plan.type, plan.monthlyPrice, plan.maxContracts ?? null])).rows[0].id;
    }
    const r = await c.query(
      `INSERT INTO monthly_leads (member_id, site_id, plan_id, name, contact_phone, note) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (member_id, site_id) WHERE status IN ('new', 'contacted')
       DO UPDATE SET plan_id = EXCLUDED.plan_id, name = EXCLUDED.name, contact_phone = EXCLUDED.contact_phone, note = EXCLUDED.note, updated_at = now() RETURNING id`,
      [m.id, s.id, planId, leadIn.name, leadIn.phone, leadIn.note]);
    return r.rows[0].id as string;
  });
  const member = (await getMember(m.id))!;
  const lead = leadId ? (await listLeads([leadIn!.site.code])).find((l) => l.id === leadId) ?? null : null;
  return { member, lead };
}

// ---------- 後台 ----------

export async function listMembers(siteCodes: string[]): Promise<Member[]> {
  if (!dbConfigured()) return mem.members.filter((m) => m.sourceSiteCode && siteCodes.includes(m.sourceSiteCode)).slice().reverse();
  const rows = (await pool().query(`${MEMBER_SQL} AND s.code = ANY($1) ORDER BY m.created_at DESC LIMIT 500`, [siteCodes])).rows;
  return rows.map(toMember);
}

export async function listLeads(siteCodes: string[]): Promise<Lead[]> {
  if (!dbConfigured()) return mem.leads.filter((l) => siteCodes.includes(l.siteCode));
  const rows = (await pool().query(
    `SELECT l.*, s.code AS site_code, p.name AS plan_name,
       COALESCE((SELECT array_agg(plate_no ORDER BY added_at) FROM member_vehicles v WHERE v.member_id = l.member_id), '{}') AS plates
     FROM monthly_leads l JOIN sites s ON s.id = l.site_id LEFT JOIN monthly_plans p ON p.id = l.plan_id
     WHERE s.code = ANY($1) ORDER BY l.created_at DESC LIMIT 500`, [siteCodes])).rows;
  return rows.map((r) => {
    const site = siteRecords.find((x) => x.code === r.site_code);
    const plan = monthlyPlans.find((p) => p.siteId === site?.id && p.name === r.plan_name);
    return {
      id: r.id, memberId: r.member_id, phone: r.contact_phone, siteCode: r.site_code, planId: plan?.id ?? null, planName: r.plan_name ?? null,
      name: r.name, note: r.note, plates: (r.plates as string[]).map(memberPlate), status: r.status,
      createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(), updatedBy: r.updated_by,
    };
  });
}

export async function setLeadStatus(id: string, status: LeadStatus, actor: string, allowedSiteCodes: string[]): Promise<Lead> {
  const lead = (await listLeads(allowedSiteCodes)).find((l) => l.id === id);
  if (!lead) throw new MemberError("找不到這張登記單，或你沒有這個站點的權限。", 404);
  if (!dbConfigured()) {
    Object.assign(lead, { status, updatedAt: new Date().toISOString(), updatedBy: actor });
    return lead;
  }
  try {
    await pool().query("UPDATE monthly_leads SET status = $2, updated_at = now(), updated_by = $3 WHERE id = $1", [id, status, actor]);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new MemberError("這位會員在這站已經有另一張處理中的登記單。", 409);
    throw e;
  }
  return (await listLeads(allowedSiteCodes)).find((l) => l.id === id)!;
}

/** 只給測試用 */
export function __resetMemoryStore() { mem.otps.clear(); mem.members.length = 0; mem.identities.length = 0; mem.leads.length = 0; }
