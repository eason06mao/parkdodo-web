// 與《ParkDodo V2 總規格 F 版》資料表對應的前端型別（只列畫面會用到的欄位）

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
