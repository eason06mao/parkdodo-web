// 工控機（Edge）與雲端的連線邏輯。API 路由只負責驗證與轉呼叫，規則都在這裡（方便測試）。
// 原則：開閘由地端 Edge 決定，金額由雲端決定。Edge 在出口辨識車牌時問雲端「這台車要付多少、能不能走」；
// 斷網時 Edge 依本機副本（已付款名單、月租白名單、費率）自行判斷，恢復後補傳事件。
import { createHash, randomBytes, randomInt } from "node:crypto";
import type { PoolClient } from "pg";
import { exitCheck, quote, type RateSchedule } from "../billing/fee";

export type Db = Pick<PoolClient, "query">;

export const PAIRING_TTL_MIN = 10;
export const EDGE_PROTOCOL = 1;

export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

/** 車牌正規化：大寫、只留英數（ABC-1234 → ABC1234） */
export function normalizePlate(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** 顯示用：英文字母與數字之間補「-」（ABC1234 → ABC-1234） */
export function displayPlate(p: string): string {
  const m = /^([A-Z]+)(\d+)$/.exec(p) ?? /^(\d+)([A-Z]+)$/.exec(p);
  return m ? `${m[1]}-${m[2]}` : p;
}

// ---------------------------------------------------------------- 配對

/** 產生 8 位數一次性配對碼（10 分鐘有效）。同站點未使用的舊配對碼一併作廢。 */
export async function createPairingCode(db: Db, a: { siteId: string; edgeName: string; createdBy?: string | null }): Promise<{ code: string; expiresAt: string }> {
  const code = String(randomInt(0, 100_000_000)).padStart(8, "0");
  await db.query("UPDATE edge_pairing_codes SET expires_at = LEAST(expires_at, now()) WHERE site_id = $1 AND used_at IS NULL AND expires_at > now()", [a.siteId]);
  const r = await db.query(
    `INSERT INTO edge_pairing_codes (code_hash, site_id, edge_name, created_by, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5)) RETURNING expires_at`,
    [sha256(code), a.siteId, a.edgeName, a.createdBy ?? null, PAIRING_TTL_MIN],
  );
  return { code, expiresAt: new Date(r.rows[0].expires_at).toISOString() };
}

export interface Hardware { model?: string; serialNo?: string; osVersion?: string; agentVersion?: string }

export class EdgeError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

/** Edge 用配對碼換取裝置金鑰。金鑰只回傳這一次，雲端只存雜湊。舊工控機自動停用。 */
export async function pairEdge(db: Db, a: { code: string; hardware: Hardware; ip?: string | null }) {
  const code = a.code.replace(/\D/g, "");
  if (code.length !== 8) throw new EdgeError("invalid_code", "配對碼應為 8 位數字。");
  const r = await db.query(
    `SELECT p.*, s.code AS site_code, s.name AS site_name FROM edge_pairing_codes p JOIN sites s ON s.id = p.site_id
     WHERE p.code_hash = $1 FOR UPDATE OF p`, [sha256(code)]);
  const p = r.rows[0];
  if (!p || p.used_at || new Date(p.expires_at) <= new Date()) {
    throw new EdgeError("invalid_code", "配對碼錯誤、已使用或已過期，請在後台重新產生。", 401);
  }
  await db.query("UPDATE edge_gateways SET status = 'retired', retired_at = now(), key_hash = NULL WHERE site_id = $1 AND status <> 'retired'", [p.site_id]);
  const deviceKey = `pdk_${randomBytes(32).toString("base64url")}`;
  const g = await db.query(
    `INSERT INTO edge_gateways (site_id, name, hardware_model, serial_no, os_version, agent_version, key_hash, paired_at, last_ip, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8, 'provisioning') RETURNING id`,
    [p.site_id, p.edge_name, a.hardware.model ?? null, a.hardware.serialNo ?? null, a.hardware.osVersion ?? null,
     a.hardware.agentVersion ?? null, sha256(deviceKey), a.ip ?? null],
  );
  const gatewayId: string = g.rows[0].id;
  await db.query("UPDATE edge_pairing_codes SET used_at = now(), used_by = $2 WHERE code_hash = $1", [p.code_hash, gatewayId]);
  await db.query("UPDATE lanes SET edge_gateway_id = $2 WHERE site_id = $1", [p.site_id, gatewayId]);
  await db.query("UPDATE devices SET edge_gateway_id = $2 WHERE site_id = $1", [p.site_id, gatewayId]);
  return { gatewayId, deviceKey, site: { id: p.site_id as string, code: p.site_code as string, name: p.site_name as string } };
}

export interface Gateway { id: string; siteId: string; siteCode: string; orgId: string; configVersion: number }

/** 驗證 Authorization: Bearer <裝置金鑰> */
export async function authenticate(db: Db, authHeader: string | null): Promise<Gateway | null> {
  const key = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!key.startsWith("pdk_")) return null;
  const r = await db.query(
    `SELECT g.id, g.site_id, g.config_version, s.code, s.org_id FROM edge_gateways g JOIN sites s ON s.id = g.site_id
     WHERE g.key_hash = $1 AND g.status <> 'retired'`, [sha256(key)]);
  const g = r.rows[0];
  return g ? { id: g.id, siteId: g.site_id, siteCode: g.code, orgId: g.org_id, configVersion: Number(g.config_version) } : null;
}

