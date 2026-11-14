-- 正式站基本資料（可重複執行）：公司、總部管理帳號、兩個營運站（車道、相機、顯示卡、費率）。
-- 沒有任何示範車輛或示範帳號。站點 id 與後台目前使用的站點設定相同。
-- 相機 IP、地址、車位數：現場確認後在後台修改。
BEGIN;

INSERT INTO organizations (id, org_type, name, status) VALUES
  ('00000000-0000-4000-8000-000000000001', 'hq', '車格跳動有限公司', 'active')
ON CONFLICT (id) DO NOTHING;
UPDATE organizations SET code = 'org-hq' WHERE id = '00000000-0000-4000-8000-000000000001' AND code IS NULL;

INSERT INTO users (id, email, display_name, status) VALUES
  ('00000000-0000-4000-8000-000000000101', 'service@parkdodo.tw', '總部管理員', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_role_bindings (user_id, org_id, role_code)
SELECT '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'hq_admin'
WHERE NOT EXISTS (SELECT 1 FROM user_role_bindings b WHERE b.user_id = '00000000-0000-4000-8000-000000000101' AND b.role_code = 'hq_admin' AND b.revoked_at IS NULL);

INSERT INTO sites (id, org_id, code, name, operation_type, collection_mode, address, city, district, total_spaces, status,
                   invoice_seller_tax_id, invoice_seller_name) VALUES
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000001', 'TXG001', '台中南屯停車場',
   'hq_owned', 'hq_collect', '臺中市南屯區（地址待補）', '臺中市', '南屯區', 0, 'trial', '61079159', '車格跳動有限公司台中南屯停車場'),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000001', 'TXG002', '台中沙鹿停車場',
   'hq_owned', 'hq_collect', '臺中市沙鹿區（地址待補）', '臺中市', '沙鹿區', 0, 'trial', '61082892', '車格跳動有限公司台中沙鹿停車場')
ON CONFLICT (id) DO NOTHING;

INSERT INTO lanes (id, site_id, code, direction) VALUES
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000201', 'IN-1',  'entry'),
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000201', 'OUT-1', 'exit'),
  ('00000000-0000-4000-8000-000000000311', '00000000-0000-4000-8000-000000000202', 'IN-1',  'entry'),
  ('00000000-0000-4000-8000-000000000312', '00000000-0000-4000-8000-000000000202', 'OUT-1', 'exit')
ON CONFLICT (id) DO NOTHING;

-- 柵欄由相機繼電器（IO1）控制；雷達「已通過」接相機 IO 輸入 1；FK 顯示卡接相機 RS-485（地址 100）。IP 為預設值，現場確認後修改。
INSERT INTO devices (id, site_id, lane_id, device_type, vendor, model, ip_address, rs485_address, connection, capabilities) VALUES
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000301',
   'lpr_camera', 'ICE', '車牌辨識攝影機', '192.168.1.100', NULL, '{"gate_relay":0,"pass_io_input":1}', '{open_gate,io_input,rs485_passthrough}'),
  ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000301',
   'led_voice_card', 'FK', '顯示語音卡', NULL, 100, '{"via_camera_485":true}', '{text,voice}'),
  ('00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000302',
   'lpr_camera', 'ICE', '車牌辨識攝影機', '192.168.1.101', NULL, '{"gate_relay":0,"pass_io_input":1}', '{open_gate,io_input,rs485_passthrough}'),
  ('00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000302',
   'led_voice_card', 'FK', '顯示語音卡', NULL, 100, '{"via_camera_485":true}', '{text,voice,qr}'),
  ('00000000-0000-4000-8000-000000000411', '00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000311',
   'lpr_camera', 'ICE', '車牌辨識攝影機', '192.168.1.100', NULL, '{"gate_relay":0,"pass_io_input":1}', '{open_gate,io_input,rs485_passthrough}'),
  ('00000000-0000-4000-8000-000000000412', '00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000311',
   'led_voice_card', 'FK', '顯示語音卡', NULL, 100, '{"via_camera_485":true}', '{text,voice}'),
  ('00000000-0000-4000-8000-000000000413', '00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000312',
   'lpr_camera', 'ICE', '車牌辨識攝影機', '192.168.1.101', NULL, '{"gate_relay":0,"pass_io_input":1}', '{open_gate,io_input,rs485_passthrough}'),
  ('00000000-0000-4000-8000-000000000414', '00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000312',
   'led_voice_card', 'FK', '顯示語音卡', NULL, 100, '{"via_camera_485":true}', '{text,voice,qr}')
ON CONFLICT (id) DO NOTHING;

-- 費率（與 src/lib/billing/fee.ts 的 DEFAULT_PLAN 相同）：免費 10 分鐘，每 30 分鐘 30 元，付款後 15 分鐘內離場
INSERT INTO fee_rate_versions (id, site_id, version_no, rules, effective_from, approved_by) VALUES
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000201', 1,
   '{"base":{"freeMinutes":10,"unitMinutes":30,"unitPrice":30,"precision":"minute","dailyCap":null,"capWindow":"calendar_day","exitGraceMinutes":15,"promoMode":"entry_time","overstayMode":"recalc_from_entry"},"promotions":[]}',
   '2026-11-01T00:00:00+08:00', '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000202', 1,
   '{"base":{"freeMinutes":10,"unitMinutes":30,"unitPrice":30,"precision":"minute","dailyCap":null,"capWindow":"calendar_day","exitGraceMinutes":15,"promoMode":"entry_time","overstayMode":"recalc_from_entry"},"promotions":[]}',
   '2026-11-01T00:00:00+08:00', '00000000-0000-4000-8000-000000000101')
ON CONFLICT (id) DO NOTHING;

COMMIT;
