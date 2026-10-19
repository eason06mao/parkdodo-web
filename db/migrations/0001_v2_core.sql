-- =====================================================================
-- ParkDodo V2 — PostgreSQL 核心資料表 Migration 草案
-- 版本：F_20261012（草案，不得直接在正式環境執行）
-- 對應文件：《ParkDodo V2 總規格 F 版》
--
-- 設計原則
--   1. 多租戶：所有營運資料都帶 org_id（擁有該站點的組織），
--      方便以 Row Level Security 隔離自營商、加盟主的資料。
--   2. 金額一律以「新台幣整數元」存成 BIGINT，不用浮點數。
--   3. 時間一律 TIMESTAMPTZ（以 UTC 儲存，顯示時轉 Asia/Taipei）。
--   4. 狀態欄位用 TEXT + CHECK，方便日後增加狀態而不必改 ENUM。
--   5. 防重複靠資料庫約束（部分唯一索引），不只靠程式判斷。
--   6. 金流、發票、遠通的金鑰不存明文，只存密鑰管理服務的參照。
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- 不分大小寫的 email

-- 共用：自動更新 updated_at
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 1. 組織與多租戶：總部 / 自營商 / 加盟主
-- =====================================================================

CREATE TABLE organizations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_type         TEXT NOT NULL CHECK (org_type IN ('hq', 'operator', 'franchisee')),
                   -- hq=總部、operator=自營商、franchisee=加盟主
  parent_org_id    UUID REFERENCES organizations(id),   -- 加盟主隸屬的總部
  name             TEXT NOT NULL,
  legal_name       TEXT,
  tax_id           TEXT,                                 -- 統一編號
  contact_name     TEXT,
  contact_phone    TEXT,
  contact_email    CITEXT,
  address          TEXT,
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('pending', 'active', 'suspended', 'terminated')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT org_parent_rule CHECK (
    (org_type = 'hq' AND parent_org_id IS NULL) OR org_type <> 'hq'
  )
);
CREATE UNIQUE INDEX uq_org_tax_id ON organizations(tax_id) WHERE tax_id IS NOT NULL;

-- 加盟合約：分潤、權利金、收款模式
CREATE TABLE franchise_agreements (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  franchisee_org_id      UUID NOT NULL REFERENCES organizations(id),
  agreement_no           TEXT NOT NULL UNIQUE,
  collection_mode        TEXT NOT NULL CHECK (collection_mode IN ('hq_collect', 'own_merchant')),
                         -- hq_collect   = 總部統一收款，依分潤撥款給加盟主
                         -- own_merchant = 加盟主自有金流商店，總部收權利金／系統費
  revenue_share_bps      INTEGER CHECK (revenue_share_bps BETWEEN 0 AND 10000),
                         -- 加盟主分潤比例（萬分比，7000 = 70%）；hq_collect 使用
  royalty_bps            INTEGER CHECK (royalty_bps BETWEEN 0 AND 10000),
                         -- 權利金比例；own_merchant 使用
  monthly_system_fee     BIGINT CHECK (monthly_system_fee >= 0),   -- 每站每月系統費（元）
  settlement_cycle       TEXT NOT NULL DEFAULT 'monthly'
                         CHECK (settlement_cycle IN ('weekly', 'biweekly', 'monthly')),
  bank_code              TEXT,
  bank_account_ref       TEXT,      -- 銀行帳號存於加密欄位或密鑰服務，這裡只放參照
  effective_from         DATE NOT NULL,
  effective_to           DATE,
  status                 TEXT NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'active', 'expired', 'terminated')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- =====================================================================
-- 2. 使用者、角色與權限（後台：總部、自營商、加盟主）
-- =====================================================================

CREATE TABLE users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              CITEXT NOT NULL UNIQUE,
  phone              TEXT,
  display_name       TEXT NOT NULL,
  password_hash      TEXT,                 -- argon2id；SSO 帳號可為 NULL
  mfa_secret_ref     TEXT,                 -- 遠端開閘、財務角色強制 MFA
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('invited', 'active', 'locked', 'disabled')),
  last_login_at      TIMESTAMPTZ,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  code         TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  org_type     TEXT NOT NULL CHECK (org_type IN ('hq', 'operator', 'franchisee')),
  description  TEXT
);

CREATE TABLE permissions (
  code         TEXT PRIMARY KEY,           -- 例：gate.remote_open
  description  TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_code        TEXT NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  permission_code  TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_code, permission_code)
);

-- 使用者在某組織（可再限縮到某站點）擁有某角色
CREATE TABLE user_role_bindings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES organizations(id),
  role_code   TEXT NOT NULL REFERENCES roles(code),
  site_id     UUID,                         -- NULL = 該組織全部站點；FK 於 sites 建立後補上
  granted_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX ix_urb_user ON user_role_bindings(user_id) WHERE revoked_at IS NULL;

CREATE TABLE user_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  ip_address    INET,
  user_agent    TEXT,
  mfa_verified  BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ
);

-- =====================================================================
-- 3. 站點、官網公開資料、分區、車格
-- =====================================================================

