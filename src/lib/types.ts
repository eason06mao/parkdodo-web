// 與《ParkDodo V2 總規格 F 版》資料表對應的前端型別（只列畫面會用到的欄位）
import type { OrgType, RoleBinding } from "./permissions";

export type ChipTone = "ok" | "info" | "warn" | "danger" | "neutral";

export interface Site {
  id: string;
  code: string;
  name: string;
  address: string;
  totalSpaces: number;
  freeSpaces: number;
  occupancy: { transient: number; monthly: number; special: number };
}

export interface Lane {
  id: string;
  siteId: string;
  siteName: string;
  code: string; // IN-1 / OUT-1
  name: string; // 入口-1
  direction: "entry" | "exit";
  online: boolean;
  lastPlate: string;
  lastAt: string; // ISO
  confidence: number; // 0-100
  result: string; // 放行・臨停
  gate: "closed" | "open";
  radar: "clear" | "occupied";
  ledText: string;
  attention?: string; // 需注意時的說明
}

export type IncidentLevel = "critical" | "warning" | "info";
export type IncidentStatus = "open" | "acknowledged" | "resolved";

export interface Incident {
  id: string;
  code: string;
  level: IncidentLevel;
  status: IncidentStatus;
  title: string;
  where: string;
  laneId?: string;
  plate?: string;
  confidence?: number;
  openedAt: string;
  reason: string;
  timeline: { at: string; text: string }[];
}

export type SessionType = "臨停" | "月租" | "特殊";
export type SessionStatus = "在場" | "已出場" | "待確認";

export interface ParkingSession {
  id: string;
  plate: string;
  type: SessionType;
  entryAt: string;
  exitAt?: string;
  fee?: number;
  discount?: number;
  method?: string;
  invoiceNo?: string;
  status: SessionStatus;
}

export type ContractStatus = "有效" | "即將到期" | "已過期";

export interface MonthlyContract {
  id: string;
  owner: string;
  plate: string;
  plan: "固定車位" | "共用月租";
  space?: string;
  startsOn: string;
  endsOn: string;
  inside: boolean;
  status: ContractStatus;
}

export type Period = "day" | "week" | "month" | "quarter";

export interface MetricPoint {
  label: string;
  transient: number;
  monthly: number;
  merchant: number;
  entries: number;
  exits: number;
}

export interface AnalyticsData {
  period: Period;
  from: string;
  to: string;
  points: MetricPoint[];
  totals: { revenue: number; entries: number; avgTicket: number; occupancyPct: number; remoteOpens: number };
  deltas: { revenue: number; entries: number; avgTicket: number; occupancyPts: number; remoteOpens: number };
  paymentMix: { label: string; pct: number }[];
  sites: { name: string; revenue: number; turnover: number; occupancyPct: number }[];
  heatmap: number[][]; // [7 天][24 小時]，0-4
  transientShare: number;
  avgStayMinutes: number;
}

export type GateReason = "intercom_request" | "payment_issue" | "plate_misread" | "device_fault" | "emergency" | "other";

export const GATE_REASONS: { code: GateReason; label: string }[] = [
  { code: "intercom_request", label: "對講求助" },
  { code: "payment_issue", label: "付款問題" },
  { code: "plate_misread", label: "車牌誤判" },
  { code: "device_fault", label: "設備故障" },
  { code: "emergency", label: "緊急狀況" },
  { code: "other", label: "其他" },
];

export interface CashKioskStatus {
  name: string;
  running: boolean;
  bills: { label: string; count: number }[];
  coins: { label: string; count: number }[];
  paper: "充足" | "偏低" | "用完";
}

// ---------- 組織、站點管理、帳號（對應 organizations、sites、site_licenses、edge_gateways、devices、users） ----------

export interface Organization {
  id: string;
  type: OrgType;
  name: string;
  taxId?: string;
  contactName?: string;
  status: "pending" | "active" | "suspended" | "terminated";
}

export type OperationType = "hq_owned" | "operator" | "franchise" | "licensed";
export type CollectionMode = "hq_collect" | "own_merchant";
export type SiteStatus = "planning" | "trial" | "active" | "paused" | "closed";
export type LicensePlan = "basic" | "standard" | "pro";

export interface SiteLicense {
  licenseNo: string;
  plan: LicensePlan;
  maxLanes: number;
  startsOn: string;
  endsOn: string;
  graceDays: number;
  status: "trial" | "active" | "suspended" | "expired" | "cancelled";
}

export interface EdgeGatewayInfo {
  name: string;
  model?: string;
  serialNo?: string;
  agentVersion?: string;
  status: "provisioning" | "online" | "offline" | "retired";
  lastSeenAt?: string;
}

export interface DeviceInfo {
  id: string;
  laneCode?: string;
  type: "lpr_camera" | "led_voice_card" | "barrier" | "radar" | "exit_display" | "kiosk" | "intercom" | "printer" | "ups";
  vendor?: string;
  model?: string;
  ip?: string;
  rs485Address?: number;
  status: "online" | "offline" | "unknown";
}

export interface SiteRecord {
  id: string;
  code: string;
  name: string;
  orgId: string;
  operationType: OperationType;
  collectionMode: CollectionMode;
  status: SiteStatus;
  city: string;
  district?: string;
  address: string;
  totalSpaces: number;
  lanes: { code: string; name: string; direction: "entry" | "exit" }[];
  edge?: EdgeGatewayInfo;
  devices: DeviceInfo[];
  license?: SiteLicense; // 總部自營站不需要授權
  openedAt?: string;
}

export interface AccountRecord {
  id: string;
  name: string;
  email: string;
  status: "invited" | "active" | "locked" | "disabled";
  mfa: boolean;
  lastLoginAt?: string;
  bindings: RoleBinding[];
}

export interface AuditEntry {
  at: string;
  actor: string;
  action: string;
  target: string;
  orgId?: string;
  reason?: string;
}
