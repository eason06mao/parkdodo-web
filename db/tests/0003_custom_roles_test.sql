-- ParkDodo V2 Migration 0003 測試：自訂角色
-- 用法：在空的測試資料庫依序執行 0001、0002、0003，再執行本檔（不依賴 0002 測試的資料）。
\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.expect_fail(label TEXT, stmt TEXT) RETURNS void AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS  %  (rejected: %)', label, SQLERRM;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL  %  (statement was accepted)', label;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.expect_ok(label TEXT, stmt TEXT) RETURNS void AS $$
BEGIN
  EXECUTE stmt;
  RAISE NOTICE 'PASS  %  (accepted)', label;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_user TEXT, p_is_hq BOOLEAN, p_orgs TEXT) RETURNS void AS $$
BEGIN
  PERFORM set_config('app.context', 'request', true);
  PERFORM set_config('app.user_id', p_user, true);
  PERFORM set_config('app.is_hq', CASE WHEN p_is_hq THEN 'true' ELSE 'false' END, true);
  PERFORM set_config('app.org_ids', p_orgs, true);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.seed_mode() RETURNS void AS $$
BEGIN
  PERFORM set_config('app.context', '', true);
END;
$$ LANGUAGE plpgsql;

-- ---------- 種子資料 ----------
INSERT INTO organizations (id, org_type, name) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'hq', '總部');
INSERT INTO organizations (id, org_type, parent_org_id, name) VALUES
  ('a0000000-0000-0000-0000-000000000002', 'licensee', 'a0000000-0000-0000-0000-000000000001', '客戶 A'),
  ('a0000000-0000-0000-0000-000000000003', 'licensee', 'a0000000-0000-0000-0000-000000000001', '客戶 B');
INSERT INTO sites (id, org_id, code, name, operation_type, collection_mode, address) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'TXG301', 'A 一號站', 'licensed', 'own_merchant', '台中市'),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'TXG302', 'A 二號站', 'licensed', 'own_merchant', '台中市');

INSERT INTO users (id, email, display_name) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'r-hq@example.com',     '總部管理員'),
  ('b0000000-0000-0000-0000-000000000002', 'r-a-admin@example.com', 'A 管理員'),
  ('b0000000-0000-0000-0000-000000000003', 'r-a-staff@example.com', 'A 現場'),
  ('b0000000-0000-0000-0000-000000000004', 'r-a-site@example.com',  'A 一號站主管'),
  ('b0000000-0000-0000-0000-000000000005', 'r-a-new@example.com',   'A 新人'),
  ('b0000000-0000-0000-0000-000000000006', 'r-b-admin@example.com', 'B 管理員'),
  ('b0000000-0000-0000-0000-000000000007', 'r-b-new@example.com',   'B 新人');

INSERT INTO user_role_bindings (user_id, org_id, role_code) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'hq_admin');
INSERT INTO user_role_bindings (user_id, org_id, role_code, granted_by) VALUES
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'licensee_admin', 'b0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'licensee_staff', 'b0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000003', 'licensee_admin', 'b0000000-0000-0000-0000-000000000001');
INSERT INTO user_role_bindings (user_id, org_id, role_code, site_id, granted_by) VALUES
  ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000002', 'licensee_admin', 'c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001');

-- ---------- 角色本身 ----------
SELECT pg_temp.act_as('b0000000-0000-0000-0000-000000000002', false, 'a0000000-0000-0000-0000-000000000002');

SELECT pg_temp.expect_fail('不能修改系統預設角色',
  $q$UPDATE roles SET name = '改名' WHERE code = 'licensee_staff'$q$);
SELECT pg_temp.expect_fail('不能改系統預設角色的權限',
  $q$INSERT INTO role_permissions VALUES ('licensee_staff', 'refund.approve')$q$);
SELECT pg_temp.expect_fail('自訂角色類型要與組織一致',
  $q$INSERT INTO roles (code, name, org_type, org_id, is_system, created_by)
     VALUES ('c_bad_type', '錯誤類型', 'franchisee', 'a0000000-0000-0000-0000-000000000002', false, 'b0000000-0000-0000-0000-000000000002')$q$);
