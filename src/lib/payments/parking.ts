// 停車繳費（雲端資料庫）：查詢應付金額 → 建立付款訂單 → 統一金流 UPP 付款頁 → NotifyURL 入帳 → 建立出場授權。
// 規則：
//   1. 金額一律由雲端計算；報價 10 分鐘有效，逾時重新計算。
//   2. 入帳只依「HashInfo 驗證通過」的 NotifyURL 或交易查詢結果；ReturnURL 只用來顯示。
//   3. 同一張訂單重複通知只處理一次（payment_orders 鎖定＋狀態判斷）。
//   4. 付款成功：訂單 paid、停車紀錄累計已收、建立出場授權（寬限時間內可離場）、建立待開立的發票紀錄（開立主體＝該站統編）、
//      通知工控機重新下載名單。
import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { exitCheck, planAt, quote } from "../billing/fee";
import { pool, tx } from "../db";
import { currentSchedule, displayPlate, normalizePlate } from "../edge/service";
import type { InvoiceChoice } from "../invoice";
import { buildUppForm, loadPayuniConfig, mapQueryResult, queryRows, queryTrade, type OrderOutcome, type PayuniConfig } from "./payuni/client";

export class PayError extends Error {
  constructor(message: string, public status = 422, public code = "invalid") { super(message); }
}

export const QUOTE_TTL_MIN = 10;

export type QuoteResult =
  | { kind: "pay"; quoteId: string; plate: string; siteName: string; entryAt: string; minutes: number; amount: number; expiresAt: string; overstay: boolean }
  | { kind: "monthly" | "free"; plate: string; siteName: string; entryAt: string; minutes: number }
  | { kind: "paid"; plate: string; siteName: string; entryAt: string; minutes: number; validUntil: string };

interface SiteRow { id: string; org_id: string; code: string; name: string; invoice_seller_tax_id: string | null; invoice_seller_name: string | null }

async function siteByCode(c: Pick<PoolClient, "query">, code: string): Promise<SiteRow> {
  const r = (await c.query("SELECT id, org_id, code, name, invoice_seller_tax_id, invoice_seller_name FROM sites WHERE code = $1", [code])).rows[0];
  if (!r) throw new PayError("找不到這個停車場。", 404, "site_not_found");
  return r;
}

const minutesBetween = (a: string | Date, b: string | Date) => Math.max(0, Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 60_000));

/** 車主輸入車牌：找出在場紀錄並計算應付金額（臨停才建立報價） */
export async function quoteByPlate(siteCode: string, rawPlate: string, now = new Date()): Promise<QuoteResult> {
  const plate = normalizePlate(rawPlate);
  if (plate.length < 4) throw new PayError("請輸入完整車牌。", 422, "invalid_plate");
  return tx(async (c) => {
    const site = await siteByCode(c, siteCode);
    const s = (await c.query(
      "SELECT * FROM parking_sessions WHERE site_id = $1 AND plate_no = $2 AND status IN ('open','paid','exiting','exception') FOR UPDATE",
      [site.id, plate])).rows[0];
    if (!s) throw new PayError("找不到這台車的入場紀錄，請確認車牌，或按出口的對講機求助。", 404, "no_session");
    const entryAt = new Date(s.entry_at).toISOString();
    const base = { plate: displayPlate(plate), siteName: site.name, entryAt, minutes: minutesBetween(entryAt, now) };
    if (s.session_type !== "transient") return { kind: "monthly", ...base };

    const rate = await currentSchedule(c, site.id, new Date(entryAt));
    if (!rate) throw new PayError("這個停車場還沒有設定費率，請按出口對講機。", 503, "no_rate");
    const paid = Number(s.total_charged);
    const auth = (await c.query(
      "SELECT valid_from, valid_until FROM exit_authorizations WHERE session_id = $1 AND status IN ('active','expired') ORDER BY valid_from DESC LIMIT 1",
      [s.id])).rows[0];

    let amount: number;
    let overstay = false;
    if (auth || paid > 0) {
      const paidAt = auth ? new Date(auth.valid_from).toISOString() : entryAt;
      const chk = exitCheck(rate.schedule, { entryAt, paidAt, paidAmount: paid }, now.toISOString());
      if (chk.allow) {
        const validUntil = auth ? new Date(auth.valid_until).toISOString()
          : new Date(Date.parse(paidAt) + planAt(rate.schedule, entryAt).plan.exitGraceMinutes * 60_000).toISOString();
        return { kind: "paid", ...base, validUntil };
      }
      amount = chk.extra;
      overstay = true;
    } else {
      amount = quote(rate.schedule, entryAt, now.toISOString()).amount;
      if (amount === 0) return { kind: "free", ...base };
    }

    await c.query("UPDATE parking_fee_quotes SET status = 'superseded' WHERE session_id = $1 AND status = 'active'", [s.id]);
    const expiresAt = new Date(now.getTime() + QUOTE_TTL_MIN * 60_000);
    const q = await c.query(
      `INSERT INTO parking_fee_quotes (session_id, fee_rate_version_id, calculated_until, gross_amount, payable_amount, breakdown, expires_at)
       VALUES ($1, $2, $3, $4, $4, $5, $6) RETURNING id`,
      [s.id, rate.id, now, amount, JSON.stringify({ overstay, paidBefore: paid }), expiresAt]);
    return { kind: "pay", ...base, quoteId: q.rows[0].id, amount, expiresAt: expiresAt.toISOString(), overstay };
  });
}

