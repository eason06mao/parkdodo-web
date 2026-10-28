// 角色與權限（與 db/migrations 0001、0002、0003 的種子資料一致）。
// 前端只用來「決定要不要顯示按鈕」；真正的把關在後端 API 與資料庫（觸發器＋RLS）。
// 這個檔案不依賴伺服器 API，前後端都可以引用。

export type OrgType = "hq" | "operator" | "franchisee" | "licensee";

export type Permission =
  | "site.view" | "site.edit" | "site.settings" | "site.create" | "rate.publish"
  | "dashboard.view" | "session.view" | "session.adjust"
  | "gate.remote_open" | "gate.hold_open" | "incident.handle" | "monthly.manage"
  | "finance.view" | "refund.request" | "refund.approve" | "settlement.manage"
  | "device.manage" | "edge.pair" | "user.manage_org" | "org.manage"
  | "license.manage" | "license.view" | "audit.view" | "role.manage" | "platform.admin";

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
  "role.manage": "建立與修改自訂角色",
  "platform.admin": "平台管理",
};

/** 角色編輯畫面的分組（順序即顯示順序） */
export const PERMISSION_GROUPS: { title: string; permissions: Permission[] }[] = [
  { title: "站點與設定", permissions: ["site.view", "site.edit", "site.settings", "rate.publish", "device.manage", "site.create", "edge.pair"] },
  { title: "現場營運", permissions: ["dashboard.view", "session.view", "incident.handle", "session.adjust", "gate.remote_open", "gate.hold_open", "monthly.manage"] },
  { title: "財務", permissions: ["finance.view", "refund.request", "refund.approve", "settlement.manage"] },
  { title: "帳號與稽核", permissions: ["user.manage_org", "role.manage", "audit.view", "license.view"] },
  { title: "平台（僅總部）", permissions: ["org.manage", "license.manage", "platform.admin"] },
];

/** 敏感權限：會動到柵欄、金額或權限本身，角色編輯畫面特別標示 */
export const SENSITIVE: Permission[] = [
  "gate.remote_open", "gate.hold_open", "refund.request", "refund.approve", "rate.publish",
  "session.adjust", "device.manage", "user.manage_org", "role.manage", "settlement.manage",
];

/** 只能給總部角色的權限（資料庫 platform_only_permissions） */
export const HQ_ONLY: Permission[] = ["site.create", "org.manage", "license.manage", "edge.pair", "platform.admin"];

export type SystemRoleCode =
  | "hq_admin" | "hq_ops" | "hq_support" | "hq_finance"
  | "operator_admin" | "operator_staff"
  | "franchisee_owner" | "franchisee_staff"
  | "licensee_admin" | "licensee_staff";

/** 系統角色代碼，或自訂角色代碼（c_ 開頭） */
export type RoleCode = SystemRoleCode | (string & {});

export interface Role {
  code: RoleCode;
  name: string;
  orgType: OrgType;
  description: string;
  permissions: Permission[];
  /** 自訂角色所屬組織；系統角色沒有 */
  orgId?: string;
  createdBy?: string;
  updatedAt?: string;
  archivedAt?: string;
}

const P = (s: string) => s.split(" ") as Permission[];

