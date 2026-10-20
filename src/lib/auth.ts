import { cookies } from "next/headers";
import { mockPersonas } from "./mock/tenancy";
import type { Principal } from "./permissions";

export const PERSONA_COOKIE = "pd_mock_persona";

/**
 * 目前登入者。Mock 版從 cookie 讀「預覽身分」；正式版改為驗證 session token、
 * 從 user_role_bindings 載入角色，並在每個資料庫交易設定 app.user_id／app.is_hq／app.org_ids。
 */
export async function getCurrentUser(): Promise<Principal & { label: string }> {
  const id = (await cookies()).get(PERSONA_COOKIE)?.value;
  return mockPersonas.find((p) => p.id === id) ?? mockPersonas[0];
}
