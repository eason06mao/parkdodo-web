// Mock 資料：只用於開發與展示。車牌皆為範例格式，非真實車輛。
// 上線時由 src/lib/data.ts 改接雲端 API，畫面元件不需修改。
import type {
  AnalyticsData, CashKioskStatus, Incident, Lane, MetricPoint, ParkingSession, Period, Site,
} from "../types";

export const sites: Site[] = [
  {
    id: "site-001", code: "TXG001", name: "中航站", address: "台中市沙鹿區",
    totalSpaces: 52, freeSpaces: 51, occupancy: { transient: 1, monthly: 0, special: 0 },
  },
];

export const lanes: Lane[] = [
  {
    id: "lane-in-1", siteId: "site-001", siteName: "中航站", code: "IN-1", name: "入口-1", direction: "entry",
    online: true, lastPlate: "ABC-1234", lastAt: "2026-10-19T14:25:20+08:00", confidence: 98,
    result: "放行・臨停", gate: "closed", radar: "clear", ledText: "歡迎光臨",
  },
  {
    id: "lane-out-1", siteId: "site-001", siteName: "中航站", code: "OUT-1", name: "出口-1", direction: "exit",
    online: true, lastPlate: "XYZ-5678", lastAt: "2026-10-19T21:37:22+08:00", confidence: 96,
    result: "等待付款", gate: "closed", radar: "occupied", ledText: "請掃碼繳費",
    attention: "車輛等待超過 3 分鐘",
  },
];

export const incidents: Incident[] = [
  {
    id: "inc-7", code: "EX-0007", level: "critical", status: "open", title: "車輛在出口等待超過 3 分鐘",
    where: "中航站・出口-1", laneId: "lane-out-1", plate: "XYZ-5678", confidence: 96,
    openedAt: "2026-10-19T21:40:10+08:00",
    reason: "車輛已在出口停留，未完成付款，也未掃描出口 QR。可能不會操作手機付款，或付款頁面發生問題。",
    timeline: [{ at: "2026-10-19T21:40:10+08:00", text: "系統建立事件，已推播 LINE 值班群組" }],
  },
  {
    id: "inc-6", code: "EX-0006", level: "warning", status: "open", title: "出口車牌信心值偏低",
    where: "中航站・出口-1", laneId: "lane-out-1", plate: "ABC-1Z34", confidence: 62,
    openedAt: "2026-10-19T21:36:00+08:00",
    reason: "辨識信心值 62%，低於場站設定的 85%。找不到相符的進場紀錄，疑似把 2 誤判成 Z。",
    timeline: [
      { at: "2026-10-19T21:36:00+08:00", text: "系統建立事件，已推播 LINE 值班群組" },
      { at: "2026-10-19T21:41:00+08:00", text: "5 分鐘未認領，已升級通知主管" },
    ],
  },
  {
    id: "inc-5", code: "EX-0005", level: "warning", status: "open", title: "付款狀態待確認",
    where: "線上繳費", plate: "DEF-2468", confidence: 99, openedAt: "2026-10-19T21:28:00+08:00",
    reason: "金流商未在時限內回傳結果，系統已自動查詢兩次仍為處理中。期間不會重複扣款。",
    timeline: [{ at: "2026-10-19T21:28:00+08:00", text: "系統建立事件並自動查詢金流商" }],
  },
  {
    id: "inc-4", code: "EX-0004", level: "info", status: "acknowledged", title: "字幕機心跳中斷",
    where: "中航站・入口-1", laneId: "lane-in-1", openedAt: "2026-10-19T21:15:00+08:00",
    reason: "FK 字幕機連續 3 次未回應版本查詢。開閘與辨識不受影響，但入口無法顯示文字與播放語音。",
    timeline: [
      { at: "2026-10-19T21:15:00+08:00", text: "系統建立事件" },
      { at: "2026-10-19T21:18:00+08:00", text: "值班人員已認領" },
    ],
  },
];

