// 遠端開閘、即時監控：有雲端資料庫時讀真實的車道清單（含工控機是否在線、最近一次辨識到的車牌）。
import { pool } from "./db";
import { displayPlate } from "./edge/service";
import { siteRecords } from "./mock/tenancy";

/** 工控機超過這個時間沒有心跳，就視為離線（與離線通知信相同的 2 分鐘） */
export const EDGE_ONLINE_SECONDS = 120;

export interface LiveLane {
  id: string;
  siteId: string;          // 權限與遠端開閘 API 使用的站點 id
  siteCode: string;
  siteName: string;
  code: string;            // IN-1 / OUT-1
  name: string;            // 入口-1 / 出口-1
  direction: "entry" | "exit" | "bidirectional";
  paired: boolean;         // 這個車道有沒有配對工控機
  online: boolean;         // 工控機 2 分鐘內有心跳
  edgeSeenAt: string | null;
  lastPlate: string | null;
  lastAt: string | null;
  confidence: number | null;
}

export function laneName(code: string, direction: string): string {
  const n = code.match(/(\d+)$/)?.[1];
  const base = direction === "entry" ? "入口" : direction === "exit" ? "出口" : "車道";
  return n ? `${base}-${n}` : `${base} ${code}`;
}

/** siteCodes：登入者看得到的站點。依站點代碼、入口在前排序。 */
export async function listLiveLanes(siteCodes: string[]): Promise<LiveLane[]> {
  if (siteCodes.length === 0) return [];
  const rows = (await pool().query(
    `SELECT l.id, l.code, l.direction, s.code AS site_code, s.name AS site_name,
            g.id AS gw_id, g.last_seen_at,
            (g.last_seen_at IS NOT NULL AND g.status <> 'retired' AND g.last_seen_at > now() - make_interval(secs => $2)) AS online,
            e.plate, e.confidence, e.occurred_at
       FROM lanes l
       JOIN sites s ON s.id = l.site_id
       LEFT JOIN edge_gateways g ON g.id = l.edge_gateway_id AND g.status <> 'retired'
       LEFT JOIN LATERAL (
         SELECT payload->>'plate' AS plate, (payload->>'confidence')::numeric AS confidence, occurred_at
           FROM device_events WHERE lane_id = l.id AND event_type = 'plate_read' AND payload ? 'plate'
          ORDER BY occurred_at DESC LIMIT 1) e ON true
      WHERE s.code = ANY($1) AND l.is_active
      ORDER BY s.code, CASE l.direction WHEN 'entry' THEN 0 WHEN 'exit' THEN 1 ELSE 2 END, l.code`,
    [siteCodes, EDGE_ONLINE_SECONDS])).rows;
  return rows.map((r) => ({
    id: r.id,
    siteId: siteRecords.find((s) => s.code === r.site_code)?.id ?? r.site_code,
    siteCode: r.site_code,
    siteName: r.site_name,
    code: r.code,
    name: laneName(r.code, r.direction),
    direction: r.direction,
    paired: !!r.gw_id,
    online: !!r.online,
    edgeSeenAt: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null,
    lastPlate: r.plate ? displayPlate(r.plate) : null,
    lastAt: r.occurred_at ? new Date(r.occurred_at).toISOString() : null,
    confidence: r.confidence == null ? null : Math.round(Number(r.confidence) > 1 ? Number(r.confidence) : Number(r.confidence) * 100),
  }));
}
