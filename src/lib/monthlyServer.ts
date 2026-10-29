// 月租合約的後端規則（API 使用）。前端檢查在 monthly.ts；這裡另外檢查需要看到全部資料的規則：
//   車位不能重疊出租、同一車牌不能同時有兩份有效合約、共用月租不能超過合約上限。
// 有雲端資料庫時同步寫入，工控機的月租白名單會跟著更新。
import { dbConfigured, pool, tx } from "./db";
import { normalizePlate as edgePlate } from "./edge/service";
import {
  addDays, amounts, contractNo, contractState, endsOn, formatPlate, hasErrors, todayTaipei, validateContract,
  type ContractErrors, type ContractInput, type PaymentMethod, type PaymentStatus,
} from "./monthly";
import { auditEntries, siteRecords } from "./mock/tenancy";
import { fixedSpaces, monthlyPlans, monthlyRecords, type MonthlyRecord } from "./mock/monthly";
import { can, type Principal } from "./permissions";

export class MonthlyError extends Error {
  constructor(message: string, public status = 422, public errors?: ContractErrors) { super(message); }
}

/** 合約占用到哪一天：待付款的續約期間也先保留，避免被別人租走 */
const reservedEnd = (r: { endsOn: string; renewals?: { endsOn: string }[] }) =>
  (r.renewals ?? []).reduce((m, x) => (x.endsOn > m ? x.endsOn : m), r.endsOn);
const overlaps = (a: { activatesOn: string; endsOn: string; renewals?: { endsOn: string }[] }, b: { activatesOn: string; endsOn: string; renewals?: { endsOn: string }[] }) =>
  a.activatesOn <= reservedEnd(b) && b.activatesOn <= reservedEnd(a);
const live = (r: MonthlyRecord) => !r.cancelled && !r.suspended && contractState(r) !== "expired";

function checkConflicts(v: ContractInput & { endsOn: string }, ignoreId?: string) {
  const plan = monthlyPlans.find((p) => p.id === v.planId)!;
  const others = monthlyRecords.filter((r) => r.siteId === v.siteId && r.id !== ignoreId && !r.cancelled && !r.suspended);
  if (plan.type === "fixed") {
    if (!(fixedSpaces[v.siteId] ?? []).includes(v.space)) throw new MonthlyError("車位不存在。", 422, { space: "車位不存在。" });
    const taken = others.find((r) => r.space === v.space && overlaps(r, v));
    if (taken) throw new MonthlyError(`車位 ${v.space} 在這段期間已出租（${taken.contractNo}，到 ${taken.endsOn}）。`, 409, { space: "這段期間已出租。" });
  }
  const plates = v.vehicles.filter((x) => x.plate.trim()).map((x) => formatPlate(x.plate).replace("-", ""));
  for (const r of others) {
    if (!overlaps(r, v)) continue;
    const dup = r.vehicles.find((x) => plates.includes(formatPlate(x.plate).replace("-", "")));
    if (dup) throw new MonthlyError(`車牌 ${dup.plate} 在這段期間已有月租合約（${r.contractNo}）。`, 409, { vehicles: "車牌已有有效合約。" });
  }
  if (plan.type === "shared" && plan.maxContracts) {
    const n = others.filter((r) => r.planId === plan.id && overlaps(r, v)).length;
    if (n >= plan.maxContracts) throw new MonthlyError(`「${plan.name}」已達合約上限 ${plan.maxContracts} 份，請改登記候補。`, 409, { planId: "已達合約上限。" });
  }
}

function clean(v: ContractInput): ContractInput {
  const t = (s: string) => (s ?? "").trim();
  return {
    ...v,
    space: t(v.space),
    customer: { ...v.customer, name: t(v.customer.name), phone: t(v.customer.phone), email: t(v.customer.email).toLowerCase(),
      companyName: t(v.customer.companyName), taxId: t(v.customer.taxId), address: t(v.customer.address), note: t(v.customer.note) },
    vehicles: v.vehicles.filter((x) => t(x.plate)).map((x) => ({ ...x, plate: formatPlate(x.plate), brand: t(x.brand), color: t(x.color) })),
    discountReason: t(v.discountReason), paymentRef: t(v.paymentRef), invoiceValue: t(v.invoiceValue), note: t(v.note),
  };
}

