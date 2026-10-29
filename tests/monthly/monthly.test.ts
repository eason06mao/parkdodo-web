// npm run test:monthly — 月租建檔規則
import assert from "node:assert/strict";
import { test } from "node:test";
import { amounts, contractState, emptyCustomer, endsOn, hasErrors, validateContract, type ContractInput, type MonthlyPlan } from "../../src/lib/monthly";
import { createContract, updateContract } from "../../src/lib/monthlyServer";
import type { Principal } from "../../src/lib/permissions";

const shared: MonthlyPlan = { id: "plan-001-shared", siteId: "site-001", name: "共用月租", type: "shared", monthlyPrice: 2200, maxContracts: 20, active: true };
const fixed: MonthlyPlan = { id: "plan-001-fixed", siteId: "site-001", name: "固定車位", type: "fixed", monthlyPrice: 3000, active: true };
const TODAY = "2026-10-30";
const draft = (o: Partial<ContractInput> = {}): ContractInput => ({
  siteId: "site-001", planId: shared.id, space: "", customer: { ...emptyCustomer(), name: "王小明", phone: "0912-345-678" },
  vehicles: [{ plate: "TST-0001", kind: "car", brand: "", color: "" }], startsOn: "2026-11-01", activatesOn: "2026-11-01", months: 1,
  monthlyFee: 2200, discount: 0, discountReason: "", deposit: 0, paymentMethod: "cash", paymentStatus: "paid", paymentRef: "",
  invoiceKind: "paper", invoiceValue: "", remindDays: 14, note: "", ...o,
});

test("到期日：生效日加期數減一天，月底對齊", () => {
  assert.equal(endsOn("2026-11-01", 1), "2026-11-30");
  assert.equal(endsOn("2026-11-01", 3), "2027-01-31");
  assert.equal(endsOn("2026-11-15", 1), "2026-12-14");
  assert.equal(endsOn("2027-01-31", 1), "2027-02-27");   // 2/28 前一天
  assert.equal(endsOn("2026-12-01", 12), "2027-11-30");
});

test("金額：租金 × 期數 − 折扣 + 押金", () => {
  assert.deepEqual(amounts({ monthlyFee: 2200, months: 6, discount: 1320, deposit: 500 }), { rent: 13200, total: 11880, deposit: 500, due: 12380 });
});

test("狀態：待付款或未到啟用日＝待開通；14 天內到期；過期；停用", () => {
  const c = { startsOn: "2026-11-01", activatesOn: "2026-11-01", endsOn: "2026-11-30", paymentStatus: "paid" as const };
  assert.equal(contractState(c, TODAY), "pending");
  assert.equal(contractState({ ...c, activatesOn: "2026-10-30" }, TODAY), "active");
  assert.equal(contractState({ ...c, activatesOn: "2026-10-30", paymentStatus: "unpaid" }, TODAY), "pending");
  assert.equal(contractState(c, "2026-11-20"), "expiring");
  assert.equal(contractState(c, "2026-12-01"), "expired");
  assert.equal(contractState({ ...c, suspended: true } as never, "2026-11-05"), "suspended");
});

test("檢查：必填、電話、統編、車牌、啟用日、折扣、付款參考", () => {
  assert.equal(hasErrors(validateContract(draft(), shared, TODAY)), false);
  const e = validateContract(draft({ customer: { ...emptyCustomer(), type: "company", phone: "123", taxId: "12345679" }, vehicles: [{ plate: "ABC1234", kind: "car", brand: "", color: "" }, { plate: "ABC-1234", kind: "car", brand: "", color: "" }] }), shared, TODAY);
  assert.ok(e.name && e.phone && e.companyName && e.taxId);
  assert.ok(e.plates?.[0] && e.plates?.[1]);   // 格式錯、重複
  assert.ok(validateContract(draft({ planId: fixed.id }), fixed, TODAY).space);
  assert.ok(validateContract(draft({ activatesOn: "2026-10-20" }), shared, TODAY).activatesOn, "最多提早 7 天");
  assert.equal(validateContract(draft({ activatesOn: "2026-10-28" }), shared, TODAY).activatesOn, undefined);
  assert.ok(validateContract(draft({ activatesOn: "2026-12-05" }), shared, TODAY).activatesOn, "不能晚於到期日");
  assert.ok(validateContract(draft({ discount: 300 }), shared, TODAY).discount, "折扣要填原因");
  assert.ok(validateContract(draft({ discount: 1000, discountReason: "x" }), shared, TODAY).discount, "超過 30%");
  assert.ok(validateContract(draft({ paymentMethod: "transfer" }), shared, TODAY).paymentRef);
  assert.ok(validateContract(draft({ invoiceKind: "company" }), shared, TODAY).invoiceValue, "統編發票要公司客戶");
  assert.ok(validateContract(draft({ invoiceKind: "mobile", invoiceValue: "ABC" }), shared, TODAY).invoiceValue);
});