CREATE TABLE sites (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES organizations(id),   -- 擁有／經營此站的組織
  code               TEXT NOT NULL UNIQUE,                         -- 場站代碼（QR 內含此代碼＋簽章）
  name               TEXT NOT NULL,
  operation_type     TEXT NOT NULL CHECK (operation_type IN ('hq_owned', 'operator', 'franchise')),
  franchise_agreement_id UUID REFERENCES franchise_agreements(id),
  collection_mode    TEXT NOT NULL DEFAULT 'hq_collect'
                     CHECK (collection_mode IN ('hq_collect', 'own_merchant')),
  address            TEXT NOT NULL,
  city               TEXT,
  district           TEXT,
  latitude           NUMERIC(9, 6),
  longitude          NUMERIC(9, 6),
  timezone           TEXT NOT NULL DEFAULT 'Asia/Taipei',
  total_spaces       INTEGER NOT NULL DEFAULT 0 CHECK (total_spaces >= 0),
  status             TEXT NOT NULL DEFAULT 'planning'
                     CHECK (status IN ('planning', 'trial', 'active', 'paused', 'closed')),
  opened_at          DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (operation_type <> 'franchise' OR franchise_agreement_id IS NOT NULL)
);
CREATE INDEX ix_sites_org ON sites(org_id);

ALTER TABLE user_role_bindings
  ADD CONSTRAINT fk_urb_site FOREIGN KEY (site_id) REFERENCES sites(id);

-- 官網顯示用的站點資料（與營運設定分開，避免公開不該公開的欄位）
CREATE TABLE site_public_profiles (
  site_id            UUID PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  is_published       BOOLEAN NOT NULL DEFAULT false,
  public_name        TEXT NOT NULL,
  slug               TEXT NOT NULL UNIQUE,                -- 官網網址 /sites/<slug>
  summary            TEXT,
  opening_hours      JSONB,          -- 例：{"mon":"00:00-24:00", ...}
  rate_display_text  TEXT,           -- 官網顯示的費率說明（實際計費以 fee_rate_versions 為準）
  height_limit_cm    INTEGER,
  supports_ev        BOOLEAN NOT NULL DEFAULT false,
  payment_methods_display TEXT[],    -- 例：{'LINE Pay','信用卡','uTagGo'}
  contact_phone      TEXT,
  photos             JSONB,          -- [{url, alt, order}]
  show_live_vacancy  BOOLEAN NOT NULL DEFAULT false,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE zones (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  zone_type              TEXT NOT NULL CHECK (zone_type IN ('shared', 'reserved_monthly')),
                         -- shared=臨停與共用月租共用；reserved_monthly=固定月租區
  capacity               INTEGER NOT NULL CHECK (capacity >= 0),
  monthly_reserved_count INTEGER NOT NULL DEFAULT 0 CHECK (monthly_reserved_count >= 0),
  occupied_count         INTEGER NOT NULL DEFAULT 0 CHECK (occupied_count >= 0),
                         -- 由 Edge 事件更新；以 SELECT ... FOR UPDATE 原子扣減
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, name),
  CHECK (monthly_reserved_count <= capacity)
);

CREATE TABLE parking_spaces (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id      UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  space_no     TEXT NOT NULL,
  space_type   TEXT NOT NULL DEFAULT 'normal'
               CHECK (space_type IN ('normal', 'fixed_monthly', 'ev', 'accessible', 'motorcycle')),
  is_closed    BOOLEAN NOT NULL DEFAULT false,
  closed_reason TEXT,
  UNIQUE (zone_id, space_no)
);

-- =====================================================================
-- 4. 平台功能開關與站點設定
-- =====================================================================

CREATE TABLE platform_features (
  code          TEXT PRIMARY KEY,           -- 例：payment.line_pay、etc.utaggo
  name          TEXT NOT NULL,
  is_supported  BOOLEAN NOT NULL DEFAULT false   -- 第 1 層：平台是否支援
);

CREATE TABLE site_feature_settings (
  site_id          UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  feature_code     TEXT NOT NULL REFERENCES platform_features(code),
  site_enabled     BOOLEAN NOT NULL DEFAULT false,  -- 第 2 層：場站啟用
  contract_ready   BOOLEAN NOT NULL DEFAULT false,  -- 第 3 層：契約與設定就緒
  service_healthy  BOOLEAN NOT NULL DEFAULT false,  -- 第 4 層：設備／外部服務可用（健康檢查更新）
  config           JSONB NOT NULL DEFAULT '{}',
  updated_by       UUID REFERENCES users(id),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, feature_code)
);