// ---------------------------------------------------------------- 心跳

export interface HeartbeatBody {
  agentVersion?: string;
  osVersion?: string;
  queueDepth?: number;
  diskFreeMb?: number;
  devices?: { id: string; status: "online" | "offline" | "fault"; detail?: string }[];
}

export async function heartbeat(db: Db, gw: Gateway, b: HeartbeatBody, ip?: string | null) {
  await db.query(
    `UPDATE edge_gateways SET last_seen_at = now(), status = 'online', last_ip = COALESCE($2::inet, last_ip),
       agent_version = COALESCE($3, agent_version), os_version = COALESCE($4, os_version), last_status = $5
     WHERE id = $1`,
    [gw.id, ip ?? null, b.agentVersion ?? null, b.osVersion ?? null,
     JSON.stringify({ queueDepth: b.queueDepth ?? 0, diskFreeMb: b.diskFreeMb ?? null, devices: b.devices ?? [] })],
  );
  for (const d of b.devices ?? []) {
    if (!["online", "offline", "fault"].includes(d.status)) continue;
    await db.query("UPDATE devices SET status = $3, last_seen_at = CASE WHEN $3 = 'online' THEN now() ELSE last_seen_at END WHERE id = $1 AND site_id = $2",
      [d.id, gw.siteId, d.status]);
  }
  const pending = await db.query(
    "SELECT count(*)::int AS n FROM gate_commands WHERE site_id = $1 AND status IN ('requested','approved') AND expires_at > now() AND (command <> 'hold_open' OR approved_by IS NOT NULL)",
    [gw.siteId]);
  return { serverTime: new Date().toISOString(), configVersion: gw.configVersion, pendingCommands: pending.rows[0].n as number, protocol: EDGE_PROTOCOL };
}

// ---------------------------------------------------------------- 設定下載

async function currentSchedule(db: Db, siteId: string, at = new Date()): Promise<{ id: string; schedule: RateSchedule } | null> {
  const r = await db.query(
    `SELECT id, rules FROM fee_rate_versions WHERE site_id = $1 AND effective_from <= $2 AND (effective_to IS NULL OR effective_to > $2)
     ORDER BY effective_from DESC, version_no DESC LIMIT 1`, [siteId, at]);
  return r.rows[0] ? { id: r.rows[0].id, schedule: r.rows[0].rules as RateSchedule } : null;
}

