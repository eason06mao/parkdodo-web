// 資料存取層：畫面只呼叫這裡的函式。
// 目前回傳 Mock；接上雲端 API 後，只需把各函式改成 fetch，元件不必修改。
import { cashKiosk, contracts, incidents, lanes, sessions, sites, buildAnalytics } from "./mock/data";
import type { AnalyticsData, CashKioskStatus, Incident, Lane, MonthlyContract, ParkingSession, Period, Site } from "./types";
import { features } from "./features";
import { accounts, auditEntries, organizations, siteRecords } from "./mock/tenancy";
import { can, type Principal } from "./permissions";
import type { AccountRecord, AuditEntry, Organization, SiteRecord } from "./types";

export async function getSites(): Promise<Site[]> { return sites; }
export async function getLanes(): Promise<Lane[]> { return lanes; }
export async function getIncidents(): Promise<Incident[]> { return incidents; }
export async function getSessions(): Promise<ParkingSession[]> { return sessions; }
export async function getContracts(): Promise<MonthlyContract[]> { return contracts; }
export function getAnalytics(period: Period): AnalyticsData { return buildAnalytics(period); }

/** 現金繳費機：功能開關關閉時回傳 null，畫面顯示「預留・未啟用」。 */
export async function getCashKiosk(): Promise<CashKioskStatus | null> {
  return features.cashKiosk ? cashKiosk : null;
}

// ---------- 組織、站點管理、帳號 ----------
// 正式版：以下查詢都在後端以登入者身分執行，資料庫 RLS 只回傳可存取的組織資料。
// Mock 版用 visibleTo() 模擬同樣的過濾。

function siteVisible(user: Principal, s: SiteRecord) {
  if (user.isHq) return true;
  return user.bindings.some((b) => b.orgId === s.orgId && (!b.siteId || b.siteId === s.id));
}

export async function getOrganizations(user: Principal): Promise<Organization[]> {
  if (user.isHq) return organizations;
  const ids = new Set(user.bindings.map((b) => b.orgId));
  return organizations.filter((o) => ids.has(o.id));
}

export async function getSiteRecords(user: Principal): Promise<SiteRecord[]> {
  return siteRecords.filter((s) => siteVisible(user, s));
}

export async function getSiteRecord(user: Principal, id: string): Promise<SiteRecord | null> {
  const s = siteRecords.find((x) => x.id === id);
  return s && siteVisible(user, s) ? s : null;
}

export async function getAccounts(user: Principal): Promise<AccountRecord[]> {
  if (user.isHq) return accounts;
  const scopes = user.bindings.filter((b) => can(user, "user.manage_org", { orgId: b.orgId }));
  return accounts
    .map((a) => ({
      ...a,
      bindings: a.bindings.filter((ab) => scopes.some((s) => s.orgId === ab.orgId && (!s.siteId || s.siteId === ab.siteId))),
    }))
    .filter((a) => a.bindings.length > 0);
}

export async function getAuditEntries(user: Principal): Promise<AuditEntry[]> {
  if (user.isHq) return auditEntries;
  const ids = new Set(user.bindings.map((b) => b.orgId));
  return auditEntries.filter((e) => e.orgId && ids.has(e.orgId));
}

export function nextSiteCode(city: string): string {
  const prefix = { 台北市: "TPE", 新北市: "NTP", 桃園市: "TYN", 台中市: "TXG", 台南市: "TNN", 高雄市: "KHH" }[city] ?? "TWN";
  const n = siteRecords.filter((s) => s.code.startsWith(prefix)).length + 1;
  return `${prefix}${String(n).padStart(3, "0")}`;
}
