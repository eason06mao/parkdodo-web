// Mock：月租方案、車位、合約。名稱、電話皆為示範資料。重新啟動開發伺服器後，新增的合約會消失。
import { endsOn, type ContractInput, type MonthlyPlan } from "../monthly";

export interface MonthlyHistory { at: string; actor: string; action: string; note?: string }

/** 續約期間：已付款才把合約到期日延長；待付款的續約不影響目前已付款的期間 */
export interface Renewal { from: string; endsOn: string; months: number; amount: number; createdAt: string; paidAt?: string; method?: string; ref?: string }

export interface MonthlyRecord extends ContractInput {
  id: string;
  contractNo: string;
  endsOn: string;
  createdAt: string;
  createdBy: string;
  paidAt?: string;
  suspended?: boolean;
  cancelled?: boolean;
  inside: boolean;
  renewals: Renewal[];
  history: MonthlyHistory[];
}

const seed_plans: MonthlyPlan[] = [
  { id: "plan-001-fixed", siteId: "site-001", name: "固定車位", type: "fixed", monthlyPrice: 3000, active: true },
  { id: "plan-001-shared", siteId: "site-001", name: "共用月租", type: "shared", monthlyPrice: 2200, maxContracts: 20, active: true },
  { id: "plan-001-night", siteId: "site-001", name: "夜間月租（18:00–08:00）", type: "shared", monthlyPrice: 1500, maxContracts: 10, active: true },
  { id: "plan-002-shared", siteId: "site-002", name: "共用月租", type: "shared", monthlyPrice: 1800, maxContracts: 12, active: true },
];

/** 固定車位編號（之後接 parking_spaces 資料表） */
const seed_spaces: Record<string, string[]> = {
  "site-001": Array.from({ length: 12 }, (_, i) => `B-${String(i + 1).padStart(2, "0")}`),
  "site-002": [],
};

const person = (name: string, phone: string) => ({ type: "person" as const, name, phone, email: "", companyName: "", taxId: "", address: "", note: "" });
const base = (o: Partial<ContractInput> & Pick<ContractInput, "planId" | "startsOn" | "months" | "monthlyFee">): ContractInput => ({
  siteId: "site-001", space: "", customer: person("車主", "0912-000-000"), vehicles: [],
  activatesOn: o.startsOn, discount: 0, discountReason: "", deposit: 0, paymentMethod: "cash", paymentStatus: "paid", paymentRef: "",
  invoiceKind: "member", invoiceValue: "", remindDays: 14, note: "", ...o,
});
const rec = (id: string, no: string, c: ContractInput, inside: boolean): MonthlyRecord => ({
  ...c, id, contractNo: no, endsOn: endsOn(c.startsOn, c.months), createdAt: `${c.startsOn}T10:00:00+08:00`, createdBy: "示範總部管理員",
  paidAt: c.paymentStatus === "paid" ? `${c.startsOn}T10:00:00+08:00` : undefined, inside, renewals: [],
  history: [{ at: `${c.startsOn}T10:00:00+08:00`, actor: "示範總部管理員", action: "建立合約" }],
});
const car = (plate: string) => ({ plate, kind: "car" as const, brand: "", color: "" });

const seed_records: MonthlyRecord[] = [
  rec("m1", "M-TXG001-2610-0001", base({ planId: "plan-001-fixed", space: "B-12", startsOn: "2026-10-01", months: 1, monthlyFee: 3000, customer: person("車主 A", "0912-111-111"), vehicles: [car("DEF-2468")] }), true),
  rec("m2", "M-TXG001-2610-0002", base({ planId: "plan-001-shared", startsOn: "2026-10-05", months: 1, monthlyFee: 2200, customer: person("車主 B", "0912-222-222"), vehicles: [car("PQR-7788")] }), false),
  rec("m3", "M-TXG001-2610-0003", base({ planId: "plan-001-shared", startsOn: "2026-10-15", months: 3, monthlyFee: 2200, customer: person("車主 C", "0912-333-333"), vehicles: [car("STU-1122"), car("STU-3344")] }), true),
  rec("m4", "M-TXG001-2609-0001", base({ planId: "plan-001-fixed", space: "B-07", startsOn: "2026-09-01", months: 1, monthlyFee: 3000, customer: person("車主 D", "0912-444-444"), vehicles: [car("VWX-3344")] }), false),
  rec("m5", "M-TXG001-2610-0004", base({ planId: "plan-001-shared", startsOn: "2026-10-10", months: 6, monthlyFee: 2200, discount: 1320, discountReason: "預繳半年 9 折", customer: person("車主 E", "0912-555-555"), vehicles: [car("LMN-5566")] }), false),
];

const store = globalThis as unknown as { __pdMonthly?: { plans: MonthlyPlan[]; spaces: Record<string, string[]>; records: MonthlyRecord[] } };
store.__pdMonthly ??= { plans: seed_plans, spaces: seed_spaces, records: seed_records };
export const { plans: monthlyPlans, spaces: fixedSpaces, records: monthlyRecords } = store.__pdMonthly;