SELECT pg_temp.expect_fail('不能替別的組織建立角色',
  $q$INSERT INTO roles (code, name, org_type, org_id, is_system, created_by)
     VALUES ('c_b_role', 'B 的角色', 'licensee', 'a0000000-0000-0000-0000-000000000003', false, 'b0000000-0000-0000-0000-000000000002')$q$);

SELECT pg_temp.expect_ok('客戶管理員建立自訂角色「夜班值班」',
  $q$INSERT INTO roles (code, name, org_type, org_id, is_system, created_by)
     VALUES ('c_night', '夜班值班', 'licensee', 'a0000000-0000-0000-0000-000000000002', false, 'b0000000-0000-0000-0000-000000000002')$q$);
SELECT pg_temp.expect_fail('同組織角色名稱不能重複',
  $q$INSERT INTO roles (code, name, org_type, org_id, is_system, created_by)
     VALUES ('c_night2', '夜班值班', 'licensee', 'a0000000-0000-0000-0000-000000000002', false, 'b0000000-0000-0000-0000-000000000002')$q$);
SELECT pg_temp.expect_ok('逐項開放：檢視、例外處理、遠端開閘、人工補登',
  $q$INSERT INTO role_permissions VALUES ('c_night', 'site.view'), ('c_night', 'incident.handle'),
                                          ('c_night', 'gate.remote_open'), ('c_night', 'session.adjust')$q$);
SELECT pg_temp.expect_fail('「僅總部」權限不能放進自訂角色',
  $q$INSERT INTO role_permissions VALUES ('c_night', 'site.create')$q$);
SELECT pg_temp.expect_fail('不能改角色所屬組織',
  $q$UPDATE roles SET org_id = 'a0000000-0000-0000-0000-000000000003' WHERE code = 'c_night'$q$);

-- 現場人員沒有 role.manage
SELECT pg_temp.act_as('b0000000-0000-0000-0000-000000000003', false, 'a0000000-0000-0000-0000-000000000002');
SELECT pg_temp.expect_fail('現場人員不能建立角色',
  $q$INSERT INTO roles (code, name, org_type, org_id, is_system, created_by)
     VALUES ('c_staff_made', '現場自建', 'licensee', 'a0000000-0000-0000-0000-000000000002', false, 'b0000000-0000-0000-0000-000000000003')$q$);
SELECT pg_temp.expect_fail('現場人員不能修改角色權限',
  $q$INSERT INTO role_permissions VALUES ('c_night', 'refund.approve')$q$);

-- 只管一號站的主管：有 role.manage 但不是全組織
SELECT pg_temp.act_as('b0000000-0000-0000-0000-000000000004', false, 'a0000000-0000-0000-0000-000000000002');
SELECT pg_temp.expect_fail('只管單一站點的主管不能管理角色',
  $q$INSERT INTO roles (code, name, org_type, org_id, is_system, created_by)
     VALUES ('c_site_made', '站主管自建', 'licensee', 'a0000000-0000-0000-0000-000000000002', false, 'b0000000-0000-0000-0000-000000000004')$q$);

-- 角色管理員本身權限不足時不能放進去：先建立一個「會管角色但不能退款」的自訂角色
SELECT pg_temp.act_as('b0000000-0000-0000-0000-000000000002', false, 'a0000000-0000-0000-0000-000000000002');
SELECT pg_temp.expect_ok('建立「副管理員」：可管角色與帳號，但不能核准退款',
  $q$INSERT INTO roles (code, name, org_type, org_id, is_system, created_by)
     VALUES ('c_deputy', '副管理員', 'licensee', 'a0000000-0000-0000-0000-000000000002', false, 'b0000000-0000-0000-0000-000000000002');
     INSERT INTO role_permissions VALUES ('c_deputy', 'role.manage'), ('c_deputy', 'user.manage_org'),
       ('c_deputy', 'site.view'), ('c_deputy', 'incident.handle'), ('c_deputy', 'gate.remote_open'), ('c_deputy', 'session.adjust')$q$);
