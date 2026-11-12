// npm run test:payments — 停車繳費串接統一金流：報價、建立訂單、NotifyURL 入帳、出場授權、重複通知、金額不符（需要 DATABASE_URL）
import assert from "node:assert/strict";
import { after, test } from "node:test";

const url = process.env.DATABASE_URL;
const skip = !url && "未設定 DATABASE_URL";

// 測試用商店金鑰（假的，只用來加解密）
process.env.PAYUNI_MER_ID = "S01TEST";
process.env.PAYUNI_HASH_KEY = "12345678901234567890123456789012";
process.env.PAYUNI_HASH_IV = "1234567890123456";
delete process.env.PAYUNI_ENV;

const SITE = "00000000-0000-4000-8000-000000000201"; // 台中南屯停車場 TXG001
const ORG = "00000000-0000-4000-8000-000000000001";
const plate = `T${Math.floor(Math.random() * 1e6).toString().padStart(6, "0")}`;
const plate2 = `U${Math.floor(Math.random() * 1e6).toString().padStart(6, "0")}`;
const plate3 = `M${Math.floor(Math.random() * 1e6).toString().padStart(6, "0")}`;

async function db() { return (await import("../../src/lib/db")).pool(); }
async function newSession(p: string, minutesAgo: number, type = "transient") {
  const r = await (await db()).query(
    `INSERT INTO parking_sessions (site_id, org_id, plate_no, session_type, entry_at, fee_rate_version_id)
     VALUES ($1, $2, $3, $4, now() - make_interval(mins => $5), '00000000-0000-4000-8000-000000000501') RETURNING id`,
    [SITE, ORG, p, type, minutesAgo]);
  return r.rows[0].id as string;
}

async function notify(orderNo: string, amount: number, tradeNo: string) {
  const { encrypt, hashInfo } = await import("../../src/lib/payments/payuni/crypto");
  const { POST } = await import("../../src/app/api/payments/payuni/notify/route");
  const keys = { hashKey: process.env.PAYUNI_HASH_KEY!, hashIV: process.env.PAYUNI_HASH_IV! };
  const enc = encrypt({ Status: "SUCCESS", Message: "授權成功", MerID: "S01TEST", MerTradeNo: orderNo, TradeNo: tradeNo, TradeAmt: amount, TradeStatus: "1", PaymentType: "1" }, keys);
  const form = new FormData();
  form.set("Status", "SUCCESS"); form.set("MerID", "S01TEST"); form.set("Version", "2.0");
  form.set("EncryptInfo", enc); form.set("HashInfo", hashInfo(enc, keys));
  return POST(new Request("http://localhost/api/payments/payuni/notify?site=TXG001", { method: "POST", body: form }));
}

after(async () => {
  if (!url) return;
  const p = await db();
  for (const pl of [plate, plate2, plate3]) {
    const s = (await p.query("SELECT id FROM parking_sessions WHERE plate_no = $1", [pl])).rows.map((r) => r.id);
    if (!s.length) continue;
    await p.query("DELETE FROM invoice_records WHERE payment_order_id IN (SELECT id FROM payment_orders WHERE session_id = ANY($1))", [s]);
    await p.query("DELETE FROM exit_authorizations WHERE session_id = ANY($1)", [s]);
    await p.query("DELETE FROM payment_transactions WHERE payment_order_id IN (SELECT id FROM payment_orders WHERE session_id = ANY($1))", [s]);
    await p.query("DELETE FROM payment_orders WHERE session_id = ANY($1)", [s]);
    await p.query("DELETE FROM parking_fee_quotes WHERE session_id = ANY($1)", [s]);
    await p.query("DELETE FROM parking_sessions WHERE id = ANY($1)", [s]);
  }
  await p.end();
});