CREATE TABLE site_settings (
  site_id                   UUID PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  quote_ttl_seconds         INTEGER NOT NULL DEFAULT 600 CHECK (quote_ttl_seconds > 0),
  exit_grace_minutes        INTEGER NOT NULL DEFAULT 15 CHECK (exit_grace_minutes > 0),
  rounding_mode             TEXT NOT NULL DEFAULT 'round_half_up'
                            CHECK (rounding_mode IN ('round_half_up', 'floor', 'ceil')),
  discount_hour_basis       TEXT NOT NULL DEFAULT 'earliest'
                            CHECK (discount_hour_basis IN ('earliest', 'most_expensive')),
  exit_cloud_timeout_ms     INTEGER NOT NULL DEFAULT 1500,
  remote_open_requires_reason BOOLEAN NOT NULL DEFAULT true,
  remote_open_requires_mfa  BOOLEAN NOT NULL DEFAULT true,
  pii_retention_days        INTEGER NOT NULL DEFAULT 180,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- 5. 設備：Edge Gateway、車道、相機、FK 卡、柵欄、雷達、Kiosk
-- =====================================================================

CREATE TABLE edge_gateways (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           UUID NOT NULL REFERENCES sites(id),
  name              TEXT NOT NULL,
  hardware_model    TEXT,                    -- 例：Arbor SB-244-1N97
  serial_no         TEXT,
  os_version        TEXT,
  agent_version     TEXT,
  auth_key_ref      TEXT NOT NULL,           -- Edge 對雲端的裝置憑證（mTLS 或簽章金鑰參照）
  last_seen_at      TIMESTAMPTZ,
  last_sync_at      TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'provisioning'
                    CHECK (status IN ('provisioning', 'online', 'offline', 'retired')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE lanes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  edge_gateway_id  UUID REFERENCES edge_gateways(id),
  zone_id          UUID REFERENCES zones(id),
  code             TEXT NOT NULL,            -- 例：IN-1、OUT-1
  direction        TEXT NOT NULL CHECK (direction IN ('entry', 'exit', 'bidirectional')),
  is_active        BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (site_id, code)
);

CREATE TABLE devices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  lane_id          UUID REFERENCES lanes(id),
  edge_gateway_id  UUID REFERENCES edge_gateways(id),
  device_type      TEXT NOT NULL CHECK (device_type IN
                   ('lpr_camera', 'led_voice_card', 'barrier', 'radar', 'exit_display',
                    'kiosk', 'intercom', 'printer', 'ups')),
  vendor           TEXT,                     -- 例：ICE、FK
  model            TEXT,
  serial_no        TEXT,
  firmware_version TEXT,
  ip_address       INET,
  rs485_address    SMALLINT,                 -- FK 卡出廠 100
  connection       JSONB NOT NULL DEFAULT '{}',   -- 例：{"port":8117,"via_camera_485":true}
  capabilities     TEXT[] NOT NULL DEFAULT '{}',  -- 例：{'open_gate','io_input','qr_display'}
  status           TEXT NOT NULL DEFAULT 'unknown'
                   CHECK (status IN ('unknown', 'online', 'offline', 'fault', 'retired')),
  last_seen_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_devices_site ON devices(site_id);

CREATE TABLE device_events (
  id               BIGSERIAL PRIMARY KEY,
  event_uid        TEXT NOT NULL UNIQUE,     -- Edge 產生的唯一事件 ID，重送時去重
  site_id          UUID NOT NULL REFERENCES sites(id),
  device_id        UUID REFERENCES devices(id),
  lane_id          UUID REFERENCES lanes(id),
  event_type       TEXT NOT NULL,            -- plate_read / gate_opened / vehicle_passed / fault / heartbeat ...
  occurred_at      TIMESTAMPTZ NOT NULL,     -- 設備端時間
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_replayed      BOOLEAN NOT NULL DEFAULT false,   -- 斷網續傳
  payload          JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX ix_device_events_site_time ON device_events(site_id, occurred_at DESC);

-- =====================================================================
-- 6. 車輛、月租
-- =====================================================================

CREATE TABLE customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name    TEXT,
  phone           TEXT,
  email           CITEXT,
  line_user_id    TEXT UNIQUE,              -- LINE LIFF 綁定
  default_invoice JSONB,                    -- 預設載具或統編
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE TABLE vehicles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_no       TEXT NOT NULL UNIQUE,      -- 正規化後的車牌（大寫、去除 -）
  customer_id    UUID REFERENCES customers(id),
  vehicle_type   TEXT,
  utaggo_member  BOOLEAN NOT NULL DEFAULT false,
  utaggo_checked_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE monthly_plans (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          UUID NOT NULL REFERENCES sites(id),
  name             TEXT NOT NULL,
  plan_type        TEXT NOT NULL CHECK (plan_type IN ('fixed', 'shared')),
  monthly_price    BIGINT NOT NULL CHECK (monthly_price >= 0),
  max_contracts    INTEGER,                 -- 共用月租合約上限（可超賣上限）
  is_active        BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE monthly_contracts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          UUID NOT NULL REFERENCES sites(id),
  plan_id          UUID NOT NULL REFERENCES monthly_plans(id),
  customer_id      UUID NOT NULL REFERENCES customers(id),
  space_id         UUID REFERENCES parking_spaces(id),   -- 固定月租必填
  contract_no      TEXT NOT NULL UNIQUE,
  starts_on        DATE NOT NULL,
  ends_on          DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('pending', 'active', 'suspended', 'expired', 'cancelled')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);

CREATE TABLE contract_vehicles (
  contract_id  UUID NOT NULL REFERENCES monthly_contracts(id) ON DELETE CASCADE,
  vehicle_id   UUID NOT NULL REFERENCES vehicles(id),
  PRIMARY KEY (contract_id, vehicle_id)
);

-- =====================================================================
-- 7. 費率與停車 Session
-- =====================================================================

CREATE TABLE fee_rate_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         UUID NOT NULL REFERENCES sites(id),
  version_no      INTEGER NOT NULL,
  rules           JSONB NOT NULL,           -- 免費時間、每單位金額、時段、每日上限、跨日規則
  effective_from  TIMESTAMPTZ NOT NULL,
  effective_to    TIMESTAMPTZ,
  approved_by     UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, version_no)
);

CREATE TABLE parking_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id            UUID NOT NULL REFERENCES sites(id),
  org_id             UUID NOT NULL REFERENCES organizations(id),   -- 冗餘存放，供 RLS 與報表
  plate_no           TEXT NOT NULL,
  vehicle_id         UUID REFERENCES vehicles(id),
  session_type       TEXT NOT NULL DEFAULT 'transient'
                     CHECK (session_type IN ('transient', 'monthly_fixed', 'monthly_shared', 'utaggo', 'exempt')),
  monthly_contract_id UUID REFERENCES monthly_contracts(id),
  zone_id            UUID REFERENCES zones(id),
  entry_lane_id      UUID REFERENCES lanes(id),
  entry_event_uid    TEXT REFERENCES device_events(event_uid),
  entry_at           TIMESTAMPTZ NOT NULL,
  entry_confidence   NUMERIC(5, 2),
  exit_lane_id       UUID REFERENCES lanes(id),
  exit_event_uid     TEXT REFERENCES device_events(event_uid),
  exit_at            TIMESTAMPTZ,
  status             TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'paid', 'exiting', 'closed', 'exception', 'voided')),
  fee_rate_version_id UUID REFERENCES fee_rate_versions(id),
  total_charged      BIGINT NOT NULL DEFAULT 0,   -- 累計已收（含補繳）
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (exit_at IS NULL OR exit_at >= entry_at)
);
-- 同一站點同一車牌只能有一筆未結案 Session（防重複進場）
CREATE UNIQUE INDEX uq_session_open_plate
  ON parking_sessions(site_id, plate_no)
  WHERE status IN ('open', 'paid', 'exiting', 'exception');
