// npm run test:alerts — 工控機離線通知（需要 DATABASE_URL）
import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Mail } from "../../src/lib/alerts/mailer";

const url = process.env.DATABASE_URL;
const skip = !url && "未設定 DATABASE_URL";
const SITE = "00000000-0000-4000-8000-000000000201";
let gw = "";

async function db() { return (await import("../../src/lib/db")).pool(); }

after(async () => {
  if (!url) return;
  const p = await db();
  if (gw) await p.query("DELETE FROM edge_gateways WHERE id = $1", [gw]);
  await p.end();
});

test("離線 2 分鐘寄一次通知、不重複，恢復後寄恢復通知", { skip }, async () => {
  const { checkEdgeOffline } = await import("../../src/lib/alerts/edgeOffline");
  const p = await db();
  // 其他測試留下的工控機先標成已通知，避免干擾
  await p.query("UPDATE edge_gateways SET offline_alerted_at = now() WHERE offline_alerted_at IS NULL");
  gw = (await p.query(
    `INSERT INTO edge_gateways (site_id, name, auth_key_ref, status, last_seen_at) VALUES ($1, '測試工控機', 'test', 'online', now() - interval '1 minute') RETURNING id`,
    [SITE])).rows[0].id;
  const sent: Mail[] = [];
  const send = async (m: Mail) => { sent.push(m); return true; };

  await checkEdgeOffline(p, send);
  assert.equal(sent.filter((m) => m.text.includes("測試工控機")).length, 0, "1 分鐘還不算離線");

  await p.query("UPDATE edge_gateways SET last_seen_at = now() - interval '5 minutes' WHERE id = $1", [gw]);
  await checkEdgeOffline(p, send);
  const off = sent.filter((m) => m.text.includes("測試工控機"));
  assert.equal(off.length, 1);
  assert.match(off[0].subject, /台中南屯停車場 工控機離線/);

  await checkEdgeOffline(p, send);
  assert.equal(sent.filter((m) => m.text.includes("測試工控機")).length, 1, "不重複寄");

  await p.query("UPDATE edge_gateways SET last_seen_at = now() + interval '1 second' WHERE id = $1", [gw]);
  await checkEdgeOffline(p, send);
  const all = sent.filter((m) => m.text.includes("測試工控機"));
  assert.equal(all.length, 2);
  assert.match(all[1].subject, /已恢復連線/);
  assert.equal((await p.query("SELECT offline_alerted_at FROM edge_gateways WHERE id = $1", [gw])).rows[0].offline_alerted_at, null);
});

test("寄信失敗不標記，下次再試", { skip }, async () => {
  const { checkEdgeOffline } = await import("../../src/lib/alerts/edgeOffline");
  const p = await db();
  await p.query("UPDATE edge_gateways SET last_seen_at = now() - interval '5 minutes', offline_alerted_at = NULL WHERE id = $1", [gw]);
  await checkEdgeOffline(p, async () => false);
  assert.equal((await p.query("SELECT offline_alerted_at FROM edge_gateways WHERE id = $1", [gw])).rows[0].offline_alerted_at, null);
});
