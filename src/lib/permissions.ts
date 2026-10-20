// 角色與權限（與 db/migrations 0001、0002 的種子資料一致）。
// 前端只用來「決定要不要顯示按鈕」；真正的把關在後端 API 與資料庫（觸發器＋RLS）。
// 這個檔案不依賴伺服器 API，前後端都可以引用。

export type OrgType = "hq" | "operator" | "franchisee" | "licensee";

export type Permission =
  | "site.view" | "site.edit" | "site.settings" | "site.create" | "rate.publish"
  | "dashboard.view" | "session.view" | "session.adjust"
  | "gate.remote_open" | "gate.hold_open" | "incident.handle" | "monthly.manage"
  | "finance.view" | "refund.request" | "refund.approve" | "settlement.manage"
  | "device.manage" | "edge.pair" | "user.manage_org" | "org.manage"
  | "license.manage" | "license.view" | "audit.view" | "platform.admin";

export const PERMISSION_LABELS: Record<Permission, string> = {
  "site.view": "檢視站點",
  "site.edit": "編輯站點名稱與基本資料",
  "site.settings": "修改計費、寬限期等設定",
  "site.create": "新增站點",
  "rate.publish": "發布費率",
  "dashboard.view": "檢視儀表板與戰情板",
  "session.view": "檢視進出紀錄",
  "session.adjust": "人工結案、調整紀錄",
  "gate.remote_open": "遠端開閘",
  "gate.hold_open": "柵欄常開（需第二人核准）",
  "incident.handle": "處理例外",
  "monthly.manage": "管理月租",
  "finance.view": "檢視財務報表",
  "refund.request": "申請退款",
  "refund.approve": "核准退款",
  "settlement.manage": "結算",
  "device.manage": "設備設定",
  "edge.pair": "配對工控機",
  "user.manage_org": "管理本組織帳號",
  "org.manage": "管理組織（加盟主、系統客戶）",
  "license.manage": "開立與續約授權",
  "license.view": "檢視授權",
  "audit.view": "檢視稽核紀錄",
  "platform.admin": "平台管理",
};

/** 只能給總部角色的權限（資料庫 platform_only_permissions） */
export const HQ_ONLY: Permission[] = ["site.create", "org.manage", "license.manage", "edge.pair", "platform.admin"];

export type RoleCode =
  | "hq_admin" | "hq_ops" | "hq_support" | "hq_finance"
  | "operator_admin" | "operator_staff"
  | "franchisee_owner" | "franchisee_staff"
  | "licensee_admin" | "licensee_staff";

export interface Role { code: RoleCode; name: string; orgType: OrgType; description: string; permissions: Permission[] }

const P = (s: string) => s.split(" ") as Permission[];

export const ROLES: Role[] = [
  { code: "hq_admin", name: "總部管理員", orgType: "hq", description: "全平台設定、建站、授權與帳號管理",
    permissions: P("site.view site.edit site.settings site.create rate.publish dashboard.view session.view session.adjust gate.remote_open gate.hold_open incident.handle monthly.manage finance.view refund.request refund.approve settlement.manage device.manage edge.pair user.manage_org org.manage license.manage license.view audit.view platform.admin") },
  { code: "hq_ops", name: "總部營運", orgType: "hq", description: "所有站點的監控、例外處理、遠端開閘",
    permissions: P("site.view dashboard.view session.view session.adjust gate.remote_open gate.hold_open incident.handle refund.request device.manage license.view audit.view") },
  { code: "hq_support", name: "總部客服", orgType: "hq", description: "對講與客訴處理、遠端開閘",
    permissions: P("site.view session.view gate.remote_open incident.handle refund.request") },
  { code: "hq_finance", name: "總部財務", orgType: "hq", description: "對帳、退款核准、加盟結算",
    permissions: P("site.view dashboard.view session.view finance.view refund.approve settlement.manage license.view audit.view") },
  { code: "operator_admin", name: "自營站點管理員", orgType: "operator", description: "自己站點的設定、報表、遠端開閘",
    permissions: P("site.view site.edit site.settings dashboard.view session.view session.adjust gate.remote_open incident.handle monthly.manage finance.view refund.request user.manage_org license.view audit.view") },
  { code: "operator_staff", name: "自營現場人員", orgType: "operator", description: "自己站點的例外處理、遠端開閘",
    permissions: P("site.view session.view gate.remote_open incident.handle") },
  { code: "franchisee_owner", name: "加盟主", orgType: "franchisee", description: "自己站點的報表、帳號、遠端開閘",
    permissions: P("site.view site.edit dashboard.view session.view gate.remote_open incident.handle monthly.manage finance.view refund.request user.manage_org license.view audit.view") },
  { code: "franchisee_staff", name: "加盟現場人員", orgType: "franchisee", description: "自己站點的例外處理、遠端開閘",
    permissions: P("site.view session.view gate.remote_open incident.handle") },
  { code: "licensee_admin", name: "系統客戶管理員", orgType: "licensee", description: "自己站點的設定、費率、報表、帳號、遠端開閘",
    permissions: P("site.view site.edit site.settings rate.publish dashboard.view session.view session.adjust gate.remote_open incident.handle monthly.manage finance.view refund.request refund.approve device.manage user.manage_org license.view audit.view") },
  { code: "licensee_staff", name: "系統客戶現場人員", orgType: "licensee", description: "自己站點的例外處理、遠端開閘",
    permissions: P("site.view session.view gate.remote_open incident.handle") },
];

