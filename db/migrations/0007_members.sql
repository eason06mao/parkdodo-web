-- 0007 會員與月租登記單
-- 會員 = 線上帳號，可用 LINE、Google 或手機簡訊登入（member_identities），三種都對應到同一位會員。
-- 月租合約的 customers 是簽約對象，以手機號碼對應。手機一律存正規化格式 09XXXXXXXX。

CREATE TABLE members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name    TEXT NOT NULL DEFAULT '',
  phone           TEXT UNIQUE CHECK (phone ~ '^09\d{8}$'),   -- 簡訊驗證過才寫入
  email           CITEXT,                                    -- Google／LINE 提供，中獎通知用
  source_site_id  UUID REFERENCES sites(id),                 -- 從哪一站加入（掃哪一站的 QR）
  privacy_version TEXT NOT NULL,                             -- 同意的個資告知版本
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE TABLE member_identities (
  provider     TEXT NOT NULL CHECK (provider IN ('phone', 'line', 'google')),
  subject      TEXT NOT NULL,                  -- phone：09XXXXXXXX；line／google：對方給的使用者 ID（sub）
  member_id    UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  email        CITEXT,
  display_name TEXT,
  linked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject),
  UNIQUE (member_id, provider)                 -- 一位會員每種方式只綁一個
);

CREATE TABLE member_vehicles (
  member_id  UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  plate_no   TEXT NOT NULL CHECK (plate_no ~ '^[A-Z0-9]{4,8}$'),   -- 大寫、去除 -
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, plate_no)
);
CREATE INDEX ix_member_vehicles_plate ON member_vehicles(plate_no);

-- 簡訊驗證碼：只存雜湊；Cloud Run 多台機器共用
CREATE TABLE member_otps (
  phone       TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  sends_hour  INTEGER NOT NULL DEFAULT 1,      -- 這一小時內寄了幾次
  hour_start  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE monthly_leads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     UUID NOT NULL REFERENCES members(id),
  site_id       UUID NOT NULL REFERENCES sites(id),
  plan_id       UUID REFERENCES monthly_plans(id),     -- NULL＝還不確定
  name          TEXT NOT NULL,
  contact_phone TEXT NOT NULL CHECK (contact_phone ~ '^09\d{8}$'),
  note          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'converted', 'closed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT
);
CREATE INDEX ix_monthly_leads_site ON monthly_leads(site_id, status, created_at DESC);
-- 同一位會員在同一站只能有一張處理中的登記單
CREATE UNIQUE INDEX ux_monthly_leads_open ON monthly_leads(member_id, site_id) WHERE status IN ('new', 'contacted');
