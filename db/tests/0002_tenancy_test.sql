-- ParkDodo V2 Migration 0002 測試：建站權限、授權、防越權
-- 用法：在空的測試資料庫依序執行 0001、0002，再執行本檔。
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

-- 模擬一個請求的身分
CREATE OR REPLACE FUNCTION pg_temp.act_as(p_user TEXT, p_is_hq BOOLEAN, p_orgs TEXT) RETURNS void AS $$
BEGIN
  PERFORM set_config('app.context', 'request', true);
  PERFORM set_config('app.user_id', p_user, true);
  PERFORM set_config('app.is_hq', CASE WHEN p_is_hq THEN 'true' ELSE 'false' END, true);
  PERFORM set_config('app.org_ids', p_orgs, true);
END;
$$ LANGUAGE plpgsql;

-- ---------- 種子資料（不在請求中，等同 migration／維運腳本） ----------
INSERT INTO organizations (id, org_type, name) VALUES
  ('10000000-0000-0000-0000-000000000001', 'hq', 'ParkDodo 總部');
INSERT INTO organizations (id, org_type, parent_org_id, name) VALUES
  ('10000000-0000-0000-0000-000000000002', 'licensee', '10000000-0000-0000-0000-000000000001', '系統客戶 A'),
  ('10000000-0000-0000-0000-000000000003', 'licensee', '10000000-0000-0000-0000-000000000001', '系統客戶 B');

INSERT INTO users (id, email, display_name) VALUES
  ('20000000-0000-0000-0000-000000000001', 'hq-admin@example.com', '總部管理員'),
  ('20000000-0000-0000-0000-000000000002', 'a-admin@example.com',  '客戶 A 管理員'),
  ('20000000-0000-0000-0000-000000000003', 'a-staff@example.com',  '客戶 A 現場'),
  ('20000000-0000-0000-0000-000000000004', 'a-new@example.com',    '客戶 A 新人'),
  ('20000000-0000-0000-0000-000000000005', 'a-site1@example.com',  '客戶 A 一號站主管');

-- 第一位總部管理員由種子資料建立（granted_by 為 NULL）
INSERT INTO user_role_bindings (user_id, org_id, role_code) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'hq_admin');

-- ---------- 組織與角色類型 ----------
SELECT pg_temp.expect_fail('系統客戶必須隸屬總部',
  $q$INSERT INTO organizations (org_type, name) VALUES ('licensee', '沒有上層的客戶')$q$);

SELECT pg_temp.expect_fail('「僅總部」權限不能加到客戶角色（site.create）',
  $q$INSERT INTO role_permissions VALUES ('licensee_admin', 'site.create')$q$);

SELECT pg_temp.expect_fail('「僅總部」權限不能加到加盟主角色（license.manage）',
  $q$INSERT INTO role_permissions VALUES ('franchisee_owner', 'license.manage')$q$);

-- ---------- 建站 ----------
SELECT pg_temp.act_as('20000000-0000-0000-0000-000000000002', false, '10000000-0000-0000-0000-000000000002');
SELECT pg_temp.expect_fail('系統客戶不能自己新增站點',
  $q$INSERT INTO sites (org_id, code, name, operation_type, collection_mode, address)
     VALUES ('10000000-0000-0000-0000-000000000002', 'TXG901', '客戶自建站', 'licensed', 'own_merchant', '台中市')$q$);

SELECT pg_temp.act_as('20000000-0000-0000-0000-000000000001', true, '');
SELECT pg_temp.expect_fail('系統客戶站點不能由總部代收款',
  $q$INSERT INTO sites (org_id, code, name, operation_type, collection_mode, address)
     VALUES ('10000000-0000-0000-0000-000000000002', 'TXG902', '錯誤收款站', 'licensed', 'hq_collect', '台中市')$q$);

SELECT pg_temp.expect_ok('總部新增站點並指派給系統客戶 A',
  $q$INSERT INTO sites (id, org_id, code, name, operation_type, collection_mode, address)
     VALUES ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'TXG101', 'A 一號站', 'licensed', 'own_merchant', '台中市'),
            ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'TXG102', 'A 二號站', 'licensed', 'own_merchant', '台中市'),
            ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'TXG201', 'B 一號站', 'licensed', 'own_merchant', '台中市')$q$);