export async function getConfig(db: Db, gw: Gateway) {
  const site = (await db.query("SELECT id, code, name, timezone FROM sites WHERE id = $1", [gw.siteId])).rows[0];
  const lanes = (await db.query("SELECT id, code, direction, is_active FROM lanes WHERE site_id = $1 ORDER BY code", [gw.siteId])).rows;
  const devices = (await db.query(
    "SELECT id, lane_id, device_type, vendor, model, host(ip_address) AS ip, rs485_address, connection, capabilities FROM devices WHERE site_id = $1 AND status <> 'retired' ORDER BY device_type, id",
    [gw.siteId])).rows;
  const rate = await currentSchedule(db, gw.siteId);
  const auths = (await db.query(
    "SELECT plate_no, session_id, valid_until FROM exit_authorizations WHERE site_id = $1 AND status = 'active' AND valid_until > now()",
    [gw.siteId])).rows;
  const monthly = (await db.query(
    `SELECT v.plate_no, c.contract_no, c.ends_on FROM monthly_contracts c
     JOIN contract_vehicles cv ON cv.contract_id = c.id JOIN vehicles v ON v.id = cv.vehicle_id
     WHERE c.site_id = $1 AND c.status = 'active' AND current_date BETWEEN c.starts_on AND c.ends_on`, [gw.siteId])).rows;
  const open = (await db.query(
    "SELECT id, plate_no, entry_at, total_charged FROM parking_sessions WHERE site_id = $1 AND status IN ('open','paid','exiting')",
    [gw.siteId])).rows;
  return {
    protocol: EDGE_PROTOCOL,
    configVersion: gw.configVersion,
    site: { id: site.id, code: site.code, name: site.name, timezone: site.timezone },
    lanes: lanes.map((l) => ({
      id: l.id, code: l.code, direction: l.direction, active: l.is_active,
      devices: devices.filter((d) => d.lane_id === l.id).map((d) => ({
        id: d.id, type: d.device_type, vendor: d.vendor, model: d.model, ip: d.ip, rs485Address: d.rs485_address,
        connection: d.connection, capabilities: d.capabilities,
      })),
    })),
    rates: rate?.schedule ?? null,
    rateVersionId: rate?.id ?? null,
    exitAuthorizations: auths.map((a) => ({ plate: a.plate_no, sessionId: a.session_id, validUntil: new Date(a.valid_until).toISOString() })),
    monthlyWhitelist: monthly.map((m) => ({ plate: m.plate_no, contractNo: m.contract_no, endsOn: m.ends_on instanceof Date ? m.ends_on.toISOString().slice(0, 10) : m.ends_on })),
    openSessions: open.map((s) => ({ id: s.id, plate: s.plate_no, entryAt: new Date(s.entry_at).toISOString(), paid: Number(s.total_charged) })),
    payUrlBase: process.env.PUBLIC_BASE_URL ? `${process.env.PUBLIC_BASE_URL}/pay?site=${site.code}` : null,
  };
}

// ---------------------------------------------------------------- 事件

export type EdgeEventType = "plate_read" | "gate_opened" | "vehicle_passed" | "device_fault" | "device_recovered" | "manual_note";

export interface EdgeEvent {
  uid: string;                 // Edge 產生，全域唯一（建議 <站點代碼>-<UUID>）
  type: EdgeEventType;
  laneCode: string;
  occurredAt: string;          // ISO，含時區
  replayed?: boolean;          // 斷網期間累積、恢復後補傳
  plate?: string;
  confidence?: number;
  sessionId?: string;
  deviceId?: string;
  payload?: Record<string, unknown>;
}

export type Decision =
  | { action: "open"; reason: "entry" | "already_inside" | "paid" | "monthly" | "free" }
  | { action: "pay"; amount: number; reason: "unpaid" | "overstay" }
  | { action: "hold"; reason: "no_entry_record" | "lane_inactive" | "low_confidence" };

