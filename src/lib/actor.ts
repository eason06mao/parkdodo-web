// 寫入稽核欄位（誰開閘、誰產生配對碼）時用的帳號信箱。
// 正式站目前用共用的後台門禁帳密（ADMIN_GATE），還沒有個人帳號：一律記在公司帳號 service@parkdodo.tw（正式站資料庫已建立）。
// 測試站與本機沿用「預覽身分」的示範帳號。個人帳號登入完成後改成真正登入者。
import { COMPANY } from "./siteContent";
import { accounts } from "./mock/tenancy";

export function actorEmail(userId: string, env: Record<string, string | undefined> = process.env): string {
  if (env.ADMIN_GATE) return COMPANY.email;
  return accounts.find((a) => a.id === userId)?.email ?? "";
}
