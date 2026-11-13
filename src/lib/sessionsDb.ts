// 後台「車輛進出紀錄」：有雲端資料庫時讀真實的停車紀錄（工控機入出場、後台補登、繳費頁付款）。
import { pool } from "./db";
import { displayPlate, normalizePlate } from "./edge/service";
import type { ParkingSession, SessionStatus, SessionType } from "./types";

export interface SessionFilter { plate?: string; date?: string; status?: string; type?: string }
export const SESSION_LIMIT = 200;

const TYPE: Record<string, SessionType> = { transient: "臨停", monthly_fixed: "月租", monthly_shared: "月租", utaggo: "特殊", exempt: "特殊" };
const STATUS: Record<string, SessionStatus> = { open: "在場", paid: "在場", exiting: "在場", exception: "待確認", closed: "已出場" };
const STATUS_SQL: Record<string, string> = {
  目前在場: "s.status IN ('open','paid','exiting')", 已出場: "s.status = 'closed'", 待確認: "s.status = 'exception'",
};
const TYPE_SQL: Record<string, string> = {
  臨停: "s.session_type = 'transient'", 月租: "s.session_type IN ('monthly_fixed','monthly_shared')", 特殊通行: "s.session_type IN ('utaggo','exempt')",
};

/** siteCodes：登入者看得到的站點；回傳最新的 SESSION_LIMIT 筆 */
export async function listSessions(siteCodes: string[], f: SessionFilter): Promise<ParkingSession[]> {
  if (siteCodes.length === 0) return [];
  const where = ["st.code = ANY($1)", "s.status <> 'voided'"];
  const args: unknown[] = [siteCodes];
  const plate = f.plate ? normalizePlate(f.plate) : "";
  if (plate) { args.push(`%${plate}%`); where.push(`s.plate_no LIKE $${args.length}`); }
  if (f.date && /^\d{4}-\d{2}-\d{2}$/.test(f.date)) { args.push(f.date); where.push(`(s.entry_at AT TIME ZONE 'Asia/Taipei')::date = $${args.length}::date`); }
  if (f.status && STATUS_SQL[f.status]) where.push(STATUS_SQL[f.status]);
  if (f.type && TYPE_SQL[f.type]) where.push(TYPE_SQL[f.type]);
  args.push(SESSION_LIMIT);
  const rows = (await pool().query(
    `SELECT s.id, s.plate_no, s.session_type, s.status, s.entry_at, s.exit_at, s.total_charged, s.entry_event_uid, st.name AS site_name,
            po.method, ir.invoice_no
       FROM parking_sessions s
       JOIN sites st ON st.id = s.site_id
       LEFT JOIN LATERAL (SELECT id, method FROM payment_orders WHERE session_id = s.id AND status = 'paid' ORDER BY paid_at DESC LIMIT 1) po ON true
       LEFT JOIN LATERAL (SELECT invoice_no FROM invoice_records WHERE payment_order_id = po.id AND invoice_no IS NOT NULL LIMIT 1) ir ON true
      WHERE ${where.join(" AND ")}
      ORDER BY s.entry_at DESC
      LIMIT $${args.length}`, args)).rows;
  return rows.map((r) => {
    const type = TYPE[r.session_type] ?? "特殊";
    const charged = Number(r.total_charged);
    return {
      id: r.id,
      plate: displayPlate(r.plate_no),
      type,
      entryAt: new Date(r.entry_at).toISOString(),
      exitAt: r.exit_at ? new Date(r.exit_at).toISOString() : undefined,
      fee: charged > 0 || r.status === "closed" ? charged : undefined,
      method: r.method ?? (type === "月租" ? "月租" : undefined),
      invoiceNo: r.invoice_no ?? undefined,
      status: STATUS[r.status] ?? "待確認",
      siteName: r.site_name,
      source: r.entry_event_uid ? "相機" : "補登",
    } satisfies ParkingSession;
  });
}