const newOrderNo = () => `PD${Date.now().toString(36).toUpperCase()}${randomBytes(4).toString("hex").toUpperCase()}`; // ≤ 25 字

/** 建立付款訂單並產生 UPP 表單。同一台車有付款進行中時不重複建立（避免重複扣款）。 */
export async function checkout(a: {
  quoteId: string; invoice: InvoiceChoice; memberId: string | null; origin: string; now?: Date;
}): Promise<{ orderNo: string; amount: number; form: { action: string; fields: Record<string, string> } }> {
  if (!/^[0-9a-f-]{36}$/.test(a.quoteId)) throw new PayError("報價不存在，請重新查詢。", 404, "quote_not_found");
  const now = a.now ?? new Date();
  return tx(async (c) => {
    const q = (await c.query(
      `SELECT q.*, s.site_id, s.org_id, s.plate_no, s.id AS sid FROM parking_fee_quotes q JOIN parking_sessions s ON s.id = q.session_id
       WHERE q.id = $1 FOR UPDATE OF q`, [a.quoteId])).rows[0];
    if (!q) throw new PayError("報價不存在，請重新查詢。", 404, "quote_not_found");
    if (q.status !== "active" || new Date(q.expires_at) <= now) throw new PayError("金額已更新，請重新查詢。", 409, "quote_expired");
    const amount = Number(q.payable_amount);
    if (amount <= 0) throw new PayError("這次停車不需要付款。", 409, "nothing_to_pay");
    const site = (await c.query("SELECT id, org_id, code, name FROM sites WHERE id = $1", [q.site_id])).rows[0] as SiteRow;

    const cfg = loadPayuniConfig(process.env, site.code);
    if (!cfg) throw new PayError("這個停車場的線上付款還沒開通，請按出口對講機。", 503, "payment_not_configured");

    // 進行中的訂單：還沒到期就請車主回原本的付款頁；已到期的標為逾期
    const active = (await c.query(
      "SELECT order_no, status, expires_at FROM payment_orders WHERE session_id = $1 AND status IN ('created','pending','unknown') FOR UPDATE",
      [q.sid])).rows[0];
    if (active) {
      if (active.status === "unknown" || new Date(active.expires_at) > now) {
        throw new PayError("這台車有一筆付款正在確認中，請稍候 1～2 分鐘再試；若已扣款請勿重複付款。", 409, "payment_in_progress");
      }
      await c.query("UPDATE payment_orders SET status = 'expired', updated_at = now() WHERE order_no = $1", [active.order_no]);
    }

    const account = await providerAccount(c, site, cfg);
    const orderNo = newOrderNo();
    const expiresAt = new Date(now.getTime() + QUOTE_TTL_MIN * 60_000);
    await c.query(
      `INSERT INTO payment_orders (order_no, session_id, site_id, org_id, quote_id, provider_account_id, channel, amount, idempotency_key,
         status, expires_at, plate_no, invoice_request, member_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'pay_web', $7, $1, 'pending', $8, $9, $10, $11)`,
      [orderNo, q.sid, site.id, site.org_id, q.id, account, amount, expiresAt, q.plate_no, JSON.stringify(a.invoice), a.memberId]);
    await c.query("UPDATE parking_fee_quotes SET status = 'used' WHERE id = $1", [q.id]);
    await c.query(
      "INSERT INTO payment_transactions (payment_order_id, kind, amount, result_status) SELECT id, 'create', $2, 'pending' FROM payment_orders WHERE order_no = $1",
      [orderNo, amount]);

    const qs = `site=${encodeURIComponent(site.code)}`;
    const form = buildUppForm(cfg, {
      merTradeNo: orderNo, amount, prodDesc: `${site.name} 停車費 ${displayPlate(q.plate_no)}`,
      returnUrl: `${a.origin}/api/payments/payuni/return?${qs}`, notifyUrl: `${a.origin}/api/payments/payuni/notify?${qs}`,
      backUrl: `${a.origin}/pay?${qs}`, expireSec: QUOTE_TTL_MIN * 60,
    });
    return { orderNo, amount, form: { action: form.action, fields: form.fields as unknown as Record<string, string> } };
  });
}