CREATE INDEX ix_sessions_site_entry ON parking_sessions(site_id, entry_at DESC);
CREATE INDEX ix_sessions_org ON parking_sessions(org_id);

-- 公開端查詢用的短效 token（不外露 Session ID）
CREATE TABLE session_lookup_tokens (
  token_hash    TEXT PRIMARY KEY,
  session_id    UUID NOT NULL REFERENCES parking_sessions(id) ON DELETE CASCADE,
  channel       TEXT NOT NULL CHECK (channel IN ('pay_web', 'exit_qr', 'kiosk', 'line_liff')),
  lane_id       UUID REFERENCES lanes(id),          -- 出口 QR 綁定車道
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE parking_fee_quotes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID NOT NULL REFERENCES parking_sessions(id),
  fee_rate_version_id UUID NOT NULL REFERENCES fee_rate_versions(id),
  calculated_until    TIMESTAMPTZ NOT NULL,
  gross_amount        BIGINT NOT NULL CHECK (gross_amount >= 0),
  discount_amount     BIGINT NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  payable_amount      BIGINT NOT NULL CHECK (payable_amount >= 0),
  breakdown           JSONB NOT NULL DEFAULT '{}',   -- 計費明細，可重算比對
  expires_at          TIMESTAMPTZ NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'used', 'expired', 'superseded')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (payable_amount = gross_amount - discount_amount)
);
CREATE INDEX ix_quotes_session ON parking_fee_quotes(session_id, created_at DESC);

-- =====================================================================
-- 8. 商家折抵
-- =====================================================================

CREATE TABLE merchants (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES organizations(id),   -- 與哪個經營者簽約
  name               TEXT NOT NULL,
  tax_id             TEXT,
  credit_limit       BIGINT,                 -- 信用額度
  prepaid_balance    BIGINT NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('pending', 'active', 'suspended', 'terminated')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE merchant_sites (
  merchant_id  UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  site_id      UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  PRIMARY KEY (merchant_id, site_id)
);

CREATE TABLE merchant_users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id       UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  email             CITEXT NOT NULL UNIQUE,
  display_name      TEXT NOT NULL,
  password_hash     TEXT,
  role              TEXT NOT NULL CHECK (role IN ('owner', 'staff', 'accountant')),
  daily_issue_limit INTEGER,                 -- 每日發券上限
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('invited', 'active', 'disabled')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE discount_campaigns (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id        UUID REFERENCES merchants(id),     -- NULL = 停車場自辦促銷
  funded_by          TEXT NOT NULL CHECK (funded_by IN ('merchant', 'site_promotion', 'prepaid_pass')),
  name               TEXT NOT NULL,
  discount_type      TEXT NOT NULL CHECK (discount_type IN ('fixed_amount', 'hours', 'percent', 'full')),
  discount_value     NUMERIC(10, 2),          -- 元／小時／百分比；full 時為 NULL
  max_discount       BIGINT,
  stackable          BOOLEAN NOT NULL DEFAULT false,
  priority           INTEGER NOT NULL DEFAULT 100,
  valid_from         TIMESTAMPTZ NOT NULL,
  valid_to           TIMESTAMPTZ NOT NULL,
  requires_manager   BOOLEAN NOT NULL DEFAULT false,  -- 全額或高額需主管
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'ended')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_to > valid_from)
);

CREATE TABLE discount_vouchers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID NOT NULL REFERENCES discount_campaigns(id),
  code_hash        TEXT NOT NULL UNIQUE,      -- QR 內容的雜湊
  voucher_kind     TEXT NOT NULL CHECK (voucher_kind IN ('single_use', 'dynamic', 'plate_bound')),
  site_id          UUID REFERENCES sites(id),
  bound_plate_no   TEXT,                      -- 第一次使用時綁定
  max_uses         INTEGER NOT NULL DEFAULT 1,
  used_count       INTEGER NOT NULL DEFAULT 0,
  issued_by        UUID REFERENCES merchant_users(id),
  issued_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  status           TEXT NOT NULL DEFAULT 'issued'
                   CHECK (status IN ('issued', 'reserved', 'redeemed', 'expired', 'revoked')),
  CHECK (used_count <= max_uses)
);

CREATE TABLE discount_redemptions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id       UUID NOT NULL REFERENCES discount_vouchers(id),
  session_id       UUID NOT NULL REFERENCES parking_sessions(id),
  quote_id         UUID REFERENCES parking_fee_quotes(id),
  entry_channel    TEXT NOT NULL CHECK (entry_channel IN ('driver_scan', 'merchant_portal', 'admin')),
  face_value       BIGINT NOT NULL CHECK (face_value >= 0),     -- 券面額
  applied_amount   BIGINT NOT NULL CHECK (applied_amount >= 0), -- 實際折抵額
  status           TEXT NOT NULL DEFAULT 'reserved'
                   CHECK (status IN ('reserved', 'redeemed', 'released')),
  reserved_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  redeemed_at      TIMESTAMPTZ,
  released_at      TIMESTAMPTZ
);
-- 同一張券同時只能被一個 Session 保留或核銷
CREATE UNIQUE INDEX uq_redemption_active_voucher
  ON discount_redemptions(voucher_id, session_id)
  WHERE status IN ('reserved', 'redeemed');

