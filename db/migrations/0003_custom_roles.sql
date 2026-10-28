-- ParkDodo V2 Migration 0003：自訂角色
-- 前提：已執行 0001、0002
--
-- 各組織的管理員可以自訂角色、逐項開放功能；限定可管理的站點則在「指派角色」時設定（user_role_bindings.site_id）。
-- 規則：
--   1. 系統預設角色（org_id IS NULL）不能在請求中修改。
--   2. 自訂角色屬於一個組織，只能指派給該組織的帳號；角色類型必須與組織類型一致。
--   3. 建立或修改自訂角色需要「全組織」的 role.manage（只管單一站點的主管不行）；放進角色的每一項權限，修改者自己都要有（總部平台管理員例外）。
--   4. 「僅總部」權限（0002 的 platform_only_permissions）仍然不能放進非總部角色。
--   5. 還有人在用的角色不能封存；封存後不能再指派。
--   6. 自訂角色一律不能有 platform.admin（總部的自訂角色也一樣）。
-- 請求身分沿用 0002 的 app.context／app.user_id／app.is_hq／app.org_ids。

BEGIN;

ALTER TABLE roles
  ADD COLUMN org_id      UUID REFERENCES organizations(id),
  ADD COLUMN is_system   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN created_by  UUID REFERENCES users(id),
  ADD COLUMN created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN archived_at TIMESTAMPTZ;
ALTER TABLE roles ADD CONSTRAINT role_system_has_no_org CHECK (is_system = (org_id IS NULL));
CREATE UNIQUE INDEX uq_custom_role_name ON roles(org_id, name) WHERE org_id IS NOT NULL AND archived_at IS NULL;
CREATE INDEX ix_roles_org ON roles(org_id) WHERE org_id IS NOT NULL;

INSERT INTO permissions (code, description) VALUES ('role.manage', '建立與修改本組織的自訂角色');
INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('hq_admin', 'role.manage'), ('operator_admin', 'role.manage'),
  ('franchisee_owner', 'role.manage'), ('licensee_admin', 'role.manage');

-- 目前請求的登入者在某組織是否有某權限（總部平台管理員一律有）。
-- p_org_wide = true 時，只算「全組織」的指派（只管單一站點的人不算）。
CREATE OR REPLACE FUNCTION app_actor_has(p_perm TEXT, p_org UUID, p_org_wide BOOLEAN DEFAULT false) RETURNS BOOLEAN AS $$
  WITH me AS (SELECT nullif(current_setting('app.user_id', true), '')::uuid AS id)
  SELECT EXISTS (
    SELECT 1 FROM user_role_bindings b JOIN role_permissions rp ON rp.role_code = b.role_code, me
    WHERE b.user_id = me.id AND b.revoked_at IS NULL AND rp.permission_code = 'platform.admin'
  ) OR EXISTS (
    SELECT 1 FROM user_role_bindings b JOIN role_permissions rp ON rp.role_code = b.role_code, me
    WHERE b.user_id = me.id AND b.org_id = p_org AND b.revoked_at IS NULL AND rp.permission_code = p_perm
      AND (NOT p_org_wide OR b.site_id IS NULL)
  );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_in_request() RETURNS BOOLEAN AS $$
  SELECT coalesce(current_setting('app.context', true), '') = 'request';
$$ LANGUAGE sql STABLE;

-- 角色本身：類型一致、系統角色鎖定、需要 role.manage、封存前不能有人在用
CREATE OR REPLACE FUNCTION guard_role_write() RETURNS trigger AS $$
DECLARE v_org_type TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF app_in_request() THEN RAISE EXCEPTION 'roles cannot be deleted; archive instead' USING ERRCODE = 'insufficient_privilege'; END IF;
    RETURN OLD;
  END IF;

  IF NEW.org_id IS NOT NULL THEN
    SELECT org_type INTO v_org_type FROM organizations WHERE id = NEW.org_id;
    IF v_org_type IS DISTINCT FROM NEW.org_type THEN
      RAISE EXCEPTION 'custom role type % must match organization type %', NEW.org_type, v_org_type;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.org_type IS DISTINCT FROM OLD.org_type OR NEW.is_system IS DISTINCT FROM OLD.is_system THEN
      RAISE EXCEPTION 'role organization and type cannot be changed';
    END IF;
    IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'archived role cannot be modified';
    END IF;
    IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM user_role_bindings WHERE role_code = NEW.code AND revoked_at IS NULL) THEN
      RAISE EXCEPTION 'role % is still assigned; revoke it from all accounts before archiving', NEW.code;
    END IF;
    NEW.updated_at := now();
  END IF;

  IF app_in_request() THEN
    IF NEW.org_id IS NULL THEN
      RAISE EXCEPTION 'system roles cannot be changed' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT app_actor_has('role.manage', NEW.org_id, true) THEN
      RAISE EXCEPTION 'you cannot manage roles of this organization' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_role_guard BEFORE INSERT OR UPDATE OR DELETE ON roles
  FOR EACH ROW EXECUTE FUNCTION guard_role_write();

-- 角色的權限清單：請求中只能改自訂角色，且只能放自己有的權限
CREATE OR REPLACE FUNCTION guard_role_permission_write() RETURNS trigger AS $$
DECLARE r roles%ROWTYPE;
BEGIN
  SELECT * INTO r FROM roles WHERE code = COALESCE(NEW.role_code, OLD.role_code);
  -- 平台管理（platform.admin）只留給系統預設的總部管理員，自訂角色一律不能有
  IF TG_OP IN ('INSERT', 'UPDATE') AND r.org_id IS NOT NULL AND NEW.permission_code = 'platform.admin' THEN
    RAISE EXCEPTION 'platform.admin cannot be given to a custom role' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT app_in_request() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF r.org_id IS NULL THEN
    RAISE EXCEPTION 'system role permissions cannot be changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF r.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'archived role cannot be modified' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT app_actor_has('role.manage', r.org_id, true) THEN
    RAISE EXCEPTION 'you cannot manage roles of this organization' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NOT app_actor_has(NEW.permission_code, r.org_id) THEN
    RAISE EXCEPTION 'you cannot add permission % because you do not have it', NEW.permission_code
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_role_permission_guard BEFORE INSERT OR UPDATE OR DELETE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION guard_role_permission_write();

-- 指派角色：自訂角色只能指派給所屬組織；封存的角色不能再指派
CREATE OR REPLACE FUNCTION check_custom_role_binding() RETURNS trigger AS $$
DECLARE r roles%ROWTYPE;
BEGIN
  SELECT * INTO r FROM roles WHERE code = NEW.role_code;
  IF r.archived_at IS NOT NULL AND NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'role % is archived', NEW.role_code USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF r.org_id IS NOT NULL AND r.org_id <> NEW.org_id THEN
    RAISE EXCEPTION 'custom role % belongs to another organization', NEW.role_code USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_role_binding_custom BEFORE INSERT OR UPDATE ON user_role_bindings
  FOR EACH ROW EXECUTE FUNCTION check_custom_role_binding();

-- 自訂角色的 RLS：只看得到系統角色與自己組織的自訂角色
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_roles_tenant ON roles
  USING (
    org_id IS NULL
    OR current_setting('app.is_hq', true) = 'true'
    OR org_id::text = ANY (string_to_array(current_setting('app.org_ids', true), ','))
  );

COMMIT;