export interface EventResult {
  uid: string;
  status: "accepted" | "duplicate" | "rejected";
  error?: string;
  sessionId?: string;
  decision?: Decision;
  amount?: number;
}

const EVENT_TYPES: EdgeEventType[] = ["plate_read", "gate_opened", "vehicle_passed", "device_fault", "device_recovered", "manual_note"];
export const MIN_CONFIDENCE = 0.7;

function validateEvent(e: EdgeEvent): string | null {
  if (!e || typeof e.uid !== "string" || !/^[\w.:-]{8,100}$/.test(e.uid)) return "uid 格式錯誤";
  if (!EVENT_TYPES.includes(e.type)) return "type 不支援";
  if (typeof e.laneCode !== "string" || !e.laneCode) return "缺少 laneCode";
  const t = Date.parse(e.occurredAt);
  if (Number.isNaN(t)) return "occurredAt 格式錯誤";
  if (t > Date.now() + 5 * 60_000) return "occurredAt 在未來（請校正工控機時間）";
  if (t < Date.now() - 30 * 86_400_000) return "occurredAt 超過 30 天";
  if (e.type === "plate_read" && (!e.plate || !normalizePlate(e.plate))) return "plate_read 缺少車牌";
  return null;
}

/** 依發生時間依序處理一批事件；每筆各自成功或失敗，不互相影響。 */
export async function ingestEvents(db: Db, gw: Gateway, events: EdgeEvent[]): Promise<EventResult[]> {
  const lanes = new Map<string, { id: string; direction: string; active: boolean }>(
    (await db.query("SELECT id, code, direction, is_active FROM lanes WHERE site_id = $1", [gw.siteId])).rows
      .map((l) => [l.code, { id: l.id, direction: l.direction, active: l.is_active }]));
  const sorted = [...events].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const out = new Map<string, EventResult>();
  for (const e of sorted) {
    const bad = validateEvent(e);
    const lane = e && lanes.get(e.laneCode);
    if (bad || !lane) { out.set(e?.uid ?? "?", { uid: e?.uid ?? "?", status: "rejected", error: bad ?? `找不到車道 ${e.laneCode}` }); continue; }
    await db.query("SAVEPOINT ev");
    try {
      const ins = await db.query(
        `INSERT INTO device_events (event_uid, site_id, device_id, lane_id, event_type, occurred_at, is_replayed, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (event_uid) DO NOTHING RETURNING id`,
        [e.uid, gw.siteId, e.deviceId ?? null, lane.id, e.type, e.occurredAt, !!e.replayed,
         JSON.stringify({ ...(e.payload ?? {}), plate: e.plate ? normalizePlate(e.plate) : undefined, confidence: e.confidence, sessionId: e.sessionId })],
      );
      if (ins.rowCount === 0) {
        const prev = await previousResult(db, e.uid);
        out.set(e.uid, { uid: e.uid, status: "duplicate", ...prev });
        await db.query("RELEASE SAVEPOINT ev");
        continue;
      }
      const r = await processEvent(db, gw, e, lane);
      await db.query("UPDATE device_events SET payload = payload || $2 WHERE event_uid = $1",
        [e.uid, JSON.stringify({ result: { sessionId: r.sessionId, decision: r.decision, amount: r.amount } })]);
      await db.query("RELEASE SAVEPOINT ev");
      out.set(e.uid, { uid: e.uid, status: "accepted", ...r });
    } catch (err) {
      await db.query("ROLLBACK TO SAVEPOINT ev");
      out.set(e.uid, { uid: e.uid, status: "rejected", error: (err as Error).message });
    }
  }
  return events.map((e) => out.get(e?.uid) ?? { uid: e?.uid, status: "rejected", error: "無法處理" });
}