SELECT pg_temp.expect_ok('指派「副管理員」給新人（全組織）',
  $q$INSERT INTO user_role_bindings (user_id, org_id, role_code, granted_by)
     VALUES ('b0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000002', 'c_deputy', 'b0000000-0000-0000-0000-000000000002')$q$);

SELECT pg_temp.act_as('b0000000-0000-0000-0000-000000000005', false, 'a0000000-0000-0000-0000-000000000002');
SELECT pg_temp.expect_fail('副管理員不能把自己沒有的權限（核准退款）放進角色',
  $q$INSERT INTO role_permissions VALUES ('c_night', 'refund.approve')$q$);
SELECT pg_temp.expect_ok('副管理員可以移除角色裡的權限',
  $q$DELETE FROM role_permissions WHERE role_code = 'c_night' AND permission_code = 'session.adjust'$q$);
SELECT pg_temp.expect_fail('副管理員不能用 UPDATE 把權限換成自己沒有的',
  $q$UPDATE role_permissions SET permission_code = 'refund.approve' WHERE role_code = 'c_night' AND permission_code = 'site.view'$q$);

-- ---------- 指派 ----------
SELECT pg_temp.act_as('b0000000-0000-0000-0000-000000000006', false, 'a0000000-0000-0000-0000-000000000003');
SELECT pg_temp.expect_fail('自訂角色不能指派給別的組織',
  $q$INSERT INTO user_role_bindings (user_id, org_id, role_code, granted_by)
     VALUES ('b0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000003', 'c_night', 'b0000000-0000-0000-0000-000000000006')$q$);
SELECT pg_temp.expect_fail('不能修改別的組織的角色',
  $q$INSERT INTO role_permissions VALUES ('c_night', 'monthly.manage')$q$);

SELECT pg_temp.act_as('b0000000-0000-0000-0000-000000000002', false, 'a0000000-0000-0000-0000-000000000002');
SELECT pg_temp.expect_ok('自訂角色可限定站點（夜班只管二號站）',
  $q$INSERT INTO user_role_bindings (user_id, org_id, role_code, site_id, granted_by)
     VALUES ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'c_night',
             'c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002')$q$);

-- 只管一號站的主管，指派自訂角色時一樣只能指派一號站
SELECT pg_temp.act_as('b0000000-0000-0000-0000-000000000004', false, 'a0000000-0000-0000-0000-000000000002');
SELECT pg_temp.expect_fail('站主管不能把自訂角色指派到二號站',
  $q$INSERT INTO user_role_bindings (user_id, org_id, role_code, site_id, granted_by)
     VALUES ('b0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000002', 'c_night',
             'c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000004')$q$);

-- 副管理員不能指派比自己大的系統角色（沿用 0002 規則）
SELECT pg_temp.act_as('b0000000-0000-0000-0000-000000000005', false, 'a0000000-0000-0000-0000-000000000002');
SELECT pg_temp.expect_fail('副管理員不能指派「系統客戶管理員」',
  $q$INSERT INTO user_role_bindings (user_id, org_id, role_code, granted_by)
     VALUES ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'licensee_admin', 'b0000000-0000-0000-0000-000000000005')$q$);

-- ---------- 封存 ----------
SELECT pg_temp.act_as('b0000000-0000-0000-0000-000000000002', false, 'a0000000-0000-0000-0000-000000000002');
SELECT pg_temp.expect_fail('不能直接刪除角色',
  $q$DELETE FROM roles WHERE code = 'c_night'$q$);
SELECT pg_temp.expect_fail('還有人在用的角色不能封存',
  $q$UPDATE roles SET archived_at = now() WHERE code = 'c_night'$q$);
SELECT pg_temp.expect_ok('收回指派後可以封存',
  $q$UPDATE user_role_bindings SET revoked_at = now() WHERE role_code = 'c_night';
     UPDATE roles SET archived_at = now() WHERE code = 'c_night'$q$);
