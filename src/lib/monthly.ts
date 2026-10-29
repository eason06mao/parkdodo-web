// 月租建檔規則（前端即時檢查與後端 API 共用）。
//   生效日：合約開始、月租費起算日；到期日＝生效日加上期數個月的前一天（11/1 起 3 個月 → 1/31）。
//   啟用日：車牌開通、可以進出的日期。預設＝生效日，可以提早（最多 7 天，例如先繳費先開通），不能晚於到期日。
//   付款狀態「待付款」時合約存為「待開通」，付款確認後才開通車牌。
// 金額一律新台幣整數。日期一律 YYYY-MM-DD（台北時間）。
import { isEmail, isTaxId } from "./invoice";
import { normalizePlate } from "./manualEntry";

export type PlanType = "fixed" | "shared";
export type CustomerType = "person" | "company";
export type PaymentMethod = "cash" | "transfer" | "card" | "online";
export type PaymentStatus = "paid" | "unpaid";
export type InvoiceKind = "member" | "mobile" | "company" | "donate" | "paper";
export type ContractState = "pending" | "active" | "expiring" | "expired" | "suspended" | "cancelled";

export const PLAN_TYPE_LABELS: Record<PlanType, string> = { fixed: "固定車位", shared: "共用月租" };
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = { cash: "現金", transfer: "銀行轉帳", card: "刷卡", online: "線上付款（寄付款連結）" };
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = { paid: "已付款", unpaid: "待付款" };
export const STATE_LABELS: Record<ContractState, string> = {
  pending: "待開通", active: "有效", expiring: "即將到期", expired: "已到期", suspended: "已停用", cancelled: "已解約",
};
export const TERM_OPTIONS = [1, 3, 6, 12] as const;
export const MAX_PLATES = 3;            // 一份合約最多登記幾台車（同時只能一台在場）
export const EARLY_ACTIVATION_DAYS = 7;
export const EXPIRING_DAYS = 14;
export const MAX_DISCOUNT_RATE = 0.3;   // 折扣超過 30% 需要主管（之後接核准流程）

export interface MonthlyPlan {
  id: string;
  siteId: string;
  name: string;
  type: PlanType;
  monthlyPrice: number;
  /** 共用月租合約上限（可超賣上限）；固定車位以車位數為上限 */
  maxContracts?: number;
  active: boolean;
}

export interface CustomerInput {
  type: CustomerType;
  name: string;              // 個人：姓名；公司：聯絡人
  phone: string;
  email: string;
  companyName: string;
  taxId: string;
  address: string;
  note: string;
}

export interface VehicleInput { plate: string; kind: "car" | "motorcycle"; brand: string; color: string }

export interface ContractInput {
  siteId: string;
  planId: string;
  space: string;             // 固定車位必填
  customer: CustomerInput;
  vehicles: VehicleInput[];
  startsOn: string;          // 生效日
  activatesOn: string;       // 啟用日
  months: number;
  monthlyFee: number;        // 預設＝方案月費，可調整
  discount: number;          // 折扣金額
  discountReason: string;
  deposit: number;           // 押金（例：遙控器、磁扣）
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paymentRef: string;        // 轉帳末五碼、刷卡授權碼等
  invoiceKind: InvoiceKind;
  invoiceValue: string;      // 手機條碼／愛心碼
  remindDays: number;        // 到期前幾天提醒續約
  note: string;
}

export const emptyCustomer = (): CustomerInput => ({ type: "person", name: "", phone: "", email: "", companyName: "", taxId: "", address: "", note: "" });
export const emptyVehicle = (): VehicleInput => ({ plate: "", kind: "car", brand: "", color: "" });

// ---------------------------------------------------------------- 日期

const pad = (n: number) => String(n).padStart(2, "0");
export const todayTaipei = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(now);

const parse = (d: string) => { const [y, m, day] = d.split("-").map(Number); return { y, m, day }; };
const fmt = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const isDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s;
};

