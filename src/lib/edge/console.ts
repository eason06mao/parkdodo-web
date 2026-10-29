// 後台使用的工控機資料（有設定資料庫時才有；沒有就回傳 null，畫面維持 Mock）
import { dbConfigured, pool, tx } from "../db";
import { createPairingCode } from "./service";

export interface LiveEdge {
  name: string; model: string | null; agentVersion: string | null; osVersion: string | null;
  status: "provisioning" | "online" | "offline"; lastSeenAt: string | null; pairedAt: string | null;
  queueDepth: number; lastIp: string | null; eventsToday: number;
}

/** 超過 60 秒沒有心跳就視為離線 */
export async function getLiveEdge(siteCode: string): Promise<LiveEdge | null | undefined> {
  if (!dbConfigured()) return undefined;
  try {
    const r = await pool().query(
      `SELECT g.name, g.hardware_model, g.agent_version, g.os_version, g.status, g.last_seen_at, g.paired_at, g.last_status, host(g.last_ip) AS ip,
              (SELECT count(*)::int FROM device_events e WHERE e.site_id = s.id AND e.received_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Taipei') AT TIME ZONE 'Asia/Taipei') AS today
       FROM sites s JOIN edge_gateways g ON g.site_id = s.id AND g.status <> 'retired' WHERE s.code = $1`, [siteCode]);
    const g = r.rows[0];
    if (!g) return null;
    const stale = !g.last_seen_at || Date.now() - new Date(g.last_seen_at).getTime() > 60_000;
    return {
      name: g.name, model: g.hardware_model, agentVersion: g.agent_version, osVersion: g.os_version,
      status: g.status === "provisioning" && !g.last_seen_at ? "provisioning" : stale ? "offline" : "online",
      lastSeenAt: g.last_seen_at ? new Date(g.last_seen_at).toISOString() : null,
      pairedAt: g.paired_at ? new Date(g.paired_at).toISOString() : null,
      queueDepth: Number(g.last_status?.queueDepth ?? 0), lastIp: g.ip, eventsToday: g.today,
    };
  } catch (e) {
    console.error("[edge live]", e);
    return undefined;
  }
}

export async function createPairingForSite(siteCode: string, edgeName: string, userEmail: string) {
  return tx(async (c) => {
    const s = (await c.query("SELECT id FROM sites WHERE code = $1", [siteCode])).rows[0];
    if (!s) return null;
    const u = (await c.query("SELECT id FROM users WHERE email = $1", [userEmail])).rows[0];
    return createPairingCode(c, { siteId: s.id, edgeName, createdBy: u?.id ?? null });
  });
}