export async function createContract(user: Principal, raw: ContractInput): Promise<MonthlyRecord> {
  const site = siteRecords.find((s) => s.id === raw.siteId);
  if (!site) throw new MonthlyError("找不到站點。", 404);
  if (!can(user, "monthly.manage", { orgId: site.orgId, siteId: site.id })) throw new MonthlyError("你沒有這個站點的月租管理權限。", 403);
  const v = clean(raw);
  const plan = monthlyPlans.find((p) => p.id === v.planId && p.siteId === site.id);
  const errors = validateContract(v, plan);
  if (hasErrors(errors)) throw new MonthlyError("資料有誤，請修正標示的欄位。", 422, errors);
  if (plan!.type === "shared") v.space = "";
  const record: MonthlyRecord = {
    ...v,
    id: `m-${crypto.randomUUID().slice(0, 8)}`,
    contractNo: "",
    endsOn: endsOn(v.startsOn, v.months),
    createdAt: new Date().toISOString(),
    createdBy: user.name,
    paidAt: v.paymentStatus === "paid" ? new Date().toISOString() : undefined,
    inside: false,
    renewals: [],
    history: [],
  };
  checkConflicts(record);
  const a = amounts(v);
  record.history.push({ at: record.createdAt, actor: user.name, action: "建立合約",
    note: `${plan!.name}・${v.months} 個月・應收 NT$${a.due.toLocaleString()}（${v.paymentStatus === "paid" ? "已付款" : "待付款"}）` });

  // 合約編號：取「記憶體」與「雲端資料庫」中同站同月的最大流水號 +1；配號與加入清單在同一步完成（不會被同時建立的合約搶到同號）
  const prefix = contractNo(site.code, v.startsOn, 0).slice(0, -4);
  const dbMax = await maxDbSeq(prefix);
  for (let attempt = 0; ; attempt++) {
    const memMax = Math.max(0, ...monthlyRecords.filter((r) => r.contractNo.startsWith(prefix)).map((r) => Number(r.contractNo.slice(-4))));
    record.contractNo = contractNo(site.code, v.startsOn, Math.max(memMax, dbMax) + 1 + attempt);
    monthlyRecords.push(record);
    try {
      await syncDb(record, { isNew: true });
      break;
    } catch (e) {
      monthlyRecords.splice(monthlyRecords.indexOf(record), 1);
      if ((e as { code?: string }).code === "23505" && attempt < 5) continue;   // 編號被占用：換下一號
      throw e;
    }
  }
  audit(user, site.orgId, "新增月租", `${record.contractNo}・${record.vehicles.map((x) => x.plate).join("、")}`);
  return record;
}

export type MonthlyAction =
  | { action: "confirm_payment"; method: PaymentMethod; ref: string }
  | { action: "renew"; months: number; paymentStatus: PaymentStatus; method: PaymentMethod; ref: string }
  | { action: "suspend"; reason: string }
  | { action: "resume" }
  | { action: "update_vehicles"; vehicles: ContractInput["vehicles"] };