-- ---------- 授權 ----------
SELECT pg_temp.expect_fail('授權的組織必須是站點擁有者',
  $q$INSERT INTO site_licenses (site_id, org_id, license_no, plan, max_lanes, starts_on, ends_on)
     VALUES ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'LIC-X', 'standard', 2, '2026-11-01', '2027-10-31')$q$);

SELECT pg_temp.expect_fail('授權到期日不能早於開始日',
  $q$INSERT INTO site_licenses (site_id, org_id, license_no, plan, max_lanes, starts_on, ends_on)
     VALUES ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'LIC-Y', 'standard', 2, '2026-11-01', '2026-10-01')$q$);

SELECT pg_temp.expect_ok('總部開立 A 一號站授權',
  $q$INSERT INTO site_licenses (site_id, org_id, license_no, plan, max_lanes, starts_on, ends_on, created_by)
     VALUES ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'LIC-2026-0001', 'standard', 2, '2026-11-01', '2027-10-31',
             '20000000-0000-0000-0000-000000000001')$q$);

SELECT pg_temp.expect_fail('同一站點不能同時有兩張有效授權',
  $q$INSERT INTO site_licenses (site_id, org_id, license_no, plan, max_lanes, starts_on, ends_on)
     VALUES ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'LIC-2026-0002', 'pro', 4, '2026-11-01', '2027-10-31')$q$);

-- 總部指派客戶 A 的第一位管理員
SELECT pg_temp.expect_ok('總部指派客戶 A 管理員',
  $q$INSERT INTO user_role_bindings (user_id, org_id, role_code, granted_by)
     VALUES ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'licensee_admin',
             '20000000-0000-0000-0000-000000000001')$q$);
SELECT pg_temp.expect_ok('總部指派客戶 A 一號站主管（只管一號站）',
  $q$INSERT INTO user_role_bindings (user_id, org_id, role_code, site_id, granted_by)
     VALUES ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', 'licensee_admin',
             '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001')$q$);

-- ---------- 客戶 A 管理員的操作 ----------
SELECT pg_temp.act_as('20000000-0000-0000-0000-000000000002', false, '10000000-0000-0000-0000-000000000002');

SELECT pg_temp.expect_ok('客戶可以修改自己站點的名稱',
  $q$UPDATE sites SET name = 'A 一號站（沙鹿）' WHERE id = '30000000-0000-0000-0000-000000000001'$q$);

SELECT pg_temp.expect_fail('客戶不能把站點移轉給別的組織',
  $q$UPDATE sites SET org_id = '10000000-0000-0000-0000-000000000003' WHERE id = '30000000-0000-0000-0000-000000000001'$q$);

SELECT pg_temp.expect_fail('客戶不能自己改收款模式',
  $q$UPDATE sites SET collection_mode = 'hq_collect' WHERE id = '30000000-0000-0000-0000-000000000001'$q$);

SELECT pg_temp.expect_fail('客戶不能延長自己的授權',
  $q$UPDATE site_licenses SET ends_on = '2030-12-31' WHERE license_no = 'LIC-2026-0001'$q$);

SELECT pg_temp.expect_fail('客戶不能拿總部角色',
  $q$INSERT INTO user_role_bindings (user_id, org_id, role_code, granted_by)
     VALUES ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'hq_admin',
             '20000000-0000-0000-0000-000000000002')$q$);

SELECT pg_temp.expect_fail('不能授權給自己',
  $q$INSERT INTO user_role_bindings (user_id, org_id, role_code, granted_by)
     VALUES ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'licensee_staff',
             '20000000-0000-0000-0000-000000000002')$q$);

SELECT pg_temp.expect_fail('不能替別的組織建立帳號',
  $q$INSERT INTO user_role_bindings (user_id, org_id, role_code, granted_by)
     VALUES ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003', 'licensee_staff',
             '20000000-0000-0000-0000-000000000002')$q$);

SELECT pg_temp.expect_fail('限縮的站點必須屬於該組織',
  $q$INSERT INTO user_role_bindings (user_id, org_id, role_code, site_id, granted_by)
     VALUES ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'licensee_staff',
             '30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002')$q$);

