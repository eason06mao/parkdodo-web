-- ParkDodo V2 Migration 0006：統一編號 → 營業人名稱（輸入統編時自動帶出公司名稱）
-- 資料來源：財政部財政資訊中心「全國營業(稅籍)登記資料集」（政府資料開放授權條款第 1 版），每日更新，只含營業中的營業人。
-- 由 GitHub Actions 每天匯入（scripts/import-tax-registry.mjs）。只存統編與名稱，不存地址、資本額等其他欄位。
BEGIN;

CREATE TABLE tax_registry (
  tax_id     CHAR(8) PRIMARY KEY CHECK (tax_id ~ '^\d{8}$'),
  name       TEXT NOT NULL,
  synced_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tax_registry_syncs (
  id           BIGSERIAL PRIMARY KEY,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  rows_read    INT,
  rows_upserted INT,
  rows_removed INT,
  source       TEXT NOT NULL,
  error        TEXT
);

COMMIT;