export function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** 到期日＝生效日 + months 個月 − 1 天；月底對齊（1/31 起 1 個月 → 2/28） */
export function endsOn(startsOn: string, months: number): string {
  const { y, m, day } = parse(startsOn);
  const total = m - 1 + months;
  const ny = y + Math.floor(total / 12), nm = (total % 12) + 1;
  const nd = Math.min(day, daysInMonth(ny, nm));
  return addDays(fmt(ny, nm, nd), -1);
}

// ---------------------------------------------------------------- 金額

export function amounts(v: Pick<ContractInput, "monthlyFee" | "months" | "discount" | "deposit">) {
  const rent = Math.max(0, v.monthlyFee) * v.months;
  const total = Math.max(0, rent - v.discount);
  return { rent, total, deposit: v.deposit, due: total + v.deposit };
}

// ---------------------------------------------------------------- 狀態

export function contractState(c: { startsOn: string; activatesOn: string; endsOn: string; paymentStatus: PaymentStatus; suspended?: boolean; cancelled?: boolean }, today = todayTaipei()): ContractState {
  if (c.cancelled) return "cancelled";
  if (c.suspended) return "suspended";
  if (today > c.endsOn) return "expired";
  if (c.paymentStatus === "unpaid" || today < c.activatesOn) return "pending";
  if (daysBetween(today, c.endsOn) <= EXPIRING_DAYS) return "expiring";
  return "active";
}

/** 車牌是否可以進出（給工控機白名單用） */
export const canEnter = (c: Parameters<typeof contractState>[0], today = todayTaipei()) => {
  const s = contractState(c, today);
  return s === "active" || s === "expiring";
};

// ---------------------------------------------------------------- 檢查

export type ContractErrors = Partial<Record<
  "planId" | "space" | "name" | "phone" | "email" | "companyName" | "taxId" | "vehicles" | "startsOn" | "activatesOn" | "months" |
  "monthlyFee" | "discount" | "deposit" | "paymentRef" | "invoiceValue" | "remindDays", string>> & { plates?: Record<number, string> };

export const isPhone = (s: string) => /^09\d{8}$/.test(s.replace(/[\s-]/g, "")) || /^0\d{1,3}-?\d{5,8}$/.test(s.replace(/\s/g, ""));
export const formatPlate = (s: string) => normalizePlate(s).replace(/[^A-Z0-9-]/g, "");
export const isTwPlate = (s: string) => /^[A-Z0-9]{2,4}-[A-Z0-9]{2,4}$/.test(formatPlate(s));

