// npm run test:roles — 自訂角色規則（與 db/migrations/0003 相同）
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assignablePermissions, can, canManageRoles, checkGrant, checkRoleDraft, customRoles, grantableRoles, type Principal, type Role,
} from "../../src/lib/permissions";

const HQ = { id: "org-hq", type: "hq" as const };
const A = { id: "org-a", type: "licensee" as const };
const B = { id: "org-b", type: "licensee" as const };

const hq: Principal = { id: "u-hq", name: "總部", isHq: true, bindings: [{ orgId: HQ.id, role: "hq_admin" }] };
const aAdmin: Principal = { id: "u-a", name: "A 管理員", isHq: false, bindings: [{ orgId: A.id, role: "licensee_admin" }] };
const aSite: Principal = { id: "u-as", name: "A 站主管", isHq: false, bindings: [{ orgId: A.id, role: "licensee_admin", siteId: "s1" }] };
const aStaff: Principal = { id: "u-st", name: "A 現場", isHq: false, bindings: [{ orgId: A.id, role: "licensee_staff" }] };

const night: Role = { code: "c_test_night", name: "夜班", orgType: "licensee", orgId: A.id, description: "",
  permissions: ["site.view", "session.view", "gate.remote_open", "session.adjust"] };
const deputy: Role = { code: "c_test_deputy", name: "副管理員", orgType: "licensee", orgId: A.id, description: "",
  permissions: ["site.view", "user.manage_org", "role.manage", "gate.remote_open", "incident.handle"] };
customRoles().push(night, deputy);
const aDeputy: Principal = { id: "u-d", name: "副管理員", isHq: false, bindings: [{ orgId: A.id, role: deputy.code }] };

const draft = (permissions: Role["permissions"], name = "新角色") => ({ name, description: "", permissions });

test("誰能管理角色：全組織 role.manage 或總部；站主管與現場人員不行", () => {
  assert.equal(canManageRoles(hq, A.id), true);
  assert.equal(canManageRoles(aAdmin, A.id), true);
  assert.equal(canManageRoles(aAdmin, B.id), false);
  assert.equal(canManageRoles(aSite, A.id), false);
  assert.equal(canManageRoles(aStaff, A.id), false);
});

test("只能放自己有的權限；「僅總部」與平台管理永遠不能放", () => {
  assert.equal(checkRoleDraft(aAdmin, A, draft(["site.view", "refund.approve"])), null);
  assert.match(checkRoleDraft(aDeputy, A, draft(["refund.approve"]))!, /自己沒有的權限/);
  assert.match(checkRoleDraft(hq, A, draft(["site.create"]))!, /僅總部/);
  assert.match(checkRoleDraft(hq, HQ, draft(["platform.admin"]))!, /平台管理/);
  assert.equal(checkRoleDraft(hq, HQ, draft(["license.manage"])), null); // 總部自己的角色可以有僅總部權限
  assert.ok(!assignablePermissions(hq, A).has("edge.pair"));
  assert.ok(!assignablePermissions(hq, HQ).has("platform.admin"));
});

test("名稱：必填、不能與同組織或系統角色重複；至少一項權限", () => {
  assert.match(checkRoleDraft(aAdmin, A, draft(["site.view"], " "))!, /名稱/);
  assert.match(checkRoleDraft(aAdmin, A, draft(["site.view"], "夜班"))!, /已經有/);
  assert.match(checkRoleDraft(aAdmin, A, draft(["site.view"], "系統客戶現場人員"))!, /系統預設角色同名/);
  assert.equal(checkRoleDraft(aAdmin, A, draft(["site.view"], "夜班"), night), null); // 改自己不算重複
  assert.match(checkRoleDraft(aAdmin, A, draft([]))!, /至少/);
});

test("修改：原本就有、但自己沒有的權限可以保留或移除，不能新增", () => {
  const withRefund: Role = { ...night, code: "c_test_refund", name: "會計", permissions: ["site.view", "refund.approve"] };
  customRoles().push(withRefund);
  assert.equal(checkRoleDraft(aDeputy, A, draft(["site.view", "refund.approve"], "會計"), withRefund), null);
  assert.equal(checkRoleDraft(aDeputy, A, draft(["site.view"], "會計"), withRefund), null);
  assert.match(checkRoleDraft(aDeputy, A, draft(["site.view", "monthly.manage"], "會計"), withRefund)!, /自己沒有/);
});

test("系統角色與其他組織的角色不能修改", () => {
  const sys: Role = { code: "licensee_staff", name: "x", orgType: "licensee", description: "", permissions: ["site.view"] };
  assert.match(checkRoleDraft(aAdmin, A, draft(["site.view"], "改名"), sys)!, /系統預設角色/);
  assert.match(checkRoleDraft(aAdmin, B, draft(["site.view"]))!, /沒有管理/);
});

test("指派：自訂角色出現在可指派清單，只限所屬組織；權限照樣不能超過自己", () => {
  assert.ok(grantableRoles(aAdmin, A).some((r) => r.code === night.code));
  assert.ok(!grantableRoles(hq, B).some((r) => r.code === night.code));
  assert.ok(!grantableRoles(aDeputy, A).some((r) => r.code === night.code)); // 夜班有人工補登，副管理員沒有
  assert.match(checkGrant(hq, B, { role: night.code })!, /其他組織/);
  assert.equal(checkGrant(aAdmin, A, { role: night.code, siteId: "s1", siteOrgId: A.id }), null);
});

test("封存的角色不能再指派", () => {
  const old: Role = { ...night, code: "c_test_old", name: "舊角色", archivedAt: "2026-10-29T00:00:00Z" };
  customRoles().push(old);
  assert.match(checkGrant(aAdmin, A, { role: old.code })!, /已封存/);
  assert.ok(!grantableRoles(aAdmin, A).some((r) => r.code === old.code));
});

test("can() 認得自訂角色，且尊重站點範圍", () => {
  const p: Principal = { id: "u-n", name: "夜班", isHq: false, bindings: [{ orgId: A.id, role: night.code, siteId: "s2" }] };
  assert.equal(can(p, "gate.remote_open", { orgId: A.id, siteId: "s2" }), true);
  assert.equal(can(p, "gate.remote_open", { orgId: A.id, siteId: "s1" }), false);
  assert.equal(can(p, "rate.publish"), false);
});