/** 系統預設角色（不能修改） */
export const ROLES: Role[] = [
  { code: "hq_admin", name: "總部管理員", orgType: "hq", description: "全平台設定、建站、授權與帳號管理",
    permissions: P("site.view site.edit site.settings site.create rate.publish dashboard.view session.view session.adjust gate.remote_open gate.hold_open incident.handle monthly.manage finance.view refund.request refund.approve settlement.manage device.manage edge.pair user.manage_org org.manage license.manage license.view audit.view platform.admin role.manage") },
  { code: "hq_ops", name: "總部營運", orgType: "hq", description: "所有站點的監控、例外處理、遠端開閘",
    permissions: P("site.view dashboard.view session.view session.adjust gate.remote_open gate.hold_open incident.handle refund.request device.manage license.view audit.view") },
  { code: "hq_support", name: "總部客服", orgType: "hq", description: "對講與客訴處理、遠端開閘",
    permissions: P("site.view session.view gate.remote_open incident.handle refund.request") },
  { code: "hq_finance", name: "總部財務", orgType: "hq", description: "對帳、退款核准、加盟結算",
    permissions: P("site.view dashboard.view session.view finance.view refund.approve settlement.manage license.view audit.view") },
  { code: "operator_admin", name: "自營站點管理員", orgType: "operator", description: "自己站點的設定、報表、遠端開閘",
    permissions: P("site.view site.edit site.settings dashboard.view session.view session.adjust gate.remote_open incident.handle monthly.manage finance.view refund.request user.manage_org license.view audit.view role.manage") },
  { code: "operator_staff", name: "自營現場人員", orgType: "operator", description: "自己站點的例外處理、遠端開閘",
    permissions: P("site.view session.view gate.remote_open incident.handle") },
  { code: "franchisee_owner", name: "加盟主", orgType: "franchisee", description: "自己站點的報表、帳號、遠端開閘",
    permissions: P("site.view site.edit dashboard.view session.view gate.remote_open incident.handle monthly.manage finance.view refund.request user.manage_org license.view audit.view role.manage") },
  { code: "franchisee_staff", name: "加盟現場人員", orgType: "franchisee", description: "自己站點的例外處理、遠端開閘",
    permissions: P("site.view session.view gate.remote_open incident.handle") },
  { code: "licensee_admin", name: "系統客戶管理員", orgType: "licensee", description: "自己站點的設定、費率、報表、帳號、遠端開閘",
    permissions: P("site.view site.edit site.settings rate.publish dashboard.view session.view session.adjust gate.remote_open incident.handle monthly.manage finance.view refund.request refund.approve device.manage user.manage_org license.view audit.view role.manage") },
  { code: "licensee_staff", name: "系統客戶現場人員", orgType: "licensee", description: "自己站點的例外處理、遠端開閘",
    permissions: P("site.view session.view gate.remote_open incident.handle") },
];

// 自訂角色存在共用記憶體（Mock）；正式版從資料庫 roles WHERE org_id IS NOT NULL 讀取
const registry = globalThis as unknown as { __pdCustomRoles?: Role[] };
registry.__pdCustomRoles ??= [];
export const customRoles = (): Role[] => registry.__pdCustomRoles!;
export const allRoles = (): Role[] => [...ROLES, ...customRoles()];

const UNKNOWN_ROLE = (code: string): Role => ({ code, name: "（已刪除的角色）", orgType: "hq", description: "", permissions: [] });
export const roleByCode = (code: RoleCode): Role => allRoles().find((r) => r.code === code) ?? UNKNOWN_ROLE(code);
export const isCustomRole = (r: Role) => !!r.orgId;

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
  const candidates = allRoles().filter((r) => r.orgType === org.type && !r.archivedAt && (!r.orgId || r.orgId === org.id));
  if (can(granter, "platform.admin")) return candidates;
  const mine = granter.bindings.filter((b) => b.orgId === org.id);
  if (!mine.some((b) => roleByCode(b.role).permissions.includes("user.manage_org"))) return [];
  const myPerms = new Set(mine.flatMap((b) => roleByCode(b.role).permissions));
  return candidates.filter((r) => r.permissions.every((p) => myPerms.has(p)));
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
  const role = allRoles().find((r) => r.code === target.role);
  if (!role) return "角色不存在。";
  if (role.archivedAt) return `「${role.name}」已封存，不能再指派。`;
  if (role.orgId && role.orgId !== org.id) return `「${role.name}」是其他組織的自訂角色。`;
  if (role.orgType !== org.type) return `「${role.name}」不屬於${ORG_TYPE_LABELS[org.type]}的角色。`;
  if (target.siteId && target.siteOrgId !== org.id) return "這個站點不屬於該組織。";
  if (!grantableRoles(granter, org).some((r) => r.code === role.code)) return "不能指派比自己權限大的角色，或你沒有管理這個組織帳號的權限。";
  const scope = grantableSiteScope(granter, org.id);
  if (scope && (!target.siteId || !scope.includes(target.siteId))) return "你只能為自己負責的站點建立帳號。";
  return null;
}