export async function updateContract(user: Principal, id: string, a: MonthlyAction): Promise<MonthlyRecord> {
  const r = monthlyRecords.find((x) => x.id === id);
  const site = r && siteRecords.find((s) => s.id === r.siteId);
  if (!r || !site) throw new MonthlyError("找不到合約。", 404);
  if (!can(user, "monthly.manage", { orgId: site.orgId, siteId: site.id })) throw new MonthlyError("你沒有這個站點的月租管理權限。", 403);
  if (r.cancelled) throw new MonthlyError("已解約的合約不能修改。", 409);
  const now = new Date().toISOString();
  const next: MonthlyRecord = structuredClone(r);
  const needRef = (m: PaymentMethod, ref: string) =>
    (m === "transfer" || m === "card") && !ref.trim() ? (m === "transfer" ? "請填寫轉帳帳號末五碼。" : "請填寫刷卡授權碼。") : null;

  switch (a.action) {
    case "confirm_payment": {
      const p = needRef(a.method, a.ref); if (p) throw new MonthlyError(p);
      const pending = next.renewals.find((x) => !x.paidAt);
      if (r.paymentStatus === "unpaid") {
        Object.assign(next, { paymentStatus: "paid", paymentMethod: a.method, paymentRef: a.ref.trim(), paidAt: now });
        next.history.push({ at: now, actor: user.name, action: "確認收款", note: `NT$${amounts(r).due.toLocaleString()}・${a.method}` });
      } else if (pending) {
        // 續約收款：這時才把到期日延長
        Object.assign(pending, { paidAt: now, method: a.method, ref: a.ref.trim() });
        next.endsOn = pending.endsOn;
        next.history.push({ at: now, actor: user.name, action: "續約收款", note: `NT$${pending.amount.toLocaleString()}・${a.method}・到期日延至 ${pending.endsOn}` });
      } else {
        throw new MonthlyError("這份合約沒有待收的款項。", 409);
      }
      break;
    }
    case "renew": {
      if (![1, 3, 6, 12].includes(a.months)) throw new MonthlyError("請選擇續約期數。");
      if (next.renewals.some((x) => !x.paidAt)) throw new MonthlyError("已有一筆續約待付款，請先確認收款。", 409);
      if (a.paymentStatus === "paid") { const p = needRef(a.method, a.ref); if (p) throw new MonthlyError(p); }
      // 續約：從目前到期日的隔天接續；已過期就從今天起算
      const from = r.endsOn >= todayTaipei() ? addDays(r.endsOn, 1) : todayTaipei();
      const newEnds = endsOn(from, a.months);
      checkConflicts({ ...r, activatesOn: from, startsOn: from, endsOn: newEnds, months: a.months }, r.id);
      const amount = r.monthlyFee * a.months;   // 續約只收這次期數的租金（押金不重收）
      const renewal = { from, endsOn: newEnds, months: a.months, amount, createdAt: now,
        ...(a.paymentStatus === "paid" ? { paidAt: now, method: a.method, ref: a.ref.trim() } : {}) };
      next.renewals.push(renewal);
      if (a.paymentStatus === "paid") { next.endsOn = newEnds; next.suspended = false; }
      next.history.push({ at: now, actor: user.name, action: "續約",
        note: `${from} 起 ${a.months} 個月，到 ${newEnds}・NT$${amount.toLocaleString()}（${a.paymentStatus === "paid" ? "已付款" : "待付款，收款後才延長到期日"}）` });
      break;
    }
    case "suspend":
      if (!a.reason.trim()) throw new MonthlyError("請填寫停用原因。");
      next.suspended = true;
      next.history.push({ at: now, actor: user.name, action: "停用", note: a.reason.trim() });
      break;
    case "resume":
      checkConflicts(next, r.id);
      next.suspended = false;
      next.history.push({ at: now, actor: user.name, action: "恢復" });
      break;
    case "update_vehicles": {
      const draft = clean({ ...r, vehicles: a.vehicles });
      const errs = validateContract({ ...draft, startsOn: r.startsOn, activatesOn: r.activatesOn }, monthlyPlans.find((p) => p.id === r.planId), r.startsOn);
      if (errs.vehicles || errs.plates) throw new MonthlyError(errs.vehicles ?? "車牌格式有誤。", 422, { vehicles: errs.vehicles, plates: errs.plates });
      checkConflicts({ ...next, vehicles: draft.vehicles }, r.id);
      const before = r.vehicles.map((x) => x.plate).join("、");
      next.vehicles = draft.vehicles;
      next.history.push({ at: now, actor: user.name, action: "變更車牌", note: `${before} → ${draft.vehicles.map((x) => x.plate).join("、")}` });
      break;
    }
  }
  await syncDb(next);
  Object.assign(r, next);
  audit(user, site.orgId, { confirm_payment: "月租收款", renew: "月租續約", suspend: "月租停用", resume: "月租恢復", update_vehicles: "月租變更車牌" }[a.action], r.contractNo);
  return r;
}

function audit(user: Principal, orgId: string, action: string, target: string) {
  auditEntries.unshift({ at: new Date().toISOString(), actor: user.name, action, target, orgId });
}

export const isLive = live;

/** 雲端資料庫中同一前綴（站點＋年月）的最大流水號 */
async function maxDbSeq(prefix: string): Promise<number> {
  if (!dbConfigured()) return 0;
  const r = await pool().query("SELECT max(right(contract_no, 4)::int) AS m FROM monthly_contracts WHERE contract_no LIKE $1 || '%' AND right(contract_no, 4) ~ '^[0-9]{4}$'", [prefix]);
  return Number(r.rows[0]?.m ?? 0);
}

// ---------------------------------------------------------------- 雲端資料庫同步

/** 寫入 customers／vehicles／monthly_contracts／contract_vehicles；工控機下次下載設定就拿到新的白名單 */
async function syncDb(r: MonthlyRecord, opts: { isNew?: boolean } = {}) {
  if (!dbConfigured()) return;
  try { await writeDb(r, opts.isNew ?? false); } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "23P01") throw new MonthlyError(`車位 ${r.space} 在這段期間已出租（雲端資料庫）。`, 409, { space: "這段期間已出租。" });
    if (code === "23505") throw e;   // 合約編號重複：由呼叫端換號重試
    if (code === "23514") throw new MonthlyError("資料不符合合約規則，請檢查日期、折扣與付款狀態。", 422);
    throw e;
  }
}