async function previousResult(db: Db, uid: string): Promise<Partial<EventResult>> {
  const r = await db.query("SELECT payload->'result' AS r FROM device_events WHERE event_uid = $1", [uid]);
  const res = r.rows[0]?.r;
  return res ? { sessionId: res.sessionId ?? undefined, decision: res.decision ?? undefined, amount: res.amount ?? undefined } : {};
}

async function processEvent(db: Db, gw: Gateway, e: EdgeEvent, lane: { id: string; direction: string; active: boolean }): Promise<Omit<EventResult, "uid" | "status">> {
  const plate = e.plate ? normalizePlate(e.plate) : null;
  const isEntry = lane.direction === "entry";
  const isExit = lane.direction === "exit";

  if (e.type === "plate_read" && plate) {
    if (!lane.active) return { decision: { action: "hold", reason: "lane_inactive" } };
    if (isEntry) return entry(db, gw, e, lane.id, plate);
    if (isExit) return exitQuote(db, gw, e, plate);
    return {};
  }

  if (e.type === "vehicle_passed" && isExit) {
    const s = await findOpenSession(db, gw.siteId, plate, e.sessionId);
    if (!s) return {};
    await db.query(
      `UPDATE parking_sessions SET status = 'closed', exit_at = GREATEST($2::timestamptz, entry_at), exit_lane_id = $3, exit_event_uid = $4, updated_at = now() WHERE id = $1`,
      [s.id, e.occurredAt, lane.id, e.uid]);
    await db.query("UPDATE exit_authorizations SET status = 'used', used_at = $2, used_lane_id = $3 WHERE session_id = $1 AND status = 'active'",
      [s.id, e.occurredAt, lane.id]);
    return { sessionId: s.id };
  }

  if (e.type === "gate_opened" && e.payload && typeof e.payload.commandId === "string") {
    await db.query("UPDATE gate_commands SET status = 'executed', executed_at = $3 WHERE id = $1 AND site_id = $2 AND status IN ('dispatched','approved','requested')",
      [e.payload.commandId, gw.siteId, e.occurredAt]);
  }
  return {};
}

async function findOpenSession(db: Db, siteId: string, plate: string | null, sessionId?: string) {
  if (sessionId) {
    const r = await db.query("SELECT * FROM parking_sessions WHERE id = $1 AND site_id = $2 AND status IN ('open','paid','exiting','exception')", [sessionId, siteId]);
    if (r.rows[0]) return r.rows[0];
  }
  if (!plate) return null;
  const r = await db.query("SELECT * FROM parking_sessions WHERE site_id = $1 AND plate_no = $2 AND status IN ('open','paid','exiting','exception')", [siteId, plate]);
  return r.rows[0] ?? null;
}

async function isMonthly(db: Db, siteId: string, plate: string, at: string): Promise<string | null> {
  const r = await db.query(
    `SELECT c.id FROM monthly_contracts c JOIN contract_vehicles cv ON cv.contract_id = c.id JOIN vehicles v ON v.id = cv.vehicle_id
     WHERE c.site_id = $1 AND v.plate_no = $2 AND c.status = 'active' AND ($3::timestamptz AT TIME ZONE 'Asia/Taipei')::date BETWEEN c.starts_on AND c.ends_on
     LIMIT 1`, [siteId, plate, at]);
  return r.rows[0]?.id ?? null;
}