/** 金流商店帳號（payment_provider_accounts）：依環境變數自動登記，只存商店代號與金鑰的參照名稱 */
async function providerAccount(c: PoolClient, site: SiteRow, cfg: PayuniConfig): Promise<string> {
  const ref = process.env[`PAYUNI_MER_ID_${site.code.toUpperCase()}`] ? `env:PAYUNI_*_${site.code.toUpperCase()}` : "env:PAYUNI_*";
  const r = await c.query(
    `INSERT INTO payment_provider_accounts (owner_org_id, provider, environment, merchant_no, credentials_ref, status)
     VALUES ($1, 'payuni', $2, $3, $4, 'active')
     ON CONFLICT (provider, environment, merchant_no) DO UPDATE SET credentials_ref = EXCLUDED.credentials_ref, status = 'active' RETURNING id`,
    [site.org_id, cfg.env, cfg.merId, ref]);
  return r.rows[0].id;
}

/** 依付款結果更新訂單（NotifyURL 或交易查詢）。重複通知只處理一次。 */
export async function applyOutcome(orderNo: string, outcome: OrderOutcome, source: "webhook" | "query", raw: Record<string, unknown>) {
  return tx(async (c) => {
    const o = (await c.query("SELECT * FROM payment_orders WHERE order_no = $1 FOR UPDATE", [orderNo])).rows[0];
    if (!o) throw new PayError("訂單不存在。", 404, "order_not_found");
    const tradeNo = outcome.kind === "paid" ? outcome.tradeNo : null;
    const inserted = await c.query(
      `INSERT INTO payment_transactions (payment_order_id, kind, provider_txn_id, amount, result_status, signature_valid, raw_payload)
       VALUES ($1, $2, $3, $4, $5, true, $6) ON CONFLICT DO NOTHING RETURNING id`,
      [o.id, source, tradeNo, outcome.kind === "paid" ? outcome.amount : null, outcome.kind, JSON.stringify(raw)]);
    if (o.status === "paid") return { status: "paid" as const, duplicate: inserted.rowCount === 0 };

    if (outcome.kind === "paid") {
      await markPaid(c, o, outcome);
      return { status: "paid" as const, duplicate: false };
    }
    const next = outcome.kind === "failed" ? "failed" : "unknown";
    // 已逾期的訂單收到「失敗」維持逾期；其餘照結果更新
    if (!(o.status === "expired" && next === "failed")) {
      await c.query("UPDATE payment_orders SET status = $2, updated_at = now() WHERE id = $1", [o.id, next]);
    }
    return { status: next, duplicate: false };
  });
}

