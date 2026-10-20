import type { ChipTone, DeviceInfo, EdgeGatewayInfo, SiteLicense, SiteStatus } from "./types";

export const SITE_STATUS: Record<SiteStatus, { label: string; tone: ChipTone }> = {
  planning: { label: "籌備中", tone: "info" },
  trial: { label: "試營運", tone: "warn" },
  active: { label: "營運中", tone: "ok" },
  paused: { label: "暫停", tone: "neutral" },
  closed: { label: "已結束", tone: "neutral" },
};

export const EDGE_STATUS: Record<EdgeGatewayInfo["status"], { label: string; tone: ChipTone }> = {
  provisioning: { label: "待配對", tone: "neutral" },
  online: { label: "連線中", tone: "ok" },
  offline: { label: "離線", tone: "danger" },
  retired: { label: "已汰換", tone: "neutral" },
};

export const LICENSE_STATUS: Record<SiteLicense["status"], { label: string; tone: ChipTone }> = {
  trial: { label: "試用", tone: "info" },
  active: { label: "有效", tone: "ok" },
  suspended: { label: "停權", tone: "danger" },
  expired: { label: "已到期", tone: "danger" },
  cancelled: { label: "已取消", tone: "neutral" },
};

export const DEVICE_LABELS: Record<DeviceInfo["type"], string> = {
  lpr_camera: "車牌辨識攝影機", led_voice_card: "顯示語音卡", barrier: "柵欄機", radar: "車輛偵測雷達",
  exit_display: "出口顯示器", kiosk: "繳費機", intercom: "對講機", printer: "印表機", ups: "不斷電系統",
};

/** 距離到期還有幾天（以台北日期計） */
export function daysUntil(dateStr: string, today = new Date()): number {
  const t = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(today) + "T00:00:00+08:00");
  const d = new Date(dateStr + "T00:00:00+08:00");
  return Math.round((d.getTime() - t.getTime()) / 86_400_000);
}
