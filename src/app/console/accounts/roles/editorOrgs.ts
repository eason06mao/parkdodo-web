import { getOrganizations } from "@/lib/data";
import { assignablePermissions, canManageRoles, ORG_TYPE_LABELS, type Principal } from "@/lib/permissions";
import type { EditorOrg } from "./RoleEditor";

/** 登入者可以管理自訂角色的組織，與各組織可放進角色的權限 */
export async function manageableOrgs(user: Principal): Promise<EditorOrg[]> {
  const orgs = await getOrganizations(user);
  return orgs
    .filter((o) => canManageRoles(user, o.id))
    .map((o) => ({ id: o.id, name: o.name, type: o.type, typeLabel: ORG_TYPE_LABELS[o.type], allowed: [...assignablePermissions(user, o)] }));
}
