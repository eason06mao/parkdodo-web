// 新增站點表單：前端即時檢查與後端 API 共用同一套規則。
import type { OrgType } from "./permissions";
import type { CollectionMode, LicensePlan, OperationType } from "./types";

export interface NewSiteInput {
  name: string;
  city: string;
  district: string;
  address: string;
  totalSpaces: number;
  entryLanes: number;
  exitLanes: number;
  orgId: string;
  collectionMode: CollectionMode;
  agreementNo: string;
  plan: LicensePlan;
  maxLanes: number;
  startsOn: string;
  endsOn: string;
}

export const CITIES = ["台北市", "新北市", "桃園市", "台中市", "台南市", "高雄市", "其他"];

export const PLAN_LABELS: Record<LicensePlan, string> = { basic: "基本版", standard: "標準版", pro: "專業版" };

export const OPERATION_BY_ORG: Record<OrgType, OperationType> = {
  hq: "hq_owned", operator: "operator", franchisee: "franchise", licensee: "licensed",
};

export const OPERATION_LABELS: Record<OperationType, string> = {
  hq_owned: "總部自營", operator: "自營商", franchise: "加盟", licensed: "系統客戶",
};

export const COLLECTION_LABELS: Record<CollectionMode, string> = {
  hq_collect: "總部代收，依合約撥款", own_merchant: "客戶自有金流商店",
};

/** 依組織類型決定可選的收款方式 */
export function allowedCollection(orgType: OrgType): CollectionMode[] {
  if (orgType === "hq") return ["hq_collect"];
  if (orgType === "licensee") return ["own_merchant"];
  return ["hq_collect", "own_merchant"];
}

/** 總部自營站不需要軟體授權 */
export const needsLicense = (orgType: OrgType) => orgType !== "hq";

export type FieldErrors = Partial<Record<keyof NewSiteInput, string>>;

export function validateNewSite(v: NewSiteInput, orgType: OrgType | undefined): FieldErrors {
  const e: FieldErrors = {};
  if (!v.name.trim()) e.name = "請填寫站點名稱。";
  else if (v.name.trim().length > 40) e.name = "站點名稱最多 40 個字。";
  if (!CITIES.includes(v.city)) e.city = "請選擇縣市。";
  if (!v.address.trim()) e.address = "請填寫地址。";
  if (!Number.isInteger(v.totalSpaces) || v.totalSpaces < 1 || v.totalSpaces > 5000) e.totalSpaces = "車位數需為 1 到 5000 的整數。";
  if (!Number.isInteger(v.entryLanes) || v.entryLanes < 1 || v.entryLanes > 8) e.entryLanes = "入口車道需為 1 到 8。";
  if (!Number.isInteger(v.exitLanes) || v.exitLanes < 1 || v.exitLanes > 8) e.exitLanes = "出口車道需為 1 到 8。";
  if (!orgType) { e.orgId = "請選擇經營組織。"; return e; }
  if (!allowedCollection(orgType).includes(v.collectionMode)) e.collectionMode = "這個組織不能使用此收款方式。";
  if (orgType === "franchisee" && !v.agreementNo.trim()) e.agreementNo = "加盟站點必須填寫加盟合約編號。";
  if (needsLicense(orgType)) {
    if (!(v.plan in PLAN_LABELS)) e.plan = "請選擇方案。";
    if (!Number.isInteger(v.maxLanes) || v.maxLanes < v.entryLanes + v.exitLanes) e.maxLanes = "授權車道數不能少於入口加出口車道數。";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.startsOn)) e.startsOn = "請選擇開始日。";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.endsOn)) e.endsOn = "請選擇到期日。";
    else if (v.startsOn && v.endsOn < v.startsOn) e.endsOn = "到期日不能早於開始日。";
  }
  return e;
}