test("報價 → 建立訂單 → NotifyURL 入帳 → 出口放行", { skip }, async () => {
  const pay = await import("../../src/lib/payments/parking");
  const { decrypt } = await import("../../src/lib/payments/payuni/crypto");
  const { exitDecision } = await import("../../src/lib/edge/service");
  const sid = await newSession(plate, 135);

  await assert.rejects(() => pay.quoteByPlate("TXG001", "ZZZ9999"), /找不到這台車/);
  const q = await pay.quoteByPlate("TXG001", plate);
  assert.equal(q.kind, "pay");
  if (q.kind !== "pay") return;
  assert.equal(q.amount, 150);              // 135 分鐘，每 30 分鐘 30 元
  assert.equal(q.siteName, "台中南屯停車場");

  const co = await pay.checkout({ quoteId: q.quoteId, invoice: { kind: "company", taxId: "10000004", title: "", email: "a@example.com" }, memberId: null, origin: "https://pd.example" });
  assert.match(co.orderNo, /^PD[A-Z0-9]{8,23}$/);
  assert.equal(co.form.action, "https://sandbox-api.payuni.com.tw/api/upp");
  const inner = decrypt(co.form.fields.EncryptInfo, { hashKey: process.env.PAYUNI_HASH_KEY!, hashIV: process.env.PAYUNI_HASH_IV! });
  assert.equal(inner.MerTradeNo, co.orderNo);
  assert.equal(inner.TradeAmt, "150");
  assert.equal(inner.NotifyURL, "https://pd.example/api/payments/payuni/notify?site=TXG001");
  await assert.rejects(() => pay.checkout({ quoteId: q.quoteId, invoice: { kind: "donate", loveCode: "919" }, memberId: null, origin: "https://pd.example" }), /金額已更新/);

  // 付款前：出口要付款
  const gw = { id: "gw", siteId: SITE, siteCode: "TXG001", orgId: ORG, configVersion: 1 };
  const before = await exitDecision(await db(), gw, { laneCode: "OUT-1", plate });
  assert.equal(before.decision?.action, "pay");

  const r1 = await notify(co.orderNo, 150, "T-1");
  assert.equal(r1.status, 200);
  const o = await pay.getOrder(co.orderNo);
  assert.equal(o?.status, "paid");
  assert.ok(o?.exitUntil);

  const exit = await exitDecision(await db(), gw, { laneCode: "OUT-1", plate });
  assert.deepEqual(exit.decision, { action: "open", reason: "paid" });

  // 重複通知：只處理一次
  const r2 = await notify(co.orderNo, 150, "T-1");
  assert.equal(r2.status, 200);
  const s = (await (await db()).query("SELECT total_charged, status FROM parking_sessions WHERE id = $1", [sid])).rows[0];
  assert.equal(Number(s.total_charged), 150);
  assert.equal(s.status, "paid");

  // 待開立發票：開立主體＝南屯統編，買方統編
  const inv = (await (await db()).query("SELECT * FROM invoice_records WHERE idempotency_key = $1", [`inv-${co.orderNo}`])).rows;
  assert.equal(inv.length, 1);
  assert.equal(inv[0].issuer_tax_id, "61079159");
  assert.equal(inv[0].invoice_type, "b2b");
  assert.equal(inv[0].buyer_tax_id, "10000004");
  assert.equal(inv[0].delivery, "email");

  // 已付款後再查：不用再付
  const again = await pay.quoteByPlate("TXG001", plate);
  assert.equal(again.kind, "paid");
});

test("金額不符、簽章錯誤不入帳；付款進行中不重複建立訂單", { skip }, async () => {
  const pay = await import("../../src/lib/payments/parking");
  await newSession(plate2, 45);
  const q = await pay.quoteByPlate("TXG001", plate2);
  assert.equal(q.kind, "pay");
  if (q.kind !== "pay") return;
  const co = await pay.checkout({ quoteId: q.quoteId, invoice: { kind: "donate", loveCode: "919" }, memberId: null, origin: "https://pd.example" });

  const q2 = await pay.quoteByPlate("TXG001", plate2);
  if (q2.kind !== "pay") throw new Error("應為待付款");
  // 向統一金流查詢失敗時（網路問題）：寧可擋下，不重複建立訂單
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes("payuni.com.tw")) throw new Error("network down");
    return realFetch(input);
  }) as typeof fetch;
  try {
    await assert.rejects(() => pay.checkout({ quoteId: q2.quoteId, invoice: { kind: "donate", loveCode: "919" }, memberId: null, origin: "https://pd.example" }), /正在確認中/);
  } finally { globalThis.fetch = realFetch; }

  const bad = await notify(co.orderNo, q.amount + 1, "T-2");
  assert.equal(bad.status, 400);
  assert.equal((await pay.getOrder(co.orderNo))?.status, "pending");

  const { POST } = await import("../../src/app/api/payments/payuni/notify/route");
  const form = new FormData();
  form.set("MerID", "S01TEST"); form.set("EncryptInfo", "abcd"); form.set("HashInfo", "FFFF");
  const forged = await POST(new Request("http://localhost/api/payments/payuni/notify?site=TXG001", { method: "POST", body: form }));
  assert.equal(forged.status, 400);
  assert.equal((await pay.getOrder(co.orderNo))?.status, "pending");
});