export const sessions: ParkingSession[] = [
  { id: "s1", plate: "ABC-1234", type: "臨停", entryAt: "2026-10-19T14:25:00+08:00", status: "在場" },
  { id: "s2", plate: "XYZ-5678", type: "臨停", entryAt: "2026-10-18T18:02:00+08:00", exitAt: "2026-10-18T21:37:00+08:00", fee: 360, discount: 0, method: "LINE Pay", invoiceNo: "AB12345678", status: "已出場" },
  { id: "s3", plate: "DEF-2468", type: "月租", entryAt: "2026-10-18T08:11:00+08:00", exitAt: "2026-10-18T18:45:00+08:00", fee: 0, discount: 0, method: "月租", status: "已出場" },
  { id: "s4", plate: "GHI-1357", type: "臨停", entryAt: "2026-10-18T13:05:00+08:00", exitAt: "2026-10-18T14:46:00+08:00", fee: 120, discount: 30, method: "信用卡", invoiceNo: "AB12345679", status: "已出場" },
  { id: "s5", plate: "JKL-9090", type: "特殊", entryAt: "2026-10-18T09:30:00+08:00", exitAt: "2026-10-18T10:02:00+08:00", fee: 0, discount: 0, method: "特殊通行", status: "已出場" },
  { id: "s6", plate: "MNO-4321", type: "臨停", entryAt: "2026-10-18T20:12:00+08:00", exitAt: "2026-10-18T20:40:00+08:00", fee: 30, discount: 0, status: "待確認" },
];


export const cashKiosk: CashKioskStatus = {
  name: "繳費機-1",
  running: true,
  bills: [{ label: "百元鈔", count: 53 }, { label: "五百元鈔", count: 0 }, { label: "千元鈔", count: 0 }],
  coins: [{ label: "5 元", count: 94 }, { label: "10 元", count: 40 }, { label: "50 元", count: 42 }],
  paper: "充足",
};

// ---------- 戰情板示意資料（以公式產生，僅供展示） ----------
const PERIOD_CFG: Record<Period, { n: number; base: number; from: string; to: string; label: (i: number) => string }> = {
  day: { n: 14, base: 4200, from: "2026-10-06", to: "2026-10-19", label: (i) => `10/${String(6 + i).padStart(2, "0")}` },
  week: { n: 12, base: 29000, from: "2026-07-27", to: "2026-10-18", label: (i) => `W${31 + i}` },
  month: { n: 12, base: 126000, from: "2025-11-01", to: "2026-10-31", label: (i) => `${((10 + i) % 12) + 1}月` },
  quarter: { n: 8, base: 380000, from: "2024-11-01", to: "2026-10-31", label: (i) => `${2024 + Math.floor((3 + i) / 4)}Q${((3 + i) % 4) + 1}` },
};

export function buildAnalytics(period: Period): AnalyticsData {
  const cfg = PERIOD_CFG[period];
  const points: MetricPoint[] = Array.from({ length: cfg.n }, (_, i) => {
    const wave = 1 + 0.18 * Math.sin(i * 1.3) + 0.04 * i;
    const entries = Math.round((cfg.base / 70) * wave);
    return {
      label: cfg.label(i),
      transient: Math.round(cfg.base * 0.68 * wave),
      monthly: Math.round(cfg.base * 0.22 * (1 + 0.05 * Math.cos(i))),
      merchant: Math.round(cfg.base * 0.1 * (1 + 0.2 * Math.sin(i * 2.1))),
      entries,
      exits: Math.round(entries * 0.97),
    };
  });
  const revenue = points.reduce((a, p) => a + p.transient + p.monthly + p.merchant, 0);
  const entries = points.reduce((a, p) => a + p.entries, 0);
  const heatmap = Array.from({ length: 7 }, (_, d) =>
    Array.from({ length: 24 }, (_, h) => {
      const work = d < 5
        ? Math.exp(-((h - 8.5) ** 2) / 3) + Math.exp(-((h - 18.5) ** 2) / 4)
        : Math.exp(-((h - 14) ** 2) / 14) * 1.2;
      return Math.min(4, Math.floor((work + (d === 4 && h >= 18 && h <= 20 ? 0.6 : 0)) * 3.2));
    }),
  );
  return {
    period, from: cfg.from, to: cfg.to, points,
    totals: { revenue, entries, avgTicket: Math.round(revenue / entries), occupancyPct: 63.5, remoteOpens: Math.max(3, Math.round(cfg.n * 1.5)) },
    deltas: { revenue: 8.4, entries: 5.1, avgTicket: 3.2, occupancyPts: -1.8, remoteOpens: -12 },
    paymentMix: [
      { label: "LINE Pay", pct: 41 }, { label: "信用卡", pct: 27 }, { label: "uTagGo 代扣", pct: 18 },
      { label: "街口支付", pct: 9 }, { label: "人工收費", pct: 5 },
    ],
    sites: [
      { name: "中航站", revenue: Math.round(revenue * 0.46), turnover: 3.4, occupancyPct: 71 },
      { name: "示範站 B", revenue: Math.round(revenue * 0.31), turnover: 2.8, occupancyPct: 64 },
      { name: "示範站 C", revenue: Math.round(revenue * 0.23), turnover: 2.1, occupancyPct: 52 },
    ],
    heatmap,
    transientShare: 78,
    avgStayMinutes: 134,
  };
}