-- =====================================================================
-- 9. 金流：Provider 設定、付款訂單、交易、退款
-- =====================================================================

-- 收款帳戶：總部統一收款，或加盟主自有商店（同一張表，以 owner_org 區分）
CREATE TABLE payment_provider_accounts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_org_id       UUID NOT NULL REFERENCES organizations(id),
  provider           TEXT NOT NULL CHECK (provider IN
                     ('mock', 'payuni', 'line_pay', 'jkopay', 'credit_card', 'utaggo', 'cash')),
  environment        TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  merchant_no        TEXT NOT NULL,          -- 商店代號
  credentials_ref    TEXT NOT NULL,          -- HashKey／HashIV 等存在密鑰服務，這裡只放參照
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'active', 'suspended')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, environment, merchant_no)
);

-- 站點使用哪個收款帳戶、開放哪些付款方式
CREATE TABLE site_payment_methods (
  site_id            UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  method             TEXT NOT NULL CHECK (method IN
                     ('line_pay', 'jkopay', 'credit_card', 'apple_pay', 'google_pay', 'utaggo', 'cash')),
  provider_account_id UUID NOT NULL REFERENCES payment_provider_accounts(id),
  display_order      INTEGER NOT NULL DEFAULT 100,
  is_enabled         BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (site_id, method)
);

CREATE TABLE payment_orders (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no             TEXT NOT NULL UNIQUE,     -- 送給金流商的訂單編號
  session_id           UUID NOT NULL REFERENCES parking_sessions(id),
  site_id              UUID NOT NULL REFERENCES sites(id),
  org_id               UUID NOT NULL REFERENCES organizations(id),
  quote_id             UUID NOT NULL REFERENCES parking_fee_quotes(id),
  provider_account_id  UUID REFERENCES payment_provider_accounts(id),  -- 零元結算為 NULL
  method               TEXT,
  channel              TEXT NOT NULL CHECK (channel IN ('pay_web', 'exit_qr', 'kiosk', 'line_liff', 'utaggo', 'admin')),
  amount               BIGINT NOT NULL CHECK (amount >= 0),
  idempotency_key      TEXT NOT NULL UNIQUE,
  status               TEXT NOT NULL DEFAULT 'created'
                       CHECK (status IN ('created', 'pending', 'paid', 'failed', 'expired',
                                         'unknown', 'refunding', 'refunded', 'partially_refunded')),
  is_zero_settlement   BOOLEAN NOT NULL DEFAULT false,
  paid_at              TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (is_zero_settlement = (amount = 0)),
  CHECK (is_zero_settlement OR provider_account_id IS NOT NULL)
);
-- 每個 Session 同時只能有一張進行中的付款訂單（防重複付款）
CREATE UNIQUE INDEX uq_payment_order_active_session
  ON payment_orders(session_id)
  WHERE status IN ('created', 'pending', 'unknown');
CREATE INDEX ix_payment_orders_site_time ON payment_orders(site_id, created_at DESC);

-- 合法狀態轉移（由觸發器檢查，避免程式誤改）
CREATE TABLE payment_order_transitions (
  from_status  TEXT NOT NULL,
  to_status    TEXT NOT NULL,
  PRIMARY KEY (from_status, to_status)
);
INSERT INTO payment_order_transitions VALUES
  ('created', 'pending'), ('created', 'paid'), ('created', 'expired'), ('created', 'failed'),
  ('pending', 'paid'), ('pending', 'failed'), ('pending', 'unknown'), ('pending', 'expired'),
  ('unknown', 'paid'), ('unknown', 'failed'),
  ('paid', 'refunding'),
  ('refunding', 'refunded'), ('refunding', 'partially_refunded'), ('refunding', 'paid'),
  ('partially_refunded', 'refunding');

CREATE OR REPLACE FUNCTION check_payment_order_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT EXISTS (
       SELECT 1 FROM payment_order_transitions
       WHERE from_status = OLD.status AND to_status = NEW.status) THEN
    RAISE EXCEPTION 'illegal payment_order transition % -> %', OLD.status, NEW.status;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payment_order_transition
  BEFORE UPDATE ON payment_orders
  FOR EACH ROW EXECUTE FUNCTION check_payment_order_transition();

-- 與金流商的每一次往來（建立、Webhook、查詢、退款）
CREATE TABLE payment_transactions (
  id                 BIGSERIAL PRIMARY KEY,
  payment_order_id   UUID NOT NULL REFERENCES payment_orders(id),
  kind               TEXT NOT NULL CHECK (kind IN ('create', 'webhook', 'query', 'refund', 'void')),
  provider_txn_id    TEXT,
  amount             BIGINT,
  result_status      TEXT,
  signature_valid    BOOLEAN,
  raw_payload        JSONB,                   -- 需遮罩卡號等敏感欄位後才寫入
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 同一筆 Webhook 重送只記一次
CREATE UNIQUE INDEX uq_payment_txn_webhook
  ON payment_transactions(payment_order_id, kind, provider_txn_id, result_status)
  WHERE kind = 'webhook' AND provider_txn_id IS NOT NULL;

CREATE TABLE refunds (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_order_id   UUID NOT NULL REFERENCES payment_orders(id),
  amount             BIGINT NOT NULL CHECK (amount > 0),
  reason             TEXT NOT NULL CHECK (reason IN
                     ('duplicate_payment', 'customer_complaint', 'post_payment_discount',
                      'exit_failure', 'operator_adjustment')),
  note               TEXT,
  requested_by       UUID REFERENCES users(id),
  approved_by        UUID REFERENCES users(id),
  status             TEXT NOT NULL DEFAULT 'requested'
                     CHECK (status IN ('requested', 'approved', 'submitted', 'succeeded', 'failed', 'rejected')),
  provider_refund_id TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at       TIMESTAMPTZ
);

-- 遠通代扣（離場後扣款，失敗需補收）
CREATE TABLE utaggo_charges (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         UUID NOT NULL UNIQUE REFERENCES parking_sessions(id),
  amount             BIGINT NOT NULL CHECK (amount >= 0),
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'submitted', 'succeeded', 'failed', 'recovering', 'written_off')),
  provider_ref       TEXT,
  submitted_at       TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  failure_reason     TEXT
);

