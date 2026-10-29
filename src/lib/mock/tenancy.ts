// Mock：組織、站點管理、帳號、稽核紀錄。名稱與 Email 皆為示範用。
// 新增的站點與帳號只存在記憶體，重新啟動開發伺服器後會消失。
import type { RateSchedule } from "../billing/fee";
import { DEFAULT_PLAN } from "../billing/fee";
import { customRoles, type Principal, type Role } from "../permissions";
import type { AccountRecord, AuditEntry, Organization, SiteRecord } from "../types";

const seed_organizations: Organization[] = [
  { id: "org-hq", type: "hq", name: "ParkDodo 總部", status: "active" },
  { id: "org-lic-a", type: "licensee", name: "示範系統客戶 A", taxId: "12345678", contactName: "聯絡人 A", status: "active" },
  { id: "org-fr-b", type: "franchisee", name: "示範加盟主 B", contactName: "聯絡人 B", status: "pending" },
];

const seed_siteRecords: SiteRecord[] = [
  {
    id: "site-001", code: "TXG001", name: "中航站", orgId: "org-hq", operationType: "hq_owned", collectionMode: "hq_collect",
    status: "trial", city: "台中市", district: "沙鹿區", address: "台中市沙鹿區（示範地址）", totalSpaces: 52,
    lanes: [{ code: "IN-1", name: "入口-1", direction: "entry" }, { code: "OUT-1", name: "出口-1", direction: "exit" }],
    edge: { name: "中航站工控機", model: "待採購", agentVersion: "0.1.0-mock", status: "online", lastSeenAt: "2026-10-21T01:58:00+08:00" },
    devices: [
      { id: "d1", laneCode: "IN-1", type: "lpr_camera", vendor: "ICE", model: "車牌辨識攝影機", ip: "192.168.1.100", status: "online" },
      { id: "d2", laneCode: "IN-1", type: "led_voice_card", vendor: "FK", model: "顯示語音卡", rs485Address: 100, status: "online" },
      { id: "d3", laneCode: "IN-1", type: "barrier", vendor: "工廠進貨", model: "柵欄機", status: "online" },
      { id: "d4", laneCode: "OUT-1", type: "lpr_camera", vendor: "ICE", model: "車牌辨識攝影機", ip: "192.168.1.101", status: "online" },
      { id: "d5", laneCode: "OUT-1", type: "led_voice_card", vendor: "FK", model: "顯示語音卡", rs485Address: 100, status: "online" },
      { id: "d6", laneCode: "OUT-1", type: "barrier", vendor: "工廠進貨", model: "柵欄機", status: "online" },
      { id: "d7", laneCode: "OUT-1", type: "radar", vendor: "待確認", model: "車輛偵測雷達", status: "unknown" },
    ],
  },
  {
    id: "site-002", code: "TXG002", name: "示範二號站", orgId: "org-lic-a", operationType: "licensed", collectionMode: "own_merchant",
    status: "planning", city: "台中市", address: "台中市（示範地址）", totalSpaces: 30,
    lanes: [{ code: "IN-1", name: "入口-1", direction: "entry" }, { code: "OUT-1", name: "出口-1", direction: "exit" }],
    edge: { name: "待配對", status: "provisioning" },
    devices: [],
    license: { licenseNo: "LIC-2026-0001", plan: "standard", maxLanes: 2, startsOn: "2026-11-01", endsOn: "2027-10-31", graceDays: 14, status: "trial" },
  },
];

const seed_accounts: AccountRecord[] = [
  { id: "u-hq-admin", name: "示範總部管理員", email: "hq-admin@example.com", status: "active", mfa: true, lastLoginAt: "2026-10-21T01:50:00+08:00",
    bindings: [{ orgId: "org-hq", role: "hq_admin" }] },
  { id: "u-hq-ops", name: "示範值班人員", email: "ops@example.com", status: "active", mfa: true, lastLoginAt: "2026-10-20T22:10:00+08:00",
    bindings: [{ orgId: "org-hq", role: "hq_ops" }] },
  { id: "u-hq-fin", name: "示範財務", email: "finance@example.com", status: "active", mfa: true, lastLoginAt: "2026-10-19T10:02:00+08:00",
    bindings: [{ orgId: "org-hq", role: "hq_finance" }] },
  { id: "u-lic-admin", name: "示範客戶 A 管理員", email: "a-admin@example.com", status: "active", mfa: true, lastLoginAt: "2026-10-20T18:30:00+08:00",
    bindings: [{ orgId: "org-lic-a", role: "licensee_admin" }] },
  { id: "u-lic-staff", name: "示範客戶 A 現場", email: "a-staff@example.com", status: "invited", mfa: false,
    bindings: [{ orgId: "org-lic-a", role: "licensee_staff", siteId: "site-002" }] },
  { id: "u-lic-night", name: "示範客戶 A 夜班", email: "a-night@example.com", status: "active", mfa: true, lastLoginAt: "2026-10-28T23:40:00+08:00",
    bindings: [{ orgId: "org-lic-a", role: "c_lic_night", siteId: "site-002" }] },
];