const hq: Principal = { id: "u-hq-admin", name: "總部", isHq: true, bindings: [{ orgId: "org-hq", role: "hq_admin" }] };
const staff: Principal = { id: "u-st", name: "現場", isHq: false, bindings: [{ orgId: "org-lic-a", role: "licensee_staff", siteId: "site-002" }] };

test("建立：沒權限擋下；車位重疊、車牌重複擋下", async () => {
  await assert.rejects(createContract(staff, draft({ siteId: "site-002", planId: "plan-002-shared" })), /沒有/);
  const a = await createContract(hq, draft({ planId: fixed.id, space: "B-03", monthlyFee: 3000, vehicles: [{ plate: "TST-1001", kind: "car", brand: "", color: "" }] }));
  assert.match(a.contractNo, /^M-TXG001-2611-\d{4}$/);
  assert.equal(a.endsOn, "2026-11-30");
  await assert.rejects(createContract(hq, draft({ planId: fixed.id, space: "B-03", monthlyFee: 3000, startsOn: "2026-11-15", activatesOn: "2026-11-15", vehicles: [{ plate: "TST-1002", kind: "car", brand: "", color: "" }] })), /已出租/);
  await assert.rejects(createContract(hq, draft({ vehicles: [{ plate: "TST-1001", kind: "car", brand: "", color: "" }] })), /已有月租合約/);
  // 不重疊的期間可以
  await createContract(hq, draft({ planId: fixed.id, space: "B-03", monthlyFee: 3000, startsOn: "2026-12-01", activatesOn: "2026-12-01", vehicles: [{ plate: "TST-1003", kind: "car", brand: "", color: "" }] }));
});

test("收款、續約、停用、變更車牌", async () => {
  const r = await createContract(hq, draft({ paymentStatus: "unpaid", vehicles: [{ plate: "TST-2001", kind: "car", brand: "", color: "" }] }));
  await assert.rejects(updateContract(hq, r.id, { action: "confirm_payment", method: "transfer", ref: "" }), /末五碼/);
  await updateContract(hq, r.id, { action: "confirm_payment", method: "transfer", ref: "12345" });
  assert.equal(r.paymentStatus, "paid");
  await updateContract(hq, r.id, { action: "renew", months: 3, paymentStatus: "paid", method: "cash", ref: "" });
  assert.equal(r.endsOn, "2027-02-28");
  await assert.rejects(updateContract(hq, r.id, { action: "suspend", reason: " " }), /原因/);
  await updateContract(hq, r.id, { action: "suspend", reason: "暫停使用" });
  assert.equal(r.suspended, true);
  await updateContract(hq, r.id, { action: "resume" });
  await updateContract(hq, r.id, { action: "update_vehicles", vehicles: [{ plate: "tst-2002", kind: "car", brand: "", color: "" }] });
  assert.deepEqual(r.vehicles.map((x) => x.plate), ["TST-2002"]);
  assert.deepEqual(r.history.map((h) => h.action), ["建立合約", "確認收款", "續約", "停用", "恢復", "變更車牌"]);
});

test("同時建立多份合約：合約編號不會重複", async () => {
  const mk = (i: number) => createContract(hq, draft({ startsOn: "2026-12-01", activatesOn: "2026-12-01", vehicles: [{ plate: `CON-${1000 + i}`, kind: "car", brand: "", color: "" }] }));
  const rs = await Promise.all([0, 1, 2, 3, 4].map(mk));
  assert.equal(new Set(rs.map((r) => r.contractNo)).size, 5);
});

test("續約待付款：原本已付款的期間照常有效；收款後才延長到期日，只收續約金額", async () => {
  const r = await createContract(hq, draft({ startsOn: "2026-10-15", activatesOn: "2026-10-15", deposit: 500, vehicles: [{ plate: "REN-0001", kind: "car", brand: "", color: "" }] }));
  assert.equal(contractState(r, TODAY), "active");
  await updateContract(hq, r.id, { action: "renew", months: 1, paymentStatus: "unpaid", method: "cash", ref: "" });
  assert.equal(r.endsOn, "2026-11-14", "未付款不延長");
  assert.equal(r.paymentStatus, "paid");
  assert.notEqual(contractState(r, TODAY), "pending", "已付款期間不能被改成待開通");
  await assert.rejects(updateContract(hq, r.id, { action: "renew", months: 1, paymentStatus: "unpaid", method: "cash", ref: "" }), /待付款/);
  // 續約期間先保留：別人不能用同一車牌搶在這段期間
  await assert.rejects(createContract(hq, draft({ startsOn: "2026-11-20", activatesOn: "2026-11-20", vehicles: [{ plate: "REN-0001", kind: "car", brand: "", color: "" }] })), /已有月租合約/);
  await updateContract(hq, r.id, { action: "confirm_payment", method: "cash", ref: "" });
  assert.equal(r.endsOn, "2026-12-14");
  const last = r.history.at(-1)!;
  assert.equal(last.action, "續約收款");
  assert.match(last.note!, /NT\$2,200/, "只收 1 個月租金，不含已付的月份與押金");
  await assert.rejects(updateContract(hq, r.id, { action: "confirm_payment", method: "cash", ref: "" }), /沒有待收/);
});