export const roleByCode = (code: RoleCode) => ROLES.find((r) => r.code === code)!;

export const ORG_TYPE_LABELS: Record<OrgType, string> = {
  hq: "總部", operator: "自營商", franchisee: "加盟主", licensee: "系統客戶",
};

/** 使用者在某組織的角色綁定；siteId 為空代表該組織全部站點 */
export interface RoleBinding { orgId: string; role: RoleCode; siteId?: string }

export interface Principal {
  id: string;
  name: string;
  isHq: boolean;
  bindings: RoleBinding[];
}

/** 是否擁有某權限。給 orgId／siteId 時只看涵蓋該範圍的綁定。 */
export function can(user: Principal, perm: Permission, scope?: { orgId?: string; siteId?: string }): boolean {
  return user.bindings.some((b) => {
    const role = roleByCode(b.role);
    if (!role.permissions.includes(perm)) return false;
    if (role.permissions.includes("platform.admin")) return true;
    if (scope?.orgId && b.orgId !== scope.orgId) return false;
    if (scope?.siteId && b.siteId && b.siteId !== scope.siteId) return false;
    return true;
  });
}

/** 在某組織中，授權者可以指派的角色（與資料庫 check_role_binding 規則相同） */
export function grantableRoles(granter: Principal, org: { id: string; type: OrgType }): Role[] {
  if (can(granter, "platform.admin")) return ROLES.filter((r) => r.orgType === org.type);
  const mine = granter.bindings.filter((b) => b.orgId === org.id);
  if (!mine.some((b) => roleByCode(b.role).permissions.includes("user.manage_org"))) return [];
  const myPerms = new Set(mine.flatMap((b) => roleByCode(b.role).permissions));
  return ROLES.filter((r) => r.orgType === org.type && r.permissions.every((p) => myPerms.has(p)));
}

/** 授權者能指派的站點範圍：null 代表可以指派全組織 */
export function grantableSiteScope(granter: Principal, orgId: string): string[] | null {
  if (can(granter, "platform.admin")) return null;
  const manage = granter.bindings.filter((b) => b.orgId === orgId && roleByCode(b.role).permissions.includes("user.manage_org"));
  if (manage.some((b) => !b.siteId)) return null;
  return manage.map((b) => b.siteId!).filter(Boolean);
}

/** 檢查一筆授權是否合法；回傳錯誤訊息或 null */
export function checkGrant(
  granter: Principal,
  org: { id: string; type: OrgType },
  target: { userId?: string; role: RoleCode; siteId?: string; siteOrgId?: string },
): string | null {
  if (target.userId && target.userId === granter.id) return "不能授權給自己。";
  const role = ROLES.find((r) => r.code === target.role);
  if (!role) return "角色不存在。";
  if (role.orgType !== org.type) return `「${role.name}」不屬於${ORG_TYPE_LABELS[org.type]}的角色。`;
  if (target.siteId && target.siteOrgId !== org.id) return "這個站點不屬於該組織。";
  if (!grantableRoles(granter, org).some((r) => r.code === role.code)) return "不能指派比自己權限大的角色，或你沒有管理這個組織帳號的權限。";
  const scope = grantableSiteScope(granter, org.id);
  if (scope && (!target.siteId || !scope.includes(target.siteId))) return "你只能為自己負責的站點建立帳號。";
  return null;
}