SELECT pg_temp.expect_ok('客戶 A 管理員建立一號站現場人員',
  $q$INSERT INTO user_role_bindings (user_id, org_id, role_code, site_id, granted_by)
     VALUES ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'licensee_staff',
             '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002')$q$);

-- ---------- 權限比較小的人 ----------
SELECT pg_temp.act_as('20000000-0000-0000-0000-000000000003', false, '10000000-0000-0000-0000-000000000002');
SELECT pg_temp.expect_fail('現場人員不能建立帳號',
  $q$INSERT INTO user_role_bindings (user_id, org_id, role_code, site_id, granted_by)
     VALUES ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'licensee_staff',
             '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003')$q$);

SELECT pg_temp.act_as('20000000-0000-0000-0000-000000000005', false, '10000000-0000-0000-0000-000000000002');
SELECT pg_temp.expect_fail('只管一號站的主管，不能授權二號站',
  $q$INSERT INTO user_role_bindings (user_id, org_id, role_code, site_id, granted_by)
     VALUES ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'licensee_staff',
             '30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000005')$q$);
SELECT pg_temp.expect_fail('只管一號站的主管，不能授權全組織',
  $q$INSERT INTO user_role_bindings (user_id, org_id, role_code, granted_by)
     VALUES ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'licensee_staff',
             '20000000-0000-0000-0000-000000000005')$q$);

-- 權限子集合：只有「看站點＋管帳號」的人，不能授權權限更大的管理員角色
SELECT set_config('app.context', '', true);
INSERT INTO roles (code, name, org_type) VALUES ('licensee_hr_test', '測試用：只能管帳號', 'licensee');
INSERT INTO role_permissions VALUES ('licensee_hr_test', 'site.view'), ('licensee_hr_test', 'user.manage_org');
INSERT INTO users (id, email, display_name) VALUES ('20000000-0000-0000-0000-000000000006', 'a-hr@example.com', '客戶 A 人資');
INSERT INTO user_role_bindings (user_id, org_id, role_code) VALUES
  ('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000002', 'licensee_hr_test');
SELECT pg_temp.act_as('20000000-0000-0000-0000-000000000006', false, '10000000-0000-0000-0000-000000000002');
SELECT pg_temp.expect_fail('不能授權比自己權限大的角色',
  $q$INSERT INTO user_role_bindings (user_id, org_id, role_code, granted_by)
     VALUES ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'licensee_admin',
             '20000000-0000-0000-0000-000000000006')$q$);

SELECT pg_temp.act_as('20000000-0000-0000-0000-000000000002', false, '10000000-0000-0000-0000-000000000002');
SELECT pg_temp.expect_ok('管理員可以授權同等或較小的角色（現場人員）',
  $q$INSERT INTO user_role_bindings (user_id, org_id, role_code, granted_by)
     VALUES ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'licensee_staff',
             '20000000-0000-0000-0000-000000000002')$q$);

-- ---------- RLS（用非擁有者角色才看得出效果） ----------
SELECT set_config('app.context', '', true);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pd_app_test') THEN
    CREATE ROLE pd_app_test NOLOGIN;
  END IF;
END $$;
GRANT SELECT ON sites, site_licenses, user_role_bindings TO pd_app_test;
SET LOCAL ROLE pd_app_test;
SELECT pg_temp.act_as('20000000-0000-0000-0000-000000000002', false, '10000000-0000-0000-0000-000000000002');
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM sites WHERE org_id = '10000000-0000-0000-0000-000000000003';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL  客戶 A 看得到客戶 B 的站點'; END IF;
  SELECT count(*) INTO n FROM sites;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL  客戶 A 應只看到自己的 2 個站點，實際 %', n; END IF;
  RAISE NOTICE 'PASS  客戶 A 只看得到自己的站點（RLS）';
END $$;
SELECT pg_temp.act_as('20000000-0000-0000-0000-000000000001', true, '');
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM sites;
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL  總部應看到全部 3 個站點，實際 %', n; END IF;
  RAISE NOTICE 'PASS  總部看得到全部站點（RLS）';
END $$;
RESET ROLE;

SELECT 'ALL TENANCY TESTS PASSED' AS result;
ROLLBACK;
