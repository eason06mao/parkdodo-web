// 公司網站（parkdodo.tw）的內容：要修改公司資料、場站、政策，只改這個檔案。
// 值為 null 的欄位在網頁上會顯示「待補」，上線前必須填好（統一金流審核會看）。
import { DEFAULT_PLAN } from "./billing/fee";

export const COMPANY = {
  brand: "ParkDodo",
  name: "車格跳動有限公司",
  taxId: "62171653",
  address: "臺中市西區大昌街216號1樓",
  email: "service@parkdodo.tw",
  phone: null as string | null,           // 客服電話：業主之後決定是否公開；null 時網站不顯示這一列
  policyDate: "2026 年 11 月 15 日",       // 政策公告日期
};

export interface PublicSite {
  code: string; name: string; taxId: string;
  address: string | null;                  // 完整地址
  hours: string | null;                    // 例：24 小時
  spaces: number | null;                   // 車位數
}

export const SITES: PublicSite[] = [
  { code: "TXG001", name: "台中南屯停車場", taxId: "61079159", address: "408臺中市南屯區惠中里大墩十二街458號", hours: "24 小時", spaces: 30 },
  { code: "TXG002", name: "台中沙鹿停車場", taxId: "61082892", address: "433臺中市沙鹿區竹林里中山路128-33號", hours: "24 小時", spaces: 30 },
];

/** 收費標準（與計費程式同一份設定，改費率時網站自動一致） */
export const RATE = {
  freeMinutes: DEFAULT_PLAN.freeMinutes,
  unitMinutes: DEFAULT_PLAN.unitMinutes,
  unitPrice: DEFAULT_PLAN.unitPrice,
  graceMinutes: DEFAULT_PLAN.exitGraceMinutes,
  dailyCap: DEFAULT_PLAN.dailyCap,
};

/** 退款：業主確認後把 confirmed 改成 true */
export const REFUND = {
  confirmed: true,   // 業主 2026-11-15 確認
  days: 7,   // 查證後幾個工作天內退款
};

/** 月租：業主決定要不要放、怎麼申請 */
export const MONTHLY = {
  show: true,
  lineUrl: null as string | null,   // LINE 官方帳號加好友連結（例：https://lin.ee/xxxx）；提供後顯示
  howTo: "月租請來信 service@parkdodo.tw 洽詢，或在場內掃描會員 QR Code 登記「我想租月租」，我們會與你聯絡。",
};
