// 工控機離線通知：每分鐘由 Cloud Scheduler 呼叫一次。
//   超過 OFFLINE_AFTER 沒有心跳（工控機每 15 秒一次）→ 寄「離線」通知，只寄一次
//   之後又收到心跳 → 寄「已恢復」通知
import type { Db } from "../edge/service";
import type { SendMail } from "./mailer";

export const OFFLINE_AFTER_MIN = 2;
const fmt = (d: Date) => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short", hourCycle: "h23" }).format(d);

export async function checkEdgeOffline(db: Db, send: SendMail, now = new Date()) {
  const rows = (await db.query(
    `SELECT g.id, g.name, g.last_seen_at, g.offline_alerted_at, s.name AS site_name, s.code
       FROM edge_gateways g JOIN sites s ON s.id = g.site_id
      WHERE g.status <> 'retired' AND g.last_seen_at IS NOT NULL`)).rows as {
        id: string; name: string; last_seen_at: Date; offline_alerted_at: Date | null; site_name: string; code: string }[];
  const result = { offline: [] as string[], recovered: [] as string[] };
  for (const g of rows) {
    const seen = new Date(g.last_seen_at);
    const silentMin = (now.getTime() - seen.getTime()) / 60_000;
    if (!g.offline_alerted_at && silentMin >= OFFLINE_AFTER_MIN) {
      const sent = await send({
        subject: `【ParkDodo】${g.site_name} 工控機離線`,
        text: [
          `${g.site_name}（${g.code}）的工控機「${g.name}」已經 ${Math.floor(silentMin)} 分鐘沒有回報。`,
          `最後一次連線：${fmt(seen)}`,
          "",
          "車道仍會用工控機本機的資料判斷，但線上付款後可能無法即時開閘。請盡快確認：",
          "1. 工控機是否有電、有開機",
          "2. 網路是否正常（數據機、路由器）",
          "3. 現場有車在出口等待時，從後台遠端開閘，或請車主按對講機",
          "",
          "恢復連線時會再寄一封通知。",
        ].join("\n"),
      });
      if (sent) { await db.query("UPDATE edge_gateways SET offline_alerted_at = $2, status = 'offline' WHERE id = $1", [g.id, now]); result.offline.push(g.code); }
    } else if (g.offline_alerted_at && seen > new Date(g.offline_alerted_at)) {
      const down = Math.max(1, Math.round((seen.getTime() - new Date(g.offline_alerted_at).getTime()) / 60_000) + OFFLINE_AFTER_MIN);
      const sent = await send({
        subject: `【ParkDodo】${g.site_name} 工控機已恢復連線`,
        text: `${g.site_name}（${g.code}）的工控機「${g.name}」已在 ${fmt(seen)} 恢復連線，離線約 ${down} 分鐘。\n斷線期間的進出紀錄會自動補傳。`,
      });
      if (sent) { await db.query("UPDATE edge_gateways SET offline_alerted_at = NULL WHERE id = $1", [g.id]); result.recovered.push(g.code); }
    }
  }
  return result;
}