async function markPaid(c: PoolClient, o: Record<string, unknown>, p: Extract<OrderOutcome, { kind: "paid" }>) {
  await c.query("UPDATE payment_orders SET status = 'paid', paid_at = now(), method = $2, updated_at = now() WHERE id = $1", [o.id, p.paymentType || null]);
  const s = (await c.query("SELECT * FROM parking_sessions WHERE id = $1 FOR UPDATE", [o.session_id])).rows[0];
  await c.query(
    `UPDATE parking_sessions SET total_charged = total_charged + $2,
       status = CASE WHEN status IN ('open','exception') THEN 'paid' ELSE status END, updated_at = now() WHERE id = $1`,
    [s.id, p.amount]);

  // 出場授權：從現在起寬限時間內可離場（車已離場的訂單不建立）
  if (["open", "paid", "exiting", "exception"].includes(s.status)) {
    const rate = await currentSchedule(c, s.site_id, new Date(s.entry_at));
    const grace = rate ? planAt(rate.schedule, new Date(s.entry_at).toISOString()).plan.exitGraceMinutes : 15;
    await c.query("UPDATE exit_authorizations SET status = 'expired' WHERE session_id = $1 AND status = 'active'", [s.id]);
    await c.query(
      `INSERT INTO exit_authorizations (session_id, site_id, plate_no, source, payment_order_id, valid_from, valid_until)
       VALUES ($1, $2, $3, 'payment', $4, now(), now() + make_interval(mins => $5))`,
      [s.id, s.site_id, s.plate_no, o.id, grace]);
    await c.query("UPDATE edge_gateways SET config_version = config_version + 1 WHERE site_id = $1 AND status <> 'retired'", [s.site_id]);
  }

  // 待開立發票（開立主體＝該站統編；實際開立由加值中心串接處理）
  const site = (await c.query("SELECT org_id, invoice_seller_tax_id, invoice_seller_name FROM sites WHERE id = $1", [s.site_id])).rows[0];
  const inv = (o.invoice_request ?? { kind: "member" }) as InvoiceChoice;
  const company = inv.kind === "company";
  await c.query(
    `INSERT INTO invoice_records (payment_order_id, issuer_org_id, issuer_tax_id, issuer_name, invoice_type, buyer_tax_id, buyer_name,
       carrier_type, donation_code, delivery, amount, idempotency_key, member_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT (idempotency_key) DO NOTHING`,
    [o.id, site.org_id, site.invoice_seller_tax_id, site.invoice_seller_name, company ? "b2b" : "b2c",
     company ? inv.taxId : null, company ? (inv.title || inv.taxId) : null,
     inv.kind === "member" ? "member" : inv.kind === "mobile" ? "mobile_barcode" : "none",
     inv.kind === "donate" ? inv.loveCode : null,
     inv.kind === "donate" ? "donation" : company ? "email" : inv.kind === "paper" ? "paper_print" : "carrier",
     p.amount, `inv-${o.order_no}`, o.member_id ?? null]);
}

export interface OrderView {
  orderNo: string; status: string; amount: number; plate: string; siteCode: string; siteName: string;
  paidAt: string | null; exitUntil: string | null; method: string | null;
}

export async function getOrder(orderNo: string): Promise<OrderView | null> {
  if (!/^PD[A-Z0-9]{8,23}$/.test(orderNo)) return null;
  const r = (await pool().query(
    `SELECT o.order_no, o.status, o.amount, o.plate_no, o.paid_at, o.method, s.code, s.name,
       (SELECT valid_until FROM exit_authorizations e WHERE e.payment_order_id = o.id ORDER BY created_at DESC LIMIT 1) AS exit_until
     FROM payment_orders o JOIN sites s ON s.id = o.site_id WHERE o.order_no = $1`, [orderNo])).rows[0];
  if (!r) return null;
  return {
    orderNo: r.order_no, status: r.status, amount: Number(r.amount), plate: displayPlate(r.plate_no ?? ""), siteCode: r.code, siteName: r.name,
    paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null, exitUntil: r.exit_until ? new Date(r.exit_until).toISOString() : null, method: r.method,
  };
}

/** 結果還沒確定的訂單：向統一金流查詢一次並更新（付款完成頁輪詢時、或背景排程使用） */
export async function refreshOrder(orderNo: string): Promise<OrderView | null> {
  const o = await getOrder(orderNo);
  if (!o || !["pending", "unknown", "created"].includes(o.status)) return o;
  const cfg = loadPayuniConfig(process.env, o.siteCode);
  if (!cfg) return o;
  const res = await queryTrade(cfg, orderNo);
  const row = queryRows(res.data)[0];
  if (!row) return o;
  const amount = (await pool().query("SELECT amount FROM payment_orders WHERE order_no = $1", [orderNo])).rows[0].amount;
  const outcome = mapQueryResult(row, { merTradeNo: orderNo, amount: Number(amount) });
  if (outcome.kind === "paid" || outcome.kind === "failed") await applyOutcome(orderNo, outcome, "query", maskRaw(row));
  return getOrder(orderNo);
}

/** 存進 raw_payload 前遮掉卡號等敏感欄位 */
export function maskRaw(d: Record<string, unknown>): Record<string, unknown> {
  const keep = ["Status", "Message", "MerID", "MerTradeNo", "TradeNo", "TradeAmt", "TradeStatus", "PaymentType", "PaymentDay", "DataSource"];
  return Object.fromEntries(Object.entries(d).filter(([k]) => keep.includes(k)));
}
