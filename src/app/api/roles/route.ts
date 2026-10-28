import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { auditEntries, organizations } from "@/lib/mock/tenancy";
import { checkRoleDraft, customRoles, PERMISSION_LABELS, type Permission, type Role } from "@/lib/permissions";

// Mock API：建立自訂角色。規則與資料庫 0003 的 guard_role_write／guard_role_permission_write 相同：
// 需要全組織的 role.manage、只能放自己有的權限、「僅總部」權限不能放進非總部角色、自訂角色不能有平台管理。
export async function POST(req: Request) {
  const user = await getCurrentUser();
  let b: { orgId?: string; name?: string; description?: string; permissions?: Permission[] };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const org = organizations.find((o) => o.id === b.orgId);
  if (!org) return NextResponse.json({ error: "invalid", message: "請選擇組織。" }, { status: 422 });
  const draft = { name: (b.name ?? "").trim(), description: (b.description ?? "").trim(), permissions: [...new Set(b.permissions ?? [])] };
  const problem = checkRoleDraft(user, org, draft);
  if (problem) return NextResponse.json({ error: "forbidden", message: problem }, { status: problem.startsWith("你沒有") ? 403 : 422 });

  const role: Role = {
    code: `c_${Date.now().toString(36)}`, name: draft.name, description: draft.description, orgType: org.type, orgId: org.id,
    permissions: draft.permissions, createdBy: user.name, updatedAt: new Date().toISOString(),
  };
  customRoles().push(role);
  auditEntries.unshift({
    at: role.updatedAt!, actor: user.name, action: "建立角色", orgId: org.id,
    target: `${role.name}：${role.permissions.map((p) => PERMISSION_LABELS[p]).join("、")}`,
  });
  return NextResponse.json({ ok: true, mock: true, code: role.code }, { status: 201 });
}