SELECT pg_temp.expect_fail('封存的角色不能再指派',
  $q$INSERT INTO user_role_bindings (user_id, org_id, role_code, granted_by)
     VALUES ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'c_night', 'b0000000-0000-0000-0000-000000000002')$q$);
SELECT pg_temp.expect_fail('封存的角色不能改權限',
  $q$INSERT INTO role_permissions VALUES ('c_night', 'monthly.manage')$q$);
SELECT pg_temp.expect_ok('封存後同名可以重建',
  $q$INSERT INTO roles (code, name, org_type, org_id, is_system, created_by)
     VALUES ('c_night_v2', '夜班值班', 'licensee', 'a0000000-0000-0000-0000-000000000002', false, 'b0000000-0000-0000-0000-000000000002')$q$);

-- ---------- 總部 ----------
SELECT pg_temp.act_as('b0000000-0000-0000-0000-000000000001', true, '');
SELECT pg_temp.expect_ok('總部可替客戶 B 建立角色',
  $q$INSERT INTO roles (code, name, org_type, org_id, is_system, created_by)
     VALUES ('c_b_cashier', '收費查詢', 'licensee', 'a0000000-0000-0000-0000-000000000003', false, 'b0000000-0000-0000-0000-000000000001');
     INSERT INTO role_permissions VALUES ('c_b_cashier', 'finance.view')$q$);
SELECT pg_temp.expect_fail('總部也不能把「僅總部」權限放進客戶角色',
  $q$INSERT INTO role_permissions VALUES ('c_b_cashier', 'license.manage')$q$);

SELECT pg_temp.expect_ok('總部建立自訂的總部角色「稽核專員」',
  $q$INSERT INTO roles (code, name, org_type, org_id, is_system, created_by)
     VALUES ('c_hq_auditor', '稽核專員', 'hq', 'a0000000-0000-0000-0000-000000000001', false, 'b0000000-0000-0000-0000-000000000001');
     INSERT INTO role_permissions VALUES ('c_hq_auditor', 'audit.view'), ('c_hq_auditor', 'license.view')$q$);
SELECT pg_temp.expect_fail('自訂角色不能有平台管理',
  $q$INSERT INTO role_permissions VALUES ('c_hq_auditor', 'platform.admin')$q$);
SELECT pg_temp.seed_mode();
SELECT pg_temp.expect_fail('維運腳本也不能把平台管理放進自訂角色',
  $q$INSERT INTO role_permissions VALUES ('c_hq_auditor', 'platform.admin')$q$);

-- ---------- RLS：客戶 B 看不到客戶 A 的自訂角色 ----------
SELECT pg_temp.seed_mode();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pd_app_test') THEN
    CREATE ROLE pd_app_test NOLOGIN;
  END IF;
END $$;
GRANT SELECT ON roles TO pd_app_test;
SELECT pg_temp.act_as('b0000000-0000-0000-0000-000000000006', false, 'a0000000-0000-0000-0000-000000000003');
SET LOCAL ROLE pd_app_test;
DO $$
DECLARE n_a INT; n_b INT; n_sys INT;
BEGIN
  SELECT count(*) INTO n_a FROM roles WHERE org_id = 'a0000000-0000-0000-0000-000000000002';
  SELECT count(*) INTO n_b FROM roles WHERE org_id = 'a0000000-0000-0000-0000-000000000003';
  SELECT count(*) INTO n_sys FROM roles WHERE org_id IS NULL;
  IF n_a <> 0 THEN RAISE EXCEPTION 'FAIL  RLS：客戶 B 看到客戶 A 的角色 (%)', n_a; END IF;
  IF n_b <> 1 THEN RAISE EXCEPTION 'FAIL  RLS：客戶 B 應看到自己的 1 個角色，實際 %', n_b; END IF;
  IF n_sys = 0 THEN RAISE EXCEPTION 'FAIL  RLS：看不到系統角色'; END IF;
  RAISE NOTICE 'PASS  RLS：只看得到系統角色與自己組織的自訂角色';
END $$;
RESET ROLE;

SELECT 'ALL CUSTOM ROLE TESTS PASSED' AS result;
ROLLBACK;
