import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { accounts, auditEntries, organizations, siteRecords } from "@/lib/mock/tenancy";
import { checkGrant, roleByCode, type RoleCode } from "@/lib/permissions";

// Mock API：邀請帳號並指派角色。規則與資料庫 check_role_binding 觸發器相同：
// 角色要屬於該組織類型、站點要屬於該組織、不能授權給自己、不能給出比自己大的權限、只管單站的人只能授權該站。
// 正式版：寄出邀請信（帳號狀態 invited），對方第一次登入時設定密碼與 MFA；全程寫入 audit_logs。
export async function POST(req: Request) {
  const user = await getCurrentUser();
  let b: { name?: string; email?: string; orgId?: string; role?: RoleCode; siteId?: string };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const name = b.name?.trim() ?? "";
  const email = b.email?.trim().toLowerCase() ?? "";
  if (!name) return NextResponse.json({ error: "invalid", message: "請填寫姓名。" }, { status: 422 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "invalid", message: "Email 格式不正確。" }, { status: 422 });

  const org = organizations.find((o) => o.id === b.orgId);
  if (!org || !b.role) return NextResponse.json({ error: "invalid", message: "請選擇組織與角色。" }, { status: 422 });

  const site = b.siteId ? siteRecords.find((s) => s.id === b.siteId) : undefined;
  const existing = accounts.find((a) => a.email === email);
  const problem = checkGrant(user, org, { userId: existing?.id, role: b.role, siteId: b.siteId || undefined, siteOrgId: site?.orgId });
  if (problem) return NextResponse.json({ error: "forbidden", message: problem }, { status: 403 });

  const binding = { orgId: org.id, role: b.role, siteId: site?.id };
  if (existing) existing.bindings.push(binding);
  else accounts.push({ id: `u-${Date.now()}`, name, email, status: "invited", mfa: false, bindings: [binding] });

  auditEntries.unshift({
    at: new Date().toISOString(), actor: user.name, action: existing ? "新增角色" : "邀請帳號",
    target: `${email}・${roleByCode(b.role).name}・${site ? site.name : "全部站點"}`, orgId: org.id,
  });
  return NextResponse.json({ ok: true, mock: true }, { status: 201 });
}
