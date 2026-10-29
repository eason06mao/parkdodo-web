// npm run test:edge — 工控機與雲端連線（需要 DATABASE_URL，資料庫已套用 migration 與種子資料）
// 每個測試都在交易中執行，結束時 ROLLBACK，不會留下資料。
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import pg from "pg";
import {
  authenticate, commandResult, createPairingCode, getConfig, heartbeat, ingestEvents, pairEdge, requestGateCommand, takeCommands,
  type EdgeEvent, type Gateway,
} from "../../src/lib/edge/service";

const url = process.env.DATABASE_URL;
const SITE = "00000000-0000-4000-8000-000000000201";
const pool = url ? new pg.Pool({ connectionString: url }) : null;
after(() => pool?.end());

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const uid = () => `TXG001-${randomUUID()}`;
// 每個測試用隨機車牌，不受資料庫既有資料影響
const L = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const rp = () => `T${L[Math.floor(Math.random() * 24)]}${L[Math.floor(Math.random() * 24)]}-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
const ev = (type: EdgeEvent["type"], laneCode: string, minAgo: number, extra: Partial<EdgeEvent> = {}): EdgeEvent =>
  ({ uid: uid(), type, laneCode, occurredAt: ago(minAgo), ...extra });

async function inTx(fn: (c: pg.PoolClient) => Promise<void>) {
  const c = await pool!.connect();
  try { await c.query("BEGIN"); await fn(c); } finally { await c.query("ROLLBACK"); c.release(); }
}
async function paired(c: pg.PoolClient): Promise<{ gw: Gateway; key: string }> {
  const { code } = await createPairingCode(c, { siteId: SITE, edgeName: "測試工控機" });
  const r = await pairEdge(c, { code, hardware: { model: "test", agentVersion: "0.1.0" } });
  return { gw: (await authenticate(c, `Bearer ${r.deviceKey}`))!, key: r.deviceKey };
}

const t = (name: string, fn: (c: pg.PoolClient) => Promise<void>) => test(name, { skip: !url && "未設定 DATABASE_URL" }, () => inTx(fn));

t("配對：配對碼只能用一次、錯誤會拒絕；新工控機配對後舊的金鑰失效", async (c) => {
  const { code } = await createPairingCode(c, { siteId: SITE, edgeName: "A" });
  await assert.rejects(pairEdge(c, { code: "00000000" === code ? "11111111" : "00000000", hardware: {} }), /配對碼錯誤/);
  const first = await pairEdge(c, { code, hardware: {} });
  assert.match(first.deviceKey, /^pdk_/);
  assert.equal(first.site.code, "TXG001");
  await assert.rejects(pairEdge(c, { code, hardware: {} }), /已使用/);
  assert.ok(await authenticate(c, `Bearer ${first.deviceKey}`));
  const { code: code2 } = await createPairingCode(c, { siteId: SITE, edgeName: "B" });
  await pairEdge(c, { code: code2, hardware: {} });
  assert.equal(await authenticate(c, `Bearer ${first.deviceKey}`), null);
  assert.equal(await authenticate(c, "Bearer pdk_wrong"), null);
  const stored = await c.query("SELECT count(*)::int n FROM edge_gateways WHERE key_hash LIKE 'pdk_%'");
  assert.equal(stored.rows[0].n, 0, "金鑰不能存明碼");
});

t("心跳與設定下載：車道、設備、費率", async (c) => {
  const { gw } = await paired(c);
  const hb = await heartbeat(c, gw, { agentVersion: "0.1.0", queueDepth: 3, devices: [{ id: "00000000-0000-4000-8000-000000000401", status: "online" }] });
  assert.equal(hb.pendingCommands, 0);
  const cfg = await getConfig(c, gw);
  assert.deepEqual(cfg.lanes.map((l) => l.code), ["IN-1", "OUT-1"]);
  assert.equal(cfg.lanes[0].devices.find((d) => d.type === "lpr_camera")?.ip, "192.168.1.100");
  assert.equal(cfg.rates?.base.unitPrice, 30);
  const g = await c.query("SELECT status, last_status FROM edge_gateways WHERE id = $1", [gw.id]);
  assert.equal(g.rows[0].status, "online");
  assert.equal(g.rows[0].last_status.queueDepth, 3);
});

t("入場建立紀錄；同一事件重送不重複", async (c) => {
  const { gw } = await paired(c);
  const plate = rp();
  const e = ev("plate_read", "IN-1", 50, { plate: plate.toLowerCase(), confidence: 0.96 });
  const [r1] = await ingestEvents(c, gw, [e]);
  assert.equal(r1.status, "accepted");
  assert.deepEqual(r1.decision, { action: "open", reason: "entry" });
  const [r2] = await ingestEvents(c, gw, [e]);
  assert.equal(r2.status, "duplicate");
  assert.equal(r2.sessionId, r1.sessionId);
  const s = await c.query("SELECT plate_no, status FROM parking_sessions WHERE id = $1", [r1.sessionId]);
  assert.deepEqual(s.rows[0], { plate_no: plate.replace("-", ""), status: "open" });
});

t("出口報價：10 分鐘內免費；45 分鐘收 60 元；沒有入場紀錄要人工處理", async (c) => {
  const p_AAA = rp(), p_BBB = rp(), p_ZZZ = rp();
  const { gw } = await paired(c);
  await ingestEvents(c, gw, [ev("plate_read", "IN-1", 8, { plate: p_AAA })]);
  const [free] = await ingestEvents(c, gw, [ev("plate_read", "OUT-1", 0, { plate: p_AAA })]);
  assert.deepEqual(free.decision, { action: "open", reason: "free" });

  await ingestEvents(c, gw, [ev("plate_read", "IN-1", 45, { plate: p_BBB })]);
  const [pay] = await ingestEvents(c, gw, [ev("plate_read", "OUT-1", 0, { plate: p_BBB })]);
  assert.deepEqual(pay.decision, { action: "pay", amount: 60, reason: "unpaid" });

  const [none] = await ingestEvents(c, gw, [ev("plate_read", "OUT-1", 0, { plate: p_ZZZ })]);
  assert.deepEqual(none.decision, { action: "hold", reason: "no_entry_record" });
});

t("付款後超過 15 分鐘才離場：從入場重算，補收差額", async (c) => {
  const p_CCC = rp();
  const { gw } = await paired(c);
  // 130 分鐘前入場；40 分鐘前（停 90 分＝3 單位）付了 90 元；現在停 130 分＝5 單位＝150 → 補 60
  const [inn] = await ingestEvents(c, gw, [ev("plate_read", "IN-1", 130, { plate: p_CCC })]);
  await c.query("UPDATE parking_sessions SET status = 'paid', total_charged = 90 WHERE id = $1", [inn.sessionId]);
  await c.query("INSERT INTO exit_authorizations (session_id, site_id, plate_no, source, valid_from, valid_until) VALUES ($1, $2, $3, 'payment', $4, $5)",
    [inn.sessionId, SITE, p_CCC.replace("-", ""), ago(40), ago(25)]);
  const [late] = await ingestEvents(c, gw, [ev("plate_read", "OUT-1", 0, { plate: p_CCC })]);
  assert.deepEqual(late.decision, { action: "pay", amount: 60, reason: "overstay" });
});

t("寬限內離場放行，通過後結案並作廢授權", async (c) => {
  const p_DDD = rp();
  const { gw } = await paired(c);
  const [inn] = await ingestEvents(c, gw, [ev("plate_read", "IN-1", 70, { plate: p_DDD })]);
  await c.query("UPDATE parking_sessions SET status = 'paid', total_charged = 90 WHERE id = $1", [inn.sessionId]);
  await c.query("INSERT INTO exit_authorizations (session_id, site_id, plate_no, source, valid_from, valid_until) VALUES ($1, $2, $3, 'payment', $4, now() + interval '10 minutes')",
    [inn.sessionId, SITE, p_DDD.replace("-", ""), ago(5)]);
  const [ok] = await ingestEvents(c, gw, [ev("plate_read", "OUT-1", 0, { plate: p_DDD })]);
  assert.deepEqual(ok.decision, { action: "open", reason: "paid" });
  const [passed] = await ingestEvents(c, gw, [ev("vehicle_passed", "OUT-1", 0, { plate: p_DDD, sessionId: inn.sessionId })]);
  assert.equal(passed.sessionId, inn.sessionId);
  const s = await c.query("SELECT status FROM parking_sessions WHERE id = $1", [inn.sessionId]);
  assert.equal(s.rows[0].status, "closed");
  const a = await c.query("SELECT status FROM exit_authorizations WHERE session_id = $1", [inn.sessionId]);
  assert.equal(a.rows[0].status, "used");
  const [again] = await ingestEvents(c, gw, [ev("plate_read", "IN-1", 0, { plate: p_DDD })]);
  assert.notEqual(again.sessionId, inn.sessionId, "再次入場要建立新紀錄");
});

t("斷網補傳：順序亂掉也會依發生時間處理", async (c) => {
  const p_EEE = rp();
  const { gw } = await paired(c);
  const entry = ev("plate_read", "IN-1", 30, { plate: p_EEE, replayed: true });
  const exitRead = ev("plate_read", "OUT-1", 5, { plate: p_EEE, replayed: true });
  const pass = ev("vehicle_passed", "OUT-1", 4, { plate: p_EEE, replayed: true });
  const res = await ingestEvents(c, gw, [pass, exitRead, entry]);
  assert.deepEqual(res.map((r) => r.status), ["accepted", "accepted", "accepted"]);
  assert.equal(res[2].sessionId, res[0].sessionId);
  const s = await c.query("SELECT status, exit_at IS NOT NULL AS exited FROM parking_sessions WHERE id = $1", [res[2].sessionId]);
  assert.deepEqual(s.rows[0], { status: "closed", exited: true });
  const rep = await c.query("SELECT bool_and(is_replayed) AS r FROM device_events WHERE event_uid = ANY($1)", [[entry.uid, exitRead.uid, pass.uid]]);
  assert.equal(rep.rows[0].r, true);
});

t("事件檢查：未來時間、不存在的車道、格式錯誤會被拒絕，不影響同批其他事件", async (c) => {
  const p_FFF = rp(), p_GGG = rp();
  const { gw } = await paired(c);
  const future = { ...ev("plate_read", "IN-1", 0, { plate: p_FFF }), occurredAt: new Date(Date.now() + 3_600_000).toISOString() };
  const res = await ingestEvents(c, gw, [future, ev("plate_read", "IN-9", 0, { plate: p_FFF }), { ...ev("plate_read", "IN-1", 0), plate: "" }, ev("plate_read", "IN-1", 1, { plate: p_GGG })]);
  assert.deepEqual(res.map((r) => r.status), ["rejected", "rejected", "rejected", "accepted"]);
  assert.match(res[0].error!, /未來/);
});

t("遠端開閘：後台下指令 → 工控機取回 → 回報執行；逾時指令不會派送", async (c) => {
  const { gw } = await paired(c);
  const cmd = await requestGateCommand(c, { siteCode: "TXG001", laneCode: "OUT-1", reasonCode: "intercom_request",
    requestedByEmail: "ops@example.com", requestedRole: "hq_ops", idempotencyKey: randomUUID() });
  assert.equal((await heartbeat(c, gw, {})).pendingCommands, 1);
  const got = await takeCommands(c, gw);
  assert.equal(got.length, 1);
  assert.equal(got[0].laneCode, "OUT-1");
  assert.equal((await takeCommands(c, gw)).length, 0, "同一指令只派送一次");
  assert.equal(await commandResult(c, gw, cmd.id, { ok: true, detail: "relay IO1" }), true);
  assert.equal(await commandResult(c, gw, cmd.id, { ok: true }), false, "不能重複回報");
  const old = await requestGateCommand(c, { siteCode: "TXG001", laneCode: "OUT-1", reasonCode: "intercom_request",
    requestedByEmail: "ops@example.com", requestedRole: "hq_ops", idempotencyKey: randomUUID() });
  await c.query("UPDATE gate_commands SET expires_at = now() - interval '1 second', created_at = now() - interval '1 minute' WHERE id = $1", [old.id]);
  assert.equal((await takeCommands(c, gw)).length, 0);
  const s = await c.query("SELECT status FROM gate_commands WHERE id = $1", [old.id]);
  assert.equal(s.rows[0].status, "expired");
});

t("出口等待付款：付款完成後重新確認就放行（不建立事件）", async (c) => {
  const { gw } = await paired(c);
  const plate = rp();
  const [inn] = await ingestEvents(c, gw, [ev("plate_read", "IN-1", 50, { plate })]);
  const { exitDecision } = await import("../../src/lib/edge/service");
  const before = await c.query("SELECT count(*)::int n FROM device_events");
  assert.deepEqual((await exitDecision(c, gw, { laneCode: "OUT-1", plate })).decision, { action: "pay", amount: 60, reason: "unpaid" });
  await c.query("UPDATE parking_sessions SET status = 'paid', total_charged = 60 WHERE id = $1", [inn.sessionId]);
  await c.query("INSERT INTO exit_authorizations (session_id, site_id, plate_no, source, valid_until) VALUES ($1, $2, $3, 'payment', now() + interval '15 minutes')",
    [inn.sessionId, SITE, plate.replace("-", "")]);
  assert.deepEqual((await exitDecision(c, gw, { laneCode: "OUT-1", plate })).decision, { action: "open", reason: "paid" });
  const afterN = await c.query("SELECT count(*)::int n FROM device_events");
  assert.equal(afterN.rows[0].n, before.rows[0].n);
  await assert.rejects(exitDecision(c, gw, { laneCode: "IN-1", plate }), /只能查詢出口/);
});