test("月租車、免費時間內不用付款", { skip }, async () => {
  const pay = await import("../../src/lib/payments/parking");
  await newSession(plate3, 5);
  assert.equal((await pay.quoteByPlate("TXG001", plate3)).kind, "free");
});

test("每站可以設定自己的商店金鑰", async () => {
  const { loadPayuniConfig } = await import("../../src/lib/payments/payuni/client");
  const env = { PAYUNI_MER_ID: "S0", PAYUNI_HASH_KEY: "a".repeat(32), PAYUNI_HASH_IV: "b".repeat(16),
    PAYUNI_MER_ID_TXG002: "S2", PAYUNI_HASH_KEY_TXG002: "c".repeat(32), PAYUNI_HASH_IV_TXG002: "d".repeat(16), PAYUNI_ENV: "production" } as unknown as NodeJS.ProcessEnv;
  assert.equal(loadPayuniConfig(env, "TXG001")?.merId, "S0");
  assert.equal(loadPayuniConfig(env, "TXG002")?.merId, "S2");
  assert.equal(loadPayuniConfig(env, "TXG002")?.env, "production");
  assert.throws(() => loadPayuniConfig({ ...env, PAYUNI_HASH_IV_TXG002: "" } as NodeJS.ProcessEnv, "TXG002"), /不完整/);
});

test("重新付款：統一金流查無上一筆交易 → 舊訂單作廢、可以重新付款", { skip }, async () => {
  const pay = await import("../../src/lib/payments/parking");
  const plate4 = `R${Math.floor(Math.random() * 1e6).toString().padStart(6, "0")}`;
  await newSession(plate4, 60);
  const q = await pay.quoteByPlate("TXG001", plate4);
  if (q.kind !== "pay") throw new Error("應為待付款");
  const first = await pay.checkout({ quoteId: q.quoteId, invoice: { kind: "donate", loveCode: "919" }, memberId: null, origin: "https://pd.example" });

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes("payuni.com.tw/api/trade/query")) return new Response(JSON.stringify({ Status: "QUERY01001", Message: "查無資料" }), { status: 200 });
    return realFetch(input);
  }) as typeof fetch;
  try {
    const q2 = await pay.quoteByPlate("TXG001", plate4);
    if (q2.kind !== "pay") throw new Error("應為待付款");
    const second = await pay.checkout({ quoteId: q2.quoteId, invoice: { kind: "donate", loveCode: "919" }, memberId: null, origin: "https://pd.example" });
    assert.notEqual(second.orderNo, first.orderNo);
    assert.equal((await pay.getOrder(first.orderNo))?.status, "expired");
  } finally {
    globalThis.fetch = realFetch;
    const p = await db();
    const s = (await p.query("SELECT id FROM parking_sessions WHERE plate_no = $1", [plate4])).rows.map((r) => r.id);
    await p.query("DELETE FROM payment_transactions WHERE payment_order_id IN (SELECT id FROM payment_orders WHERE session_id = ANY($1))", [s]);
    await p.query("DELETE FROM payment_orders WHERE session_id = ANY($1)", [s]);
    await p.query("DELETE FROM parking_fee_quotes WHERE session_id = ANY($1)", [s]);
    await p.query("DELETE FROM parking_sessions WHERE id = ANY($1)", [s]);
  }
});