async function writeDb(r: MonthlyRecord, isNew: boolean) {
  const site = siteRecords.find((s) => s.id === r.siteId)!;
  const plan = monthlyPlans.find((p) => p.id === r.planId)!;
  await tx(async (c) => {
    const s = (await c.query("SELECT id FROM sites WHERE code = $1", [site.code])).rows[0];
    if (!s) return;   // 雲端資料庫還沒有這個站點：只存 Mock
    let planId = (await c.query("SELECT id FROM monthly_plans WHERE site_id = $1 AND name = $2", [s.id, plan.name])).rows[0]?.id;
    planId ??= (await c.query("INSERT INTO monthly_plans (site_id, name, plan_type, monthly_price, max_contracts) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [s.id, plan.name, plan.type, plan.monthlyPrice, plan.maxContracts ?? null])).rows[0].id;

    // 新合約一律 INSERT（編號重複會失敗並換號），不會覆蓋到別人的合約
    const existing = isNew ? undefined : (await c.query("SELECT id, customer_id FROM monthly_contracts WHERE contract_no = $1", [r.contractNo])).rows[0];
    const cu = r.customer;
    const customerId = existing?.customer_id
      ? (await c.query(
          `UPDATE customers SET display_name = $2, phone = $3, email = NULLIF($4, ''), customer_type = $5, company_name = NULLIF($6, ''), tax_id = NULLIF($7, ''),
             contact_address = NULLIF($8, ''), note = NULLIF($9, '') WHERE id = $1 RETURNING id`,
          [existing.customer_id, cu.name, cu.phone, cu.email, cu.type, cu.companyName, cu.taxId, cu.address, cu.note])).rows[0].id
      : (await c.query(
          `INSERT INTO customers (display_name, phone, email, customer_type, company_name, tax_id, contact_address, note)
           VALUES ($1, $2, NULLIF($3, ''), $4, NULLIF($5, ''), NULLIF($6, ''), NULLIF($7, ''), NULLIF($8, '')) RETURNING id`,
          [cu.name, cu.phone, cu.email, cu.type, cu.companyName, cu.taxId, cu.address, cu.note])).rows[0].id;

    const status = r.cancelled ? "cancelled" : r.suspended ? "suspended" : r.paymentStatus === "unpaid" ? "pending" : "active";
    const vals = [s.id, planId, customerId, r.contractNo, r.startsOn, r.endsOn, status, r.activatesOn, r.months, r.monthlyFee, r.discount,
      r.discountReason || null, r.deposit, r.paymentMethod, r.paymentStatus, r.paymentRef || null, r.paidAt ?? null,
      JSON.stringify({ kind: r.invoiceKind, value: r.invoiceValue || null }), r.remindDays, r.space || null, r.note || null];
    const contractId = existing
      ? (await c.query(
          `UPDATE monthly_contracts SET site_id=$1, plan_id=$2, customer_id=$3, starts_on=$5, ends_on=$6, status=$7, activates_on=$8, months=$9, monthly_fee=$10,
             discount=$11, discount_reason=$12, deposit=$13, payment_method=$14, payment_status=$15, payment_ref=$16, paid_at=$17, invoice=$18,
             remind_days=$19, space_label=$20, note=$21 WHERE contract_no=$4 RETURNING id`, vals)).rows[0].id
      : (await c.query(
          `INSERT INTO monthly_contracts (site_id, plan_id, customer_id, contract_no, starts_on, ends_on, status, activates_on, months, monthly_fee,
             discount, discount_reason, deposit, payment_method, payment_status, payment_ref, paid_at, invoice, remind_days, space_label, note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`, vals)).rows[0].id;

    await c.query("DELETE FROM contract_vehicles WHERE contract_id = $1", [contractId]);
    for (const v of r.vehicles) {
      const plate = edgePlate(v.plate);
      const vid = (await c.query(
        `INSERT INTO vehicles (plate_no, customer_id, vehicle_type, brand, color) VALUES ($1, $2, $3, NULLIF($4, ''), NULLIF($5, ''))
         ON CONFLICT (plate_no) DO UPDATE SET customer_id = EXCLUDED.customer_id, vehicle_type = EXCLUDED.vehicle_type,
           brand = COALESCE(EXCLUDED.brand, vehicles.brand), color = COALESCE(EXCLUDED.color, vehicles.color) RETURNING id`,
        [plate, customerId, v.kind, v.brand, v.color])).rows[0].id;
      await c.query("INSERT INTO contract_vehicles (contract_id, vehicle_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [contractId, vid]);
    }
    // 通知工控機重新下載（白名單）
    await c.query("UPDATE edge_gateways SET config_version = config_version + 1 WHERE site_id = $1 AND status <> 'retired'", [s.id]);
  });
}
