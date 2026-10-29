-- 測試站種子資料（可重複執行）：總部、中航站（TXG001）、入口／出口車道、ICE 相機、FK 顯示卡、費率、示範帳號。
-- 只放示範資料；IP 位址請在現場確認後於後台修改。
BEGIN;

INSERT INTO organizations (id, org_type, name, status) VALUES
  ('00000000-0000-4000-8000-000000000001', 'hq', 'ParkDodo 總部', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, email, display_name, status) VALUES
  ('00000000-0000-4000-8000-000000000101', 'hq-admin@example.com', '示範總部管理員', 'active'),
  ('00000000-0000-4000-8000-000000000102', 'ops@example.com',      '示範值班人員',   'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_role_bindings (user_id, org_id, role_code)
SELECT u, '00000000-0000-4000-8000-000000000001', r FROM (VALUES
  ('00000000-0000-4000-8000-000000000101'::uuid, 'hq_admin'),
  ('00000000-0000-4000-8000-000000000102'::uuid, 'hq_ops')) AS t(u, r)
WHERE NOT EXISTS (SELECT 1 FROM user_role_bindings b WHERE b.user_id = t.u AND b.role_code = t.r AND b.revoked_at IS NULL);

INSERT INTO sites (id, org_id, code, name, operation_type, collection_mode, address, city, district, total_spaces, status) VALUES
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000001', 'TXG001', '中航站',
   'hq_owned', 'hq_collect', '台中市沙鹿區（示範地址）', '台中市', '沙鹿區', 52, 'trial')
ON CONFLICT (id) DO NOTHING;

INSERT INTO lanes (id, site_id, code, direction) VALUES
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000201', 'IN-1',  'entry'),
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000201', 'OUT-1', 'exit')
ON CONFLICT (id) DO NOTHING;

-- 柵欄由相機繼電器（IO1）控制；雷達「已通過」接相機 IO 輸入 1；FK 顯示卡接相機 RS-485（地址 100）
INSERT INTO devices (id, site_id, lane_id, device_type, vendor, model, ip_address, rs485_address, connection, capabilities) VALUES
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000301',
   'lpr_camera', 'ICE', '車牌辨識攝影機', '192.168.1.100', NULL, '{"gate_relay":0,"pass_io_input":1}', '{open_gate,io_input,rs485_passthrough}'),
  ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000301',
   'led_voice_card', 'FK', '顯示語音卡', NULL, 100, '{"via_camera_485":true}', '{text,voice}'),
  ('00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000302',
   'lpr_camera', 'ICE', '車牌辨識攝影機', '192.168.1.101', NULL, '{"gate_relay":0,"pass_io_input":1}', '{open_gate,io_input,rs485_passthrough}'),
  ('00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000302',
   'led_voice_card', 'FK', '顯示語音卡', NULL, 100, '{"via_camera_485":true}', '{text,voice,qr}')
ON CONFLICT (id) DO NOTHING;

-- 費率（與 src/lib/billing/fee.ts 的 DEFAULT_PLAN 相同）
INSERT INTO fee_rate_versions (id, site_id, version_no, rules, effective_from, approved_by) VALUES
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000201', 1,
   '{"base":{"freeMinutes":10,"unitMinutes":30,"unitPrice":30,"precision":"minute","dailyCap":null,"capWindow":"calendar_day","exitGraceMinutes":15,"promoMode":"entry_time","overstayMode":"recalc_from_entry"},"promotions":[]}',
   '2026-10-01T00:00:00+08:00', '00000000-0000-4000-8000-000000000101')
ON CONFLICT (id) DO NOTHING;

COMMIT;
