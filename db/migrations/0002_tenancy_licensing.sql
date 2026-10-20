-- ParkDodo V2 Migration 0002：系統客戶、軟體授權、建站權限、防止越權授權
-- 前提：已執行 0001_v2_core.sql
--
-- 商業模式：ParkDodo 總部除了自營與加盟，也販售「硬體＋軟體」給系統客戶（licensee）自行經營。
-- 原則：
--   1. 新增站點只有總部能做（牽涉硬體出貨、工控機配對、軟體授權）。建立後指派給組織。
--   2. 客戶可以改自己站點的名稱、費率、帳號，但不能開新站、不能給出比自己大的權限。
--   3. 授權到期只鎖定進階功能，絕不讓柵欄停擺（由 Edge 與 API 端執行，本檔記錄規則）。
--
-- 應用程式每個請求在交易開頭設定（與 0001 的 RLS 相同慣例）：
--   SET LOCAL app.context = 'request';
--   SET LOCAL app.user_id = '<登入者 users.id>';
--   SET LOCAL app.is_hq   = 'true' | 'false';
--   SET LOCAL app.org_ids = '<逗號分隔的可存取 org_id>';
-- Migration、種子資料與維運腳本不設定 app.context，因此不受請求層檢查限制。

BEGIN;

-- =====================================================================
-- 1. 組織類型：新增 licensee（系統客戶）
-- =====================================================================

ALTER TABLE organizations DROP CONSTRAINT organizations_org_type_check;
ALTER TABLE organizations ADD CONSTRAINT organizations_org_type_check
  CHECK (org_type IN ('hq', 'operator', 'franchisee', 'licensee'));
  -- hq=總部、operator=自營商、franchisee=加盟主、licensee=系統客戶（購買硬體與軟體自行經營）

-- 加盟主與系統客戶一定隸屬總部，方便總部管理與 RLS 判斷
ALTER TABLE organizations ADD CONSTRAINT org_tenant_parent_required
  CHECK (org_type NOT IN ('franchisee', 'licensee') OR parent_org_id IS NOT NULL);

ALTER TABLE roles DROP CONSTRAINT roles_org_type_check;
ALTER TABLE roles ADD CONSTRAINT roles_org_type_check
  CHECK (org_type IN ('hq', 'operator', 'franchisee', 'licensee'));

-- =====================================================================
-- 2. 站點經營方式：新增 licensed（系統客戶自營）
-- =====================================================================

ALTER TABLE sites DROP CONSTRAINT sites_operation_type_check;
ALTER TABLE sites ADD CONSTRAINT sites_operation_type_check
  CHECK (operation_type IN ('hq_owned', 'operator', 'franchise', 'licensed'));

-- 系統客戶的錢一定進他們自己的金流商店，總部不代收
ALTER TABLE sites ADD CONSTRAINT site_licensed_own_merchant
  CHECK (operation_type <> 'licensed' OR collection_mode = 'own_merchant');

-- 只有總部能在請求中建立站點，也只有總部能把站點移轉給其他組織
CREATE OR REPLACE FUNCTION guard_site_write() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('app.context', true), '') <> 'request' THEN
    RETURN NEW;   -- migration／種子資料／維運腳本
  END IF;
  IF coalesce(current_setting('app.is_hq', true), 'false') = 'true' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'only HQ can create sites' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.operation_type IS DISTINCT FROM OLD.operation_type
     OR NEW.collection_mode IS DISTINCT FROM OLD.collection_mode
     OR NEW.code IS DISTINCT FROM OLD.code
     OR NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'only HQ can change site ownership, code, operation type, collection mode or status'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_site_guard BEFORE INSERT OR UPDATE ON sites
  FOR EACH ROW EXECUTE FUNCTION guard_site_write();

-- =====================================================================
-- 3. 軟體授權（每站一張有效授權）
-- =====================================================================

CREATE TABLE site_licenses (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id        UUID NOT NULL REFERENCES sites(id),
  org_id         UUID NOT NULL REFERENCES organizations(id),   -- 被授權的組織（= 站點擁有者）
  license_no     TEXT NOT NULL UNIQUE,                         -- 例：LIC-2026-0001
  plan           TEXT NOT NULL CHECK (plan IN ('basic', 'standard', 'pro')),
  max_lanes      INTEGER NOT NULL CHECK (max_lanes > 0),
  features       JSONB NOT NULL DEFAULT '{}',                  -- 方案外加購，例：{"cash_kiosk":true}
  starts_on      DATE NOT NULL,
  ends_on        DATE NOT NULL,
  grace_days     INTEGER NOT NULL DEFAULT 14 CHECK (grace_days BETWEEN 0 AND 90),
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('trial', 'active', 'suspended', 'expired', 'cancelled')),
  -- 到期或停權時：鎖定報表匯出、新增月租、費率發布等進階功能。
  -- 不影響：車牌辨識、進出場判斷、付款、出場開閘、遠端開閘、例外處理（避免車子出不去）。
  notes          TEXT,
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);
CREATE UNIQUE INDEX uq_site_license_current ON site_licenses(site_id)
  WHERE status IN ('trial', 'active', 'suspended');