// ---------- 自訂角色（與 0003 的 guard_role_write、guard_role_permission_write 規則相同） ----------

/** 是否能管理某組織的自訂角色：需要「全組織」的 role.manage（只管單一站點的主管不行） */
export function canManageRoles(user: Principal, orgId: string): boolean {
  if (can(user, "platform.admin")) return true;
  return user.bindings.some((b) => b.orgId === orgId && !b.siteId && roleByCode(b.role).permissions.includes("role.manage"));
}

/** 編輯者可以放進某組織自訂角色的權限：自己在該組織有的權限；非總部組織再排除「僅總部」；一律排除平台管理 */
export function assignablePermissions(user: Principal, org: { id: string; type: OrgType }): Set<Permission> {
  const all = Object.keys(PERMISSION_LABELS) as Permission[];
  const held = can(user, "platform.admin")
    ? all
    : user.bindings.filter((b) => b.orgId === org.id).flatMap((b) => roleByCode(b.role).permissions);
  return new Set(held.filter((p) => p !== "platform.admin" && (org.type === "hq" || !HQ_ONLY.includes(p))));
}

/** 角色編輯畫面要顯示的權限：非總部組織不顯示「僅總部」權限；平台管理一律不顯示 */
export function visiblePermissions(orgType: OrgType): Permission[] {
  return (Object.keys(PERMISSION_LABELS) as Permission[]).filter((p) => p !== "platform.admin" && (orgType === "hq" || !HQ_ONLY.includes(p)));
}

export interface RoleDraft { name: string; description: string; permissions: Permission[] }

/**
 * 檢查自訂角色內容；existing 為修改中的角色。
 * 已經在角色裡、但編輯者自己沒有的權限可以保留或移除，不能新增。
 */
export function checkRoleDraft(user: Principal, org: { id: string; type: OrgType }, draft: RoleDraft, existing?: Role): string | null {
  if (!canManageRoles(user, org.id)) return "你沒有管理這個組織角色的權限（需要全組織的「建立與修改自訂角色」）。";
  if (existing && (!existing.orgId || existing.orgId !== org.id)) return "系統預設角色不能修改。";
  if (existing?.archivedAt) return "已封存的角色不能修改。";
  const name = draft.name.trim();
  if (!name || name.length > 20) return "角色名稱需為 1 到 20 個字。";
  if (draft.description.length > 60) return "說明最多 60 個字。";
  if (draft.permissions.length === 0) return "請至少勾選一項權限。";
  const known = new Set(Object.keys(PERMISSION_LABELS));
  if (draft.permissions.some((p) => !known.has(p))) return "權限代碼錯誤。";
  if (draft.permissions.includes("platform.admin")) return "自訂角色不能有平台管理權限。";
  if (org.type !== "hq" && draft.permissions.some((p) => HQ_ONLY.includes(p))) return "「僅總部」權限不能放進這個組織的角色。";
  const allowed = assignablePermissions(user, org);
  const before = new Set(existing?.permissions ?? []);
  const added = draft.permissions.filter((p) => !before.has(p) && !allowed.has(p));
  if (added.length) return `不能加入你自己沒有的權限：${added.map((p) => PERMISSION_LABELS[p]).join("、")}。`;
  const dup = customRoles().find((r) => r.orgId === org.id && !r.archivedAt && r.name === name && r.code !== existing?.code);
  if (dup) return `這個組織已經有名為「${name}」的角色。`;
  if (ROLES.some((r) => r.orgType === org.type && r.name === name)) return `「${name}」與系統預設角色同名，請換一個名稱。`;
  return null;
}
