-- ParkDodo V2 Migration 0004：工控機（Edge）與雲端連線
-- 前提：已執行 0001–0003
--
-- 1. 配對：總部在後台產生 10 分鐘有效、只能用一次的配對碼；現場 Edge 輸入後取得自己的裝置金鑰。
--    資料庫只存金鑰的 SHA-256，不存明碼。同一站點配對新的工控機時，舊的自動停用（retired）。
-- 2. 事件：Edge 每筆事件帶唯一 event_uid，重送不會重複（device_events.event_uid 已是 UNIQUE）。
-- 3. 照片：只存放位置與雜湊，檔案本身放在雲端儲存空間。

BEGIN;

ALTER TABLE edge_gateways ALTER COLUMN auth_key_ref DROP NOT NULL;
ALTER TABLE edge_gateways
  ADD COLUMN key_hash        TEXT UNIQUE,                 -- 裝置金鑰 SHA-256（hex）
  ADD COLUMN paired_at       TIMESTAMPTZ,
  ADD COLUMN retired_at      TIMESTAMPTZ,
  ADD COLUMN last_ip         INET,
  ADD COLUMN last_status     JSONB NOT NULL DEFAULT '{}', -- 最近一次心跳：設備狀態、佇列長度、磁碟
  ADD COLUMN config_version  BIGINT NOT NULL DEFAULT 1;   -- 雲端設定（費率、白名單、車道）變更時 +1

-- 同一站點同時只能有一台使用中的工控機
CREATE UNIQUE INDEX uq_edge_active_site ON edge_gateways(site_id) WHERE status <> 'retired';

CREATE TABLE edge_pairing_codes (
  code_hash     TEXT PRIMARY KEY,                    -- 6 位數配對碼的 SHA-256
  site_id       UUID NOT NULL REFERENCES sites(id),
  edge_name     TEXT NOT NULL,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  used_by       UUID REFERENCES edge_gateways(id),
  attempts      INT NOT NULL DEFAULT 0,
  CHECK (expires_at > created_at)
);
CREATE INDEX ix_pairing_site ON edge_pairing_codes(site_id) WHERE used_at IS NULL;

CREATE TABLE event_images (
  id            BIGSERIAL PRIMARY KEY,
  event_uid     TEXT NOT NULL REFERENCES device_events(event_uid),
  kind          TEXT NOT NULL CHECK (kind IN ('plate', 'full')),
  storage_path  TEXT NOT NULL,                       -- gs://bucket/path 或 local:path
  bytes         INT NOT NULL CHECK (bytes > 0),
  sha256        TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_uid, kind)
);

-- 費率、車道、設備變更時通知 Edge 重新下載設定
CREATE OR REPLACE FUNCTION bump_edge_config() RETURNS trigger AS $$
DECLARE v_site UUID;
BEGIN
  v_site := COALESCE(NEW.site_id, OLD.site_id);
  UPDATE edge_gateways SET config_version = config_version + 1 WHERE site_id = v_site AND status <> 'retired';
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_edge_cfg_rates AFTER INSERT OR UPDATE OR DELETE ON fee_rate_versions
  FOR EACH ROW EXECUTE FUNCTION bump_edge_config();
CREATE TRIGGER trg_edge_cfg_lanes AFTER INSERT OR UPDATE OR DELETE ON lanes
  FOR EACH ROW EXECUTE FUNCTION bump_edge_config();
CREATE TRIGGER trg_edge_cfg_devices AFTER INSERT OR UPDATE OF lane_id, connection, ip_address, rs485_address OR DELETE ON devices
  FOR EACH ROW EXECUTE FUNCTION bump_edge_config();
CREATE TRIGGER trg_edge_cfg_exit_auth AFTER INSERT OR UPDATE OF status, valid_until ON exit_authorizations
  FOR EACH ROW EXECUTE FUNCTION bump_edge_config();

COMMIT;