// 示範自訂角色：系統客戶 A 的「夜班值班」（可人工補登與遠端開閘，但不能改費率、不能退款）
const seed_customRoles: Role[] = [
  { code: "c_lic_night", name: "夜班值班", orgType: "licensee", orgId: "org-lic-a",
    description: "夜間例外處理、人工補登、遠端開閘",
    permissions: ["site.view", "session.view", "incident.handle", "session.adjust", "gate.remote_open"],
    createdBy: "示範客戶 A 管理員", updatedAt: "2026-10-28T20:00:00+08:00" },
];

const seed_auditEntries: AuditEntry[] = [
  { at: "2026-10-28T20:05:00+08:00", actor: "示範客戶 A 管理員", action: "邀請帳號", target: "a-night@example.com・夜班值班・示範二號站", orgId: "org-lic-a" },
  { at: "2026-10-28T20:00:00+08:00", actor: "示範客戶 A 管理員", action: "建立角色", target: "夜班值班：檢視站點、檢視進出紀錄、處理例外、人工結案、調整紀錄、遠端開閘", orgId: "org-lic-a" },
  { at: "2026-10-20T18:31:00+08:00", actor: "示範客戶 A 管理員", action: "邀請帳號", target: "a-staff@example.com・系統客戶現場人員・示範二號站", orgId: "org-lic-a" },
  { at: "2026-10-20T15:12:00+08:00", actor: "示範總部管理員", action: "開立授權", target: "示範二號站・LIC-2026-0001・標準版", orgId: "org-lic-a" },
  { at: "2026-10-20T15:05:00+08:00", actor: "示範總部管理員", action: "新增站點", target: "示範二號站（TXG002）→ 示範系統客戶 A", orgId: "org-lic-a" },
  { at: "2026-10-20T15:01:00+08:00", actor: "示範總部管理員", action: "指派管理員", target: "a-admin@example.com・系統客戶管理員", orgId: "org-lic-a" },
  { at: "2026-10-19T21:42:00+08:00", actor: "示範值班人員", action: "遠端開閘", target: "中航站・出口-1", orgId: "org-hq", reason: "對講求助" },
];

/** 開發用的「預覽身分」，用來確認不同角色看到的畫面 */
export const mockPersonas: (Principal & { label: string })[] = [
  { id: "u-hq-admin", name: "示範總部管理員", label: "總部管理員", isHq: true, bindings: [{ orgId: "org-hq", role: "hq_admin" }] },
  { id: "u-hq-ops", name: "示範值班人員", label: "總部營運", isHq: true, bindings: [{ orgId: "org-hq", role: "hq_ops" }] },
  { id: "u-lic-admin", name: "示範客戶 A 管理員", label: "系統客戶管理員", isHq: false, bindings: [{ orgId: "org-lic-a", role: "licensee_admin" }] },
  { id: "u-lic-staff", name: "示範客戶 A 現場", label: "系統客戶現場人員", isHq: false, bindings: [{ orgId: "org-lic-a", role: "licensee_staff", siteId: "site-002" }] },
  { id: "u-lic-night", name: "示範客戶 A 夜班", label: "系統客戶夜班（自訂角色）", isHq: false, bindings: [{ orgId: "org-lic-a", role: "c_lic_night", siteId: "site-002" }] },
];

const seed_rateSchedules: Record<string, RateSchedule & { version: number; updatedAt: string; updatedBy: string }> = {
  "site-001": { base: { ...DEFAULT_PLAN }, promotions: [], version: 1, updatedAt: "2026-10-20T10:00:00+08:00", updatedBy: "示範總部管理員" },
  "site-002": { base: { ...DEFAULT_PLAN, unitPrice: 20, dailyCap: 150 }, promotions: [], version: 1, updatedAt: "2026-10-20T15:10:00+08:00", updatedBy: "示範總部管理員" },
};

// 頁面與 API 在開發模式可能各自載入一次這個模組，用 globalThis 讓它們共用同一份記憶體資料
const store = globalThis as unknown as { __pdTenancy?: { organizations: Organization[]; siteRecords: SiteRecord[]; accounts: AccountRecord[]; auditEntries: AuditEntry[]; rateSchedules: typeof seed_rateSchedules } };
store.__pdTenancy ??= {
  organizations: seed_organizations, siteRecords: seed_siteRecords, accounts: seed_accounts, auditEntries: seed_auditEntries,
  rateSchedules: seed_rateSchedules,
};
store.__pdTenancy.rateSchedules ??= seed_rateSchedules;
const roleStore = globalThis as unknown as { __pdCustomRolesSeeded?: boolean };
if (!roleStore.__pdCustomRolesSeeded) {
  customRoles().push(...seed_customRoles);
  roleStore.__pdCustomRolesSeeded = true;
}
export const { organizations, siteRecords, accounts, auditEntries, rateSchedules } = store.__pdTenancy;