CREATE TRIGGER trg_license_updated BEFORE UPDATE ON site_licenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 授權的組織必須是站點擁有者
CREATE OR REPLACE FUNCTION check_license_org() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sites s WHERE s.id = NEW.site_id AND s.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'license org must own the site';
  END IF;
  IF coalesce(current_setting('app.context', true), '') = 'request'
     AND coalesce(current_setting('app.is_hq', true), 'false') <> 'true' THEN
    RAISE EXCEPTION 'only HQ can issue or change licenses' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_license_org BEFORE INSERT OR UPDATE ON site_licenses
  FOR EACH ROW EXECUTE FUNCTION check_license_org();

-- =====================================================================
-- 4. 角色與權限
-- =====================================================================

INSERT INTO roles (code, name, org_type, description) VALUES
  ('licensee_admin', '系統客戶管理員', 'licensee', '自己站點的設定、費率、報表、帳號、遠端開閘'),
  ('licensee_staff', '系統客戶現場人員', 'licensee', '由系統客戶管理員建立；自己站點的例外處理、遠端開閘');

INSERT INTO permissions (code, description) VALUES
  ('site.create',     '新增站點並指派給組織（僅總部）'),
  ('org.manage',      '新增與管理加盟主、系統客戶等組織（僅總部）'),
  ('license.manage',  '開立、續約、停用軟體授權（僅總部）'),
  ('license.view',    '檢視自己站點的授權方案與到期日'),
  ('edge.pair',       '配對與更換工控機（僅總部）'),
  ('audit.view',      '檢視稽核紀錄');

-- 「僅總部」權限：只能綁在 org_type = 'hq' 的角色上
CREATE TABLE platform_only_permissions (
  permission_code TEXT PRIMARY KEY REFERENCES permissions(code)
);
INSERT INTO platform_only_permissions VALUES
  ('site.create'), ('org.manage'), ('license.manage'), ('edge.pair'), ('platform.admin');

CREATE OR REPLACE FUNCTION check_role_permission_scope() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM platform_only_permissions p WHERE p.permission_code = NEW.permission_code)
     AND (SELECT org_type FROM roles WHERE code = NEW.role_code) <> 'hq' THEN
    RAISE EXCEPTION 'permission % is HQ-only and cannot be given to role %', NEW.permission_code, NEW.role_code
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_role_permission_scope BEFORE INSERT OR UPDATE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION check_role_permission_scope();

INSERT INTO role_permissions (role_code, permission_code)
SELECT r, p FROM (VALUES
  ('hq_admin','site.create'),('hq_admin','org.manage'),('hq_admin','license.manage'),
  ('hq_admin','license.view'),('hq_admin','edge.pair'),('hq_admin','audit.view'),
  ('hq_ops','license.view'),('hq_ops','audit.view'),
  ('hq_finance','license.view'),('hq_finance','audit.view'),

  ('operator_admin','license.view'),('operator_admin','audit.view'),
  ('franchisee_owner','license.view'),('franchisee_owner','audit.view'),

  ('licensee_admin','site.view'),('licensee_admin','site.edit'),('licensee_admin','site.settings'),
  ('licensee_admin','rate.publish'),('licensee_admin','dashboard.view'),('licensee_admin','session.view'),
  ('licensee_admin','session.adjust'),('licensee_admin','gate.remote_open'),('licensee_admin','incident.handle'),
  ('licensee_admin','monthly.manage'),('licensee_admin','finance.view'),('licensee_admin','refund.request'),
  ('licensee_admin','refund.approve'),('licensee_admin','device.manage'),('licensee_admin','user.manage_org'),
  ('licensee_admin','license.view'),('licensee_admin','audit.view'),

  ('licensee_staff','site.view'),('licensee_staff','session.view'),('licensee_staff','gate.remote_open'),
  ('licensee_staff','incident.handle')
) AS t(r, p);