export function validateContract(v: ContractInput, plan: MonthlyPlan | undefined, today = todayTaipei()): ContractErrors {
  const e: ContractErrors = {};
  if (!plan || !plan.active) e.planId = "請選擇方案。";
  if (plan?.type === "fixed" && !v.space.trim()) e.space = "固定車位請選擇車位。";

  const c = v.customer;
  if (!c.name.trim()) e.name = c.type === "company" ? "請填寫聯絡人。" : "請填寫姓名。";
  if (!isPhone(c.phone)) e.phone = "請填寫手機（例：0912-345-678）或市話（例：04-2345-6789）。";
  if (c.email && !isEmail(c.email)) e.email = "Email 格式不正確。";
  if (c.type === "company") {
    if (!c.companyName.trim()) e.companyName = "請填寫公司名稱。";
    if (!isTaxId(c.taxId)) e.taxId = "統一編號應為 8 位數字且檢查碼正確。";
  }

  const plates: Record<number, string> = {};
  const seen = new Set<string>();
  const filled = v.vehicles.filter((x) => x.plate.trim());
  if (filled.length === 0) e.vehicles = "請至少登記一台車。";
  if (filled.length > MAX_PLATES) e.vehicles = `一份合約最多登記 ${MAX_PLATES} 台車。`;
  v.vehicles.forEach((x, i) => {
    if (!x.plate.trim()) return;
    const p = formatPlate(x.plate);
    if (!isTwPlate(p)) plates[i] = "車牌格式應為 ABC-1234（英數字之間加「-」）。";
    else if (seen.has(p.replace("-", ""))) plates[i] = "車牌重複。";
    seen.add(p.replace("-", ""));
  });
  if (Object.keys(plates).length) e.plates = plates;

  if (!isDate(v.startsOn)) e.startsOn = "請選擇生效日。";
  else if (daysBetween(today, v.startsOn) < -31) e.startsOn = "生效日不能早於一個月前（補登舊合約請洽主管）。";
  if (!TERM_OPTIONS.includes(v.months as (typeof TERM_OPTIONS)[number])) e.months = "請選擇期數。";
  if (!isDate(v.activatesOn)) e.activatesOn = "請選擇啟用日。";
  else if (isDate(v.startsOn)) {
    if (daysBetween(v.activatesOn, v.startsOn) > EARLY_ACTIVATION_DAYS) e.activatesOn = `啟用日最多比生效日提早 ${EARLY_ACTIVATION_DAYS} 天。`;
    else if (e.months === undefined && v.activatesOn > endsOn(v.startsOn, v.months)) e.activatesOn = "啟用日不能晚於到期日。";
  }

  if (!Number.isInteger(v.monthlyFee) || v.monthlyFee < 0 || v.monthlyFee > 100_000) e.monthlyFee = "月費需為 0 到 100,000 的整數。";
  const rent = Math.max(0, v.monthlyFee) * (v.months || 0);
  if (!Number.isInteger(v.discount) || v.discount < 0) e.discount = "折扣需為 0 以上的整數。";
  else if (v.discount > rent) e.discount = "折扣不能超過租金。";
  else if (v.discount > 0 && !v.discountReason.trim()) e.discount = "有折扣時請填寫原因（例：預繳半年優惠）。";
  else if (rent > 0 && v.discount / rent > MAX_DISCOUNT_RATE) e.discount = `折扣超過 ${MAX_DISCOUNT_RATE * 100}%，請主管處理。`;
  if (!Number.isInteger(v.deposit) || v.deposit < 0 || v.deposit > 50_000) e.deposit = "押金需為 0 到 50,000 的整數。";
  if (v.paymentStatus === "paid" && (v.paymentMethod === "transfer" || v.paymentMethod === "card") && !v.paymentRef.trim()) {
    e.paymentRef = v.paymentMethod === "transfer" ? "請填寫轉帳帳號末五碼。" : "請填寫刷卡授權碼。";
  }
  if (v.paymentStatus === "paid" && v.paymentMethod === "online") e.paymentRef = "線上付款會由系統確認，請選「待付款」並寄出付款連結。";
  if (v.invoiceKind === "mobile" && !/^\/[0-9A-Z+\-.]{7}$/.test(v.invoiceValue)) e.invoiceValue = "手機條碼格式為「/」加 7 碼。";
  if (v.invoiceKind === "donate" && !/^\d{3,7}$/.test(v.invoiceValue)) e.invoiceValue = "愛心碼為 3 到 7 位數字。";
  if (v.invoiceKind === "company" && c.type !== "company") e.invoiceValue = "開統編發票請把客戶類型改成「公司」並填寫統編。";
  if (!Number.isInteger(v.remindDays) || v.remindDays < 0 || v.remindDays > 60) e.remindDays = "提醒天數需為 0 到 60。";
  return e;
}

export const hasErrors = (e: ContractErrors) => Object.keys(e).some((k) => k !== "plates" || Object.keys(e.plates ?? {}).length > 0);

/** 合約編號：M-<站點代碼>-<年月>-<流水號>，例 M-TXG001-2611-0007 */
export function contractNo(siteCode: string, startsOn: string, seq: number): string {
  return `M-${siteCode}-${startsOn.slice(2, 4)}${startsOn.slice(5, 7)}-${String(seq).padStart(4, "0")}`;
}