-- =====================================================================
-- 10. 電子發票
-- =====================================================================

CREATE TABLE invoice_records (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_order_id   UUID REFERENCES payment_orders(id),
  merchant_settlement_id UUID,              -- 開給商家的 B2B 發票；FK 於後面補上
  issuer_org_id      UUID NOT NULL REFERENCES organizations(id),   -- 開立主體（總部或加盟主）
  invoice_type       TEXT NOT NULL CHECK (invoice_type IN ('b2c', 'b2b')),
  buyer_tax_id       TEXT,
  buyer_name         TEXT,
  carrier_type       TEXT CHECK (carrier_type IN ('mobile_barcode', 'member', 'none')),
  carrier_id_enc     TEXT,                  -- 載具號碼加密保存
  donation_code      TEXT,                  -- 愛心碼
  delivery           TEXT NOT NULL CHECK (delivery IN ('carrier', 'donation', 'paper_print', 'email')),
  amount             BIGINT NOT NULL CHECK (amount >= 0),
  idempotency_key    TEXT NOT NULL UNIQUE,  -- 防重複開票
  invoice_no         TEXT UNIQUE,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'issued', 'failed', 'voided', 'allowance')),
  issued_at          TIMESTAMPTZ,
  last_error         TEXT,
  retry_count        INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (payment_order_id IS NOT NULL OR merchant_settlement_id IS NOT NULL),
  CHECK (invoice_type <> 'b2b' OR buyer_tax_id IS NOT NULL)
);

-- =====================================================================
-- 11. 出場授權與遠端開閘
-- =====================================================================

CREATE TABLE exit_authorizations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         UUID NOT NULL REFERENCES parking_sessions(id),
  site_id            UUID NOT NULL REFERENCES sites(id),
  plate_no           TEXT NOT NULL,
  source             TEXT NOT NULL CHECK (source IN ('payment', 'zero_settlement', 'monthly', 'utaggo', 'manual')),
  payment_order_id   UUID REFERENCES payment_orders(id),
  valid_from         TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until        TIMESTAMPTZ NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'used', 'expired', 'revoked')),
  used_at            TIMESTAMPTZ,
  used_lane_id       UUID REFERENCES lanes(id),
  synced_to_edge_at  TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_until > valid_from)
);
CREATE UNIQUE INDEX uq_exit_auth_active_session
  ON exit_authorizations(session_id) WHERE status = 'active';

-- 遠端開閘：雲端只建立「指令」，由 Edge 取回並執行，執行結果回寫
CREATE TABLE gate_commands (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id            UUID NOT NULL REFERENCES sites(id),
  lane_id            UUID NOT NULL REFERENCES lanes(id),
  command            TEXT NOT NULL CHECK (command IN ('open_once', 'hold_open', 'release_hold', 'close')),
  reason_code        TEXT NOT NULL CHECK (reason_code IN
                     ('payment_issue', 'plate_misread', 'intercom_request', 'device_fault',
                      'emergency', 'maintenance', 'other')),
  reason_note        TEXT,
  session_id         UUID REFERENCES parking_sessions(id),
  plate_no           TEXT,
  requested_by       UUID NOT NULL REFERENCES users(id),
  requested_role     TEXT NOT NULL REFERENCES roles(code),
  approved_by        UUID REFERENCES users(id),   -- hold_open 等高風險指令需第二人核准
  idempotency_key    TEXT NOT NULL UNIQUE,
  status             TEXT NOT NULL DEFAULT 'requested'
                     CHECK (status IN ('requested', 'approved', 'dispatched', 'executed',
                                       'failed', 'rejected', 'expired', 'cancelled')),
  expires_at         TIMESTAMPTZ NOT NULL,        -- 逾時未執行即失效，避免延遲開閘
  dispatched_at      TIMESTAMPTZ,
  executed_at        TIMESTAMPTZ,
  edge_result        JSONB,
  vehicle_passed_event_uid TEXT REFERENCES device_events(event_uid),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (reason_code <> 'other' OR reason_note IS NOT NULL)
);
CREATE INDEX ix_gate_commands_pending
  ON gate_commands(site_id, status) WHERE status IN ('requested', 'approved', 'dispatched');

-- =====================================================================
-- 12. 營運例外與客服
-- =====================================================================

CREATE TABLE ops_incidents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          UUID NOT NULL REFERENCES sites(id),
  lane_id          UUID REFERENCES lanes(id),
  session_id       UUID REFERENCES parking_sessions(id),
  incident_type    TEXT NOT NULL CHECK (incident_type IN
                   ('low_confidence_plate', 'plate_mismatch', 'payment_unknown', 'duplicate_payment',
                    'gate_not_opened', 'vehicle_not_passed', 'tailgating', 'device_offline',
                    'capacity_conflict', 'intercom_call', 'customer_complaint', 'other')),
  severity         TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  detail           JSONB NOT NULL DEFAULT '{}',
  assigned_to      UUID REFERENCES users(id),
  opened_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at      TIMESTAMPTZ,
  resolution_note  TEXT
);
CREATE INDEX ix_incidents_open ON ops_incidents(site_id, opened_at DESC) WHERE status IN ('open', 'acknowledged');

