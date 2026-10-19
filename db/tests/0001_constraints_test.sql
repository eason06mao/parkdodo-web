-- ParkDodo V2 Schema 約束測試
-- 用法：在空的測試資料庫先執行 0001_v2_core.sql，再執行本檔。
-- 每個 expect_fail 都必須被資料庫拒絕；有任何一項沒被拒絕，整個測試就失敗。
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

-- ---------- 測試資料 ----------
INSERT INTO organizations (id, org_type, name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'hq', 'ParkDodo 總部');
INSERT INTO organizations (id, org_type, parent_org_id, name) VALUES
  ('00000000-0000-0000-0000-000000000002', 'franchisee', '00000000-0000-0000-0000-000000000001', '加盟主 A');

INSERT INTO franchise_agreements (id, franchisee_org_id, agreement_no, collection_mode, revenue_share_bps, effective_from, status)
VALUES ('00000000-0000-0000-0000-0000000000fa', '00000000-0000-0000-0000-000000000002', 'FA-001', 'hq_collect', 7000, '2026-11-01', 'active');

INSERT INTO sites (id, org_id, code, name, operation_type, franchise_agreement_id, address)
VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000002', 'TPE001', '示範站', 'franchise',
        '00000000-0000-0000-0000-0000000000fa', '台北市');

INSERT INTO fee_rate_versions (id, site_id, version_no, rules, effective_from)
VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 1, '{"per_30min":30}', now());

INSERT INTO parking_sessions (id, site_id, org_id, plate_no, entry_at)
VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-000000000002', 'ABC1234', now() - interval '2 hours');

INSERT INTO parking_fee_quotes (id, session_id, fee_rate_version_id, calculated_until, gross_amount, discount_amount, payable_amount, expires_at)
VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1',
        '00000000-0000-0000-0000-0000000000b1', now(), 120, 20, 100, now() + interval '10 minutes');

INSERT INTO payment_provider_accounts (id, owner_org_id, provider, environment, merchant_no, credentials_ref, status)
VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001', 'mock', 'sandbox', 'MOCK001', 'vault://mock', 'active');

INSERT INTO payment_orders (id, order_no, session_id, site_id, org_id, quote_id, provider_account_id, channel, amount, idempotency_key, expires_at)
VALUES ('00000000-0000-0000-0000-0000000000f1', 'PD0001', '00000000-0000-0000-0000-0000000000c1',
        '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 'pay_web', 100, 'idem-1',
        now() + interval '10 minutes');

-- ---------- 約束測試 ----------
SELECT pg_temp.expect_fail('同車牌同站點不可重複進場',
  $q$INSERT INTO parking_sessions (site_id, org_id, plate_no, entry_at)
     VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000002','ABC1234', now())$q$);

SELECT pg_temp.expect_fail('同一 Session 不可同時有兩張進行中付款訂單（手機＋Kiosk 併發）',
  $q$INSERT INTO payment_orders (order_no, session_id, site_id, org_id, quote_id, provider_account_id, channel, amount, idempotency_key, expires_at)
     VALUES ('PD0002','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1',
             '00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000d1',
             '00000000-0000-0000-0000-0000000000e1','kiosk',100,'idem-2', now() + interval '10 minutes')$q$);

SELECT pg_temp.expect_fail('冪等鍵不可重複',
  $q$INSERT INTO payment_orders (order_no, session_id, site_id, org_id, quote_id, provider_account_id, channel, amount, idempotency_key, expires_at)
     VALUES ('PD0003','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1',
             '00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000d1',
             '00000000-0000-0000-0000-0000000000e1','kiosk',100,'idem-1', now() + interval '10 minutes')$q$);

SELECT pg_temp.expect_fail('非法狀態轉移 created -> refunded',
  $q$UPDATE payment_orders SET status = 'refunded' WHERE id = '00000000-0000-0000-0000-0000000000f1'$q$);

SELECT pg_temp.expect_fail('報價金額必須等於原價減折抵',
  $q$INSERT INTO parking_fee_quotes (session_id, fee_rate_version_id, calculated_until, gross_amount, discount_amount, payable_amount, expires_at)
     VALUES ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b1', now(), 120, 20, 90, now())$q$);

SELECT pg_temp.expect_fail('加盟站點必須綁加盟合約',
  $q$INSERT INTO sites (org_id, code, name, operation_type, address)
     VALUES ('00000000-0000-0000-0000-000000000002','TPE002','無合約站','franchise','台北市')$q$);

INSERT INTO audit_logs (actor_type, actor_id, action) VALUES ('system', 'test', 'test.seed');
SELECT pg_temp.expect_fail('稽核紀錄不可修改',
  $q$UPDATE audit_logs SET reason = 'x'$q$);
SELECT pg_temp.expect_fail('稽核紀錄不可刪除',
  $q$DELETE FROM audit_logs$q$);

-- 合法流程：created -> pending -> paid -> 建立出場授權
UPDATE payment_orders SET status = 'pending' WHERE id = '00000000-0000-0000-0000-0000000000f1';
UPDATE payment_orders SET status = 'paid', paid_at = now() WHERE id = '00000000-0000-0000-0000-0000000000f1';
INSERT INTO exit_authorizations (session_id, site_id, plate_no, source, payment_order_id, valid_until)
VALUES ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1','ABC1234','payment',
        '00000000-0000-0000-0000-0000000000f1', now() + interval '15 minutes');

SELECT pg_temp.expect_fail('同一 Session 不可有兩張有效出場授權',
  $q$INSERT INTO exit_authorizations (session_id, site_id, plate_no, source, valid_until)
     VALUES ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1','ABC1234','manual', now() + interval '5 minutes')$q$);

-- 遠端開閘：原因選「其他」必須填說明
INSERT INTO users (id, email, display_name) VALUES ('00000000-0000-0000-0000-0000000000aa', 'ops@example.com', '值班人員');
INSERT INTO lanes (id, site_id, code, direction) VALUES ('00000000-0000-0000-0000-0000000000ab', '00000000-0000-0000-0000-0000000000a1', 'OUT-1', 'exit');
SELECT pg_temp.expect_fail('遠端開閘原因為 other 時必須填說明',
  $q$INSERT INTO gate_commands (site_id, lane_id, command, reason_code, requested_by, requested_role, idempotency_key, expires_at)
     VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000ab','open_once','other',
             '00000000-0000-0000-0000-0000000000aa','franchisee_staff','g-1', now() + interval '30 seconds')$q$);
INSERT INTO gate_commands (site_id, lane_id, command, reason_code, requested_by, requested_role, idempotency_key, expires_at)
VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000ab','open_once','intercom_request',
        '00000000-0000-0000-0000-0000000000aa','franchisee_staff','g-2', now() + interval '30 seconds');

-- 退款後可再付款：舊訂單已 paid（非進行中），新訂單允許建立
UPDATE payment_orders SET status = 'refunding' WHERE id = '00000000-0000-0000-0000-0000000000f1';

SELECT 'ALL CONSTRAINT TESTS PASSED' AS result;
ROLLBACK;
