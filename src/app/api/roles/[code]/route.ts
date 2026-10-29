import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { accounts, auditEntries, organizations } from "@/lib/mock/tenancy";
import { canManageRoles, checkRoleDraft, customRoles, type Permission } from "@/lib/permissions";
import { permissionDiff } from "@/lib/roleAudit";

type Ctx = { params: Promise<{ code: string }> };

const findRole = (code: string) => customRoles().find((r) => r.code === code);
const inUse = (code: string) => accounts.filter((a) => a.bindings.some((b) => b.role === code)).length;

// 修改自訂角色。系統預設角色不能修改；已在角色裡、但修改者自己沒有的權限，可以移除、不能新增。
// 修改立即影響所有使用這個角色的帳號。
export async function PUT(req: Request, { params }: Ctx) {
  const { code } = await params;
  const user = await getCurrentUser();
  const role = findRole(code);
  if (!role) return NextResponse.json({ error: "not_found", message: "找不到這個自訂角色；系統預設角色不能修改。" }, { status: 404 });
  const org = organizations.find((o) => o.id === role.orgId)!;
  if (!canManageRoles(user, org.id)) return NextResponse.json({ error: "forbidden", message: "你沒有管理這個組織角色的權限。" }, { status: 403 });

  let b: { name?: string; description?: string; permissions?: Permission[] };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const draft = { name: (b.name ?? "").trim(), description: (b.description ?? "").trim(), permissions: [...new Set(b.permissions ?? [])] };
  const problem = checkRoleDraft(user, org, draft, role);
  if (problem) return NextResponse.json({ error: "forbidden", message: problem }, { status: 422 });

  const diff = permissionDiff(role.permissions, draft.permissions);
  const renamed = role.name !== draft.name ? `（原名 ${role.name}）` : "";
  Object.assign(role, { name: draft.name, description: draft.description, permissions: draft.permissions, updatedAt: new Date().toISOString() });
  auditEntries.unshift({ at: role.updatedAt!, actor: user.name, action: "修改角色", orgId: org.id, target: `${role.name}${renamed}：${diff}` });
  return NextResponse.json({ ok: true, mock: true });
}

// 封存（不刪除，保留稽核紀錄可追溯）。還有帳號在用時拒絕。
export async function DELETE(_req: Request, { params }: Ctx) {
  const { code } = await params;
  const user = await getCurrentUser();
  const role = findRole(code);
  if (!role || role.archivedAt) return NextResponse.json({ error: "not_found", message: "找不到這個自訂角色。" }, { status: 404 });
  if (!canManageRoles(user, role.orgId!)) return NextResponse.json({ error: "forbidden", message: "你沒有管理這個組織角色的權限。" }, { status: 403 });
  const n = inUse(code);
  if (n > 0) return NextResponse.json({ error: "in_use", message: `還有 ${n} 個帳號使用這個角色，請先改派其他角色再封存。` }, { status: 409 });
  role.archivedAt = new Date().toISOString();
  auditEntries.unshift({ at: role.archivedAt, actor: user.name, action: "封存角色", orgId: role.orgId!, target: role.name });
  return NextResponse.json({ ok: true, mock: true });
}