-- =====================================================================
-- 13. 結算：商家、加盟主
-- =====================================================================

CREATE TABLE merchant_settlements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id       UUID NOT NULL REFERENCES merchants(id),
  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,
  basis             TEXT NOT NULL CHECK (basis IN ('applied_amount', 'face_value')),
  redemption_count  INTEGER NOT NULL DEFAULT 0,
  amount_due        BIGINT NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'confirmed', 'invoiced', 'paid', 'disputed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, period_start, period_end)
);

ALTER TABLE invoice_records
  ADD CONSTRAINT fk_invoice_merchant_settlement
  FOREIGN KEY (merchant_settlement_id) REFERENCES merchant_settlements(id);

CREATE TABLE franchise_settlements (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  franchise_agreement_id UUID NOT NULL REFERENCES franchise_agreements(id),
  franchisee_org_id     UUID NOT NULL REFERENCES organizations(id),
  period_start          DATE NOT NULL,
  period_end            DATE NOT NULL,
  collection_mode       TEXT NOT NULL CHECK (collection_mode IN ('hq_collect', 'own_merchant')),
  gross_revenue         BIGINT NOT NULL DEFAULT 0,   -- 期間車主實付
  refunds_total         BIGINT NOT NULL DEFAULT 0,
  merchant_funded_total BIGINT NOT NULL DEFAULT 0,   -- 商家負擔折抵（另向商家請款）
  provider_fees         BIGINT NOT NULL DEFAULT 0,   -- 金流手續費
  franchisee_share      BIGINT NOT NULL DEFAULT 0,   -- hq_collect：應撥給加盟主
  royalty_due           BIGINT NOT NULL DEFAULT 0,   -- own_merchant：加盟主應付權利金
  system_fee_due        BIGINT NOT NULL DEFAULT 0,
  net_payable           BIGINT NOT NULL DEFAULT 0,   -- 正數=總部付加盟主；負數=加盟主付總部
  status                TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'confirmed', 'paid', 'disputed')),
  confirmed_by          UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (franchise_agreement_id, period_start, period_end)
);

-- 金流商撥款對帳
CREATE TABLE provider_reconciliations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_account_id UUID NOT NULL REFERENCES payment_provider_accounts(id),
  business_date       DATE NOT NULL,
  file_ref            TEXT,
  matched_count       INTEGER NOT NULL DEFAULT 0,
  mismatch_count      INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'matched', 'mismatched', 'resolved')),
  detail              JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_account_id, business_date)
);

-- =====================================================================
-- 14. 營運儀表板：每日彙總（排程每 5 分鐘更新當日、凌晨結算前一日）
-- =====================================================================

CREATE TABLE daily_site_metrics (
  site_id              UUID NOT NULL REFERENCES sites(id),
  org_id               UUID NOT NULL REFERENCES organizations(id),
  business_date        DATE NOT NULL,
  entries              INTEGER NOT NULL DEFAULT 0,
  exits                INTEGER NOT NULL DEFAULT 0,
  transient_sessions   INTEGER NOT NULL DEFAULT 0,
  monthly_sessions     INTEGER NOT NULL DEFAULT 0,
  gross_revenue        BIGINT NOT NULL DEFAULT 0,
  discount_total       BIGINT NOT NULL DEFAULT 0,
  refunds_total        BIGINT NOT NULL DEFAULT 0,
  avg_duration_minutes INTEGER,
  peak_occupancy       INTEGER,
  remote_opens         INTEGER NOT NULL DEFAULT 0,
  incidents            INTEGER NOT NULL DEFAULT 0,
  device_offline_minutes INTEGER NOT NULL DEFAULT 0,
  revenue_by_method    JSONB NOT NULL DEFAULT '{}',
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, business_date)
);

-- =====================================================================
-- 15. 官網內容
-- =====================================================================