-- =====================================================================
-- 5. 授權帳號角色時防止越權
--   a. 角色必須屬於該組織的類型（加盟主拿不到總部角色）
--   b. 限縮的站點必須屬於該組織
--   c. 不能授權給自己
--   d. 授權者在同一組織要有 user.manage_org（總部 platform.admin 例外）
--   e. 授權者若只管某一站，只能授權該站
--   f. 新角色的權限不能超出授權者自己的權限
-- =====================================================================

CREATE OR REPLACE FUNCTION check_role_binding() RETURNS trigger AS $$
DECLARE
  v_org_type     TEXT;
  v_role_type    TEXT;
  v_granter_hq   BOOLEAN;
  v_has_manage   BOOLEAN;
BEGIN
  SELECT org_type INTO v_org_type FROM organizations WHERE id = NEW.org_id;
  SELECT org_type INTO v_role_type FROM roles WHERE code = NEW.role_code;
  IF v_org_type IS DISTINCT FROM v_role_type THEN
    RAISE EXCEPTION 'role % (%) does not belong to organization type %', NEW.role_code, v_role_type, v_org_type
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.site_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sites WHERE id = NEW.site_id AND org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'site does not belong to this organization';
  END IF;

  IF NEW.granted_by IS NULL THEN
    IF coalesce(current_setting('app.context', true), '') = 'request' THEN
      RAISE EXCEPTION 'granted_by is required' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;   -- 種子資料（建立第一位總部管理員）
  END IF;

  IF NEW.granted_by = NEW.user_id THEN
    RAISE EXCEPTION 'cannot grant a role to yourself' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 總部平台管理員可以替任何組織建立第一位管理員
  SELECT EXISTS (
    SELECT 1 FROM user_role_bindings b
    JOIN role_permissions rp ON rp.role_code = b.role_code
    WHERE b.user_id = NEW.granted_by AND b.revoked_at IS NULL AND rp.permission_code = 'platform.admin'
  ) INTO v_granter_hq;
  IF v_granter_hq THEN
    RETURN NEW;
  END IF;

  SELECT bool_or(true)
    INTO v_has_manage
  FROM user_role_bindings b
  JOIN role_permissions rp ON rp.role_code = b.role_code
  WHERE b.user_id = NEW.granted_by AND b.org_id = NEW.org_id
    AND b.revoked_at IS NULL AND rp.permission_code = 'user.manage_org';
  IF NOT coalesce(v_has_manage, false) THEN
    RAISE EXCEPTION 'granter cannot manage accounts of this organization' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 授權者若只管特定站點（沒有全組織的管理權），只能授權他管的那些站，且不能授權全組織
  IF NOT EXISTS (
       SELECT 1 FROM user_role_bindings b
       JOIN role_permissions rp ON rp.role_code = b.role_code
       WHERE b.user_id = NEW.granted_by AND b.org_id = NEW.org_id AND b.revoked_at IS NULL
         AND rp.permission_code = 'user.manage_org'
         AND (b.site_id IS NULL OR b.site_id = NEW.site_id)
     ) THEN
    RAISE EXCEPTION 'granter can only grant roles for their own site' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXISTS (
    SELECT permission_code FROM role_permissions WHERE role_code = NEW.role_code
    EXCEPT
    SELECT rp.permission_code FROM user_role_bindings b
    JOIN role_permissions rp ON rp.role_code = b.role_code
    WHERE b.user_id = NEW.granted_by AND b.org_id = NEW.org_id AND b.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'cannot grant a role with more permissions than your own' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_role_binding_check BEFORE INSERT OR UPDATE ON user_role_bindings
  FOR EACH ROW EXECUTE FUNCTION check_role_binding();

-- =====================================================================
-- 6. Row Level Security：站點、授權、帳號綁定（比照 0001 的 parking_sessions）
--   注意：資料表擁有者預設不受 RLS 限制。正式環境的應用程式要用獨立、非擁有者的資料庫帳號連線。
-- =====================================================================

ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_sites_tenant ON sites
  USING (
    current_setting('app.is_hq', true) = 'true'
    OR org_id::text = ANY (string_to_array(current_setting('app.org_ids', true), ','))
  );

ALTER TABLE site_licenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_licenses_tenant ON site_licenses
  USING (
    current_setting('app.is_hq', true) = 'true'
    OR org_id::text = ANY (string_to_array(current_setting('app.org_ids', true), ','))
  );

ALTER TABLE user_role_bindings ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_bindings_tenant ON user_role_bindings
  USING (
    current_setting('app.is_hq', true) = 'true'
    OR org_id::text = ANY (string_to_array(current_setting('app.org_ids', true), ','))
  );

COMMIT;