async function entry(db: Db, gw: Gateway, e: EdgeEvent, laneId: string, plate: string) {
  const existing = await findOpenSession(db, gw.siteId, plate);
  if (existing) {
    // 同一台車已在場內（例如前一次出場沒拍到）：仍放行入場，但不重複建立紀錄，交由例外處理
    return { sessionId: existing.id as string, decision: { action: "open", reason: "already_inside" } as Decision };
  }
  const monthlyId = await isMonthly(db, gw.siteId, plate, e.occurredAt);
  const rate = await currentSchedule(db, gw.siteId, new Date(e.occurredAt));
  const r = await db.query(
    `INSERT INTO parking_sessions (site_id, org_id, plate_no, session_type, monthly_contract_id, entry_lane_id, entry_event_uid, entry_at, entry_confidence, fee_rate_version_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [gw.siteId, gw.orgId, plate, monthlyId ? "monthly_fixed" : "transient", monthlyId, laneId, e.uid, e.occurredAt,
     e.confidence != null ? Math.round(e.confidence * 10000) / 100 : null, rate?.id ?? null]);
  return { sessionId: r.rows[0].id as string, decision: { action: "open", reason: monthlyId ? "monthly" : "entry" } as Decision };
}

async function exitQuote(db: Db, gw: Gateway, e: EdgeEvent, plate: string): Promise<Omit<EventResult, "uid" | "status">> {
  const s = await findOpenSession(db, gw.siteId, plate);
  if (!s) return { decision: { action: "hold", reason: "no_entry_record" } };
  if (s.session_type !== "transient" || (await isMonthly(db, gw.siteId, plate, e.occurredAt))) {
    return { sessionId: s.id, amount: 0, decision: { action: "open", reason: "monthly" } };
  }
  const rate = await currentSchedule(db, gw.siteId, new Date(s.entry_at));
  if (!rate) throw new Error("站點沒有生效的費率");
  const entryAt = new Date(s.entry_at).toISOString();
  const paid = Number(s.total_charged);

  const auth = (await db.query(
    "SELECT valid_from, valid_until FROM exit_authorizations WHERE session_id = $1 AND status IN ('active','expired') ORDER BY valid_from DESC LIMIT 1",
    [s.id])).rows[0];
  // 付款時間＝最後一次出場授權的開始時間（授權過期後一樣用它判斷是否超時）
  if (auth || paid > 0) {
    const paidAt = auth ? new Date(auth.valid_from).toISOString() : entryAt;
    const chk = exitCheck(rate.schedule, { entryAt, paidAt, paidAmount: paid }, e.occurredAt);
    if (chk.allow) return { sessionId: s.id, amount: 0, decision: { action: "open", reason: "paid" } };
    return { sessionId: s.id, amount: chk.extra, decision: { action: "pay", amount: chk.extra, reason: "overstay" } };
  }
  const q = quote(rate.schedule, entryAt, e.occurredAt);
  if (q.amount === 0) return { sessionId: s.id, amount: 0, decision: { action: "open", reason: "free" } };
  return { sessionId: s.id, amount: q.amount, decision: { action: "pay", amount: q.amount, reason: "unpaid" } };
}

/**
 * 出口等待中重新確認（不建立事件）：車主在出口掃碼付款時，Edge 每 2 秒問一次「現在可以走了嗎」，付款完成就立刻開閘。
 */
export async function exitDecision(db: Db, gw: Gateway, a: { laneCode: string; plate: string }) {
  const lane = (await db.query("SELECT direction FROM lanes WHERE site_id = $1 AND code = $2", [gw.siteId, a.laneCode])).rows[0];
  if (!lane || lane.direction !== "exit") throw new EdgeError("invalid_lane", "只能查詢出口車道。", 400);
  const plate = normalizePlate(a.plate);
  if (!plate) throw new EdgeError("invalid_plate", "缺少車牌。", 400);
  const fake = { uid: "exit-check", type: "plate_read", laneCode: a.laneCode, occurredAt: new Date().toISOString(), plate } as EdgeEvent;
  return exitQuote(db, gw, fake, plate);
}

// ---------------------------------------------------------------- 遠端開閘指令

export async function takeCommands(db: Db, gw: Gateway) {
  await db.query("UPDATE gate_commands SET status = 'expired' WHERE site_id = $1 AND status IN ('requested','approved','dispatched') AND expires_at <= now()", [gw.siteId]);
  const r = await db.query(
    `UPDATE gate_commands g SET status = 'dispatched', dispatched_at = now()
     FROM lanes l WHERE l.id = g.lane_id AND g.site_id = $1 AND g.status IN ('requested','approved')
       AND g.expires_at > now() AND (g.command <> 'hold_open' OR g.approved_by IS NOT NULL)
     RETURNING g.id, g.command, l.code AS lane_code, g.plate_no, g.session_id, g.expires_at, g.reason_code`, [gw.siteId]);
  return r.rows.map((c) => ({
    id: c.id as string, command: c.command as string, laneCode: c.lane_code as string, plate: c.plate_no as string | null,
    sessionId: c.session_id as string | null, expiresAt: new Date(c.expires_at).toISOString(), reason: c.reason_code as string,
  }));
}

export async function commandResult(db: Db, gw: Gateway, id: string, r: { ok: boolean; detail?: string }) {
  const u = await db.query(
    // 「開閘事件」可能先到並已標記 executed；結果回報只能寫一次（edge_result 為空時）
    `UPDATE gate_commands SET status = CASE WHEN status = 'executed' AND $3 = 'executed' THEN status ELSE $3 END,
       executed_at = CASE WHEN $3 = 'executed' THEN COALESCE(executed_at, now()) ELSE executed_at END, edge_result = $4
     WHERE id = $1 AND site_id = $2 AND status IN ('dispatched','approved','requested','executed') AND edge_result IS NULL RETURNING id`,
    [id, gw.siteId, r.ok ? "executed" : "failed", JSON.stringify({ ok: r.ok, detail: r.detail ?? null, at: new Date().toISOString() })]);
  return (u.rowCount ?? 0) > 0;
}

/** 後台建立遠端開閘指令（30 秒內沒被執行就失效，避免延遲開閘） */
export async function requestGateCommand(db: Db, a: {
  siteCode: string; laneCode: string; command?: "open_once"; reasonCode: string; reasonNote?: string;
  requestedByEmail: string; requestedRole: string; idempotencyKey: string; plate?: string;
}) {
  const lane = (await db.query("SELECT l.id, l.site_id FROM lanes l JOIN sites s ON s.id = l.site_id WHERE s.code = $1 AND l.code = $2", [a.siteCode, a.laneCode])).rows[0];
  if (!lane) throw new EdgeError("lane_not_found", "找不到這個車道。", 404);
  const user = (await db.query("SELECT id FROM users WHERE email = $1", [a.requestedByEmail])).rows[0];
  if (!user) throw new EdgeError("user_not_found", "資料庫沒有這個帳號。", 403);
  const r = await db.query(
    `INSERT INTO gate_commands (site_id, lane_id, command, reason_code, reason_note, plate_no, requested_by, requested_role, idempotency_key, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + interval '30 seconds')
     ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
     RETURNING id, status, expires_at`,
    [lane.site_id, lane.id, a.command ?? "open_once", a.reasonCode, a.reasonNote ?? null, a.plate ? normalizePlate(a.plate) : null,
     user.id, a.requestedRole, a.idempotencyKey]);
  return { id: r.rows[0].id as string, status: r.rows[0].status as string, expiresAt: new Date(r.rows[0].expires_at).toISOString() };
}

// ---------------------------------------------------------------- 照片

export async function recordImage(db: Db, gw: Gateway, a: { eventUid: string; kind: "plate" | "full"; storagePath: string; bytes: number; sha256: string }) {
  const ev = await db.query("SELECT 1 FROM device_events WHERE event_uid = $1 AND site_id = $2", [a.eventUid, gw.siteId]);
  if (!ev.rowCount) throw new EdgeError("event_not_found", "請先上傳事件，再上傳照片。", 404);
  await db.query(
    `INSERT INTO event_images (event_uid, kind, storage_path, bytes, sha256) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (event_uid, kind) DO NOTHING`, [a.eventUid, a.kind, a.storagePath, a.bytes, a.sha256]);
}