CREATE TABLE cms_pages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE,         -- home、about、franchise、faq ...
  title         TEXT NOT NULL,
  body          JSONB NOT NULL DEFAULT '{}',  -- 區塊式內容
  seo           JSONB NOT NULL DEFAULT '{}',
  is_published  BOOLEAN NOT NULL DEFAULT false,
  updated_by    UUID REFERENCES users(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE announcements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID REFERENCES sites(id),    -- NULL = 全站公告
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  publish_from  TIMESTAMPTZ NOT NULL,
  publish_to    TIMESTAMPTZ,
  is_published  BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 官網加盟洽詢表單
CREATE TABLE franchise_inquiries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL,
  email         CITEXT,
  city          TEXT,
  land_info     TEXT,                         -- 場地位置、面積、車位數
  message       TEXT,
  status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'closed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- 16. 稽核紀錄（只能新增，不可修改或刪除）
-- =====================================================================

CREATE TABLE audit_logs (
  id             BIGSERIAL PRIMARY KEY,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_type     TEXT NOT NULL CHECK (actor_type IN ('user', 'merchant_user', 'edge', 'system')),
  actor_id       TEXT NOT NULL,
  actor_role     TEXT,
  org_id         UUID REFERENCES organizations(id),
  site_id        UUID REFERENCES sites(id),
  action         TEXT NOT NULL,              -- 例：gate.remote_open、refund.approve、rate.publish
  target_type    TEXT,
  target_id      TEXT,
  reason         TEXT,
  before_value   JSONB,
  after_value    JSONB,
  ip_address     INET
);
CREATE INDEX ix_audit_site_time ON audit_logs(site_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION forbid_audit_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_change();

-- =====================================================================
-- 17. updated_at 觸發器
-- =====================================================================

CREATE TRIGGER trg_org_updated   BEFORE UPDATE ON organizations        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_fa_updated    BEFORE UPDATE ON franchise_agreements FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users                FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_sites_updated BEFORE UPDATE ON sites                FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_sess_updated  BEFORE UPDATE ON parking_sessions     FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- 18. 角色與權限種子資料
-- =====================================================================

INSERT INTO roles (code, name, org_type, description) VALUES
  ('hq_admin',          '總部管理員',     'hq',         '全平台設定與帳號管理'),
  ('hq_ops',            '總部營運',       'hq',         '所有站點的監控、例外處理、遠端開閘'),
  ('hq_support',        '總部客服',       'hq',         '對講與客訴處理、遠端開閘'),
  ('hq_finance',        '總部財務',       'hq',         '對帳、退款核准、加盟結算'),
  ('operator_admin',    '自營站點管理員', 'operator',   '自己站點的設定、報表、遠端開閘'),
  ('operator_staff',    '自營現場人員',   'operator',   '自己站點的例外處理、遠端開閘'),
  ('franchisee_owner',  '加盟主',         'franchisee', '自己站點的報表、帳號、遠端開閘'),
  ('franchisee_staff',  '加盟現場人員',   'franchisee', '由加盟主建立；自己站點的例外處理、遠端開閘');

INSERT INTO permissions (code, description) VALUES
  ('site.view',            '檢視站點資料'),
  ('site.edit',            '編輯站點基本資料與官網資料'),
  ('site.settings',        '修改計費、寬限期等站點設定'),
  ('rate.publish',         '發布費率版本'),
  ('dashboard.view',       '檢視營運儀表板'),
  ('session.view',         '檢視停車紀錄'),
  ('session.adjust',       '人工結案或調整停車紀錄'),
  ('gate.remote_open',     '遠端開閘（單次）'),
  ('gate.hold_open',       '柵欄常開（需第二人核准）'),
  ('incident.handle',      '處理營運例外'),
  ('monthly.manage',       '管理月租合約'),
  ('finance.view',         '檢視財務報表'),
  ('refund.request',       '申請退款'),
  ('refund.approve',       '核准退款'),
  ('settlement.manage',    '產生與確認結算'),
  ('device.manage',        '設備設定與 FK 參數類指令（人工）'),
  ('user.manage_org',      '管理本組織帳號'),
  ('platform.admin',       '平台層級管理');

INSERT INTO role_permissions (role_code, permission_code)
SELECT r, p FROM (VALUES
  ('hq_admin','site.view'),('hq_admin','site.edit'),('hq_admin','site.settings'),('hq_admin','rate.publish'),
  ('hq_admin','dashboard.view'),('hq_admin','session.view'),('hq_admin','session.adjust'),
  ('hq_admin','gate.remote_open'),('hq_admin','gate.hold_open'),('hq_admin','incident.handle'),
  ('hq_admin','monthly.manage'),('hq_admin','finance.view'),('hq_admin','refund.request'),
  ('hq_admin','refund.approve'),('hq_admin','settlement.manage'),('hq_admin','device.manage'),
  ('hq_admin','user.manage_org'),('hq_admin','platform.admin'),

  ('hq_ops','site.view'),('hq_ops','dashboard.view'),('hq_ops','session.view'),('hq_ops','session.adjust'),
  ('hq_ops','gate.remote_open'),('hq_ops','gate.hold_open'),('hq_ops','incident.handle'),
  ('hq_ops','refund.request'),('hq_ops','device.manage'),

  ('hq_support','site.view'),('hq_support','session.view'),('hq_support','gate.remote_open'),
  ('hq_support','incident.handle'),('hq_support','refund.request'),

  ('hq_finance','site.view'),('hq_finance','dashboard.view'),('hq_finance','session.view'),
  ('hq_finance','finance.view'),('hq_finance','refund.approve'),('hq_finance','settlement.manage'),

  ('operator_admin','site.view'),('operator_admin','site.edit'),('operator_admin','site.settings'),
  ('operator_admin','dashboard.view'),('operator_admin','session.view'),('operator_admin','session.adjust'),
  ('operator_admin','gate.remote_open'),('operator_admin','incident.handle'),('operator_admin','monthly.manage'),
  ('operator_admin','finance.view'),('operator_admin','refund.request'),('operator_admin','user.manage_org'),

  ('operator_staff','site.view'),('operator_staff','session.view'),('operator_staff','gate.remote_open'),
  ('operator_staff','incident.handle'),

  ('franchisee_owner','site.view'),('franchisee_owner','site.edit'),('franchisee_owner','dashboard.view'),
  ('franchisee_owner','session.view'),('franchisee_owner','gate.remote_open'),('franchisee_owner','incident.handle'),
  ('franchisee_owner','monthly.manage'),('franchisee_owner','finance.view'),('franchisee_owner','refund.request'),
  ('franchisee_owner','user.manage_org'),

  ('franchisee_staff','site.view'),('franchisee_staff','session.view'),('franchisee_staff','gate.remote_open'),
  ('franchisee_staff','incident.handle')
) AS t(r, p);

-- =====================================================================
-- 19. Row Level Security 範例（以 parking_sessions 為例，其他營運表比照）
--   應用程式每個請求先執行：
--     SET LOCAL app.org_ids = '<逗號分隔的可存取 org_id>';
--     SET LOCAL app.is_hq   = 'true' | 'false';
-- =====================================================================

ALTER TABLE parking_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_sessions_tenant ON parking_sessions
  USING (
    current_setting('app.is_hq', true) = 'true'
    OR org_id::text = ANY (string_to_array(current_setting('app.org_ids', true), ','))
  );

COMMIT;
