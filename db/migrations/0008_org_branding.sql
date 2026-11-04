-- 0008 組織品牌（白牌）：加盟主、系統客戶可以自訂後台左上角的名稱、副標題、Logo 與主題色；
-- 車主看到的繳費頁、會員頁也會用該站所屬組織的品牌。
-- organizations.code 對應程式裡的組織代碼（例如 org-hq），在組織管理搬到資料庫前用來對應。

ALTER TABLE organizations ADD COLUMN code TEXT UNIQUE;
UPDATE organizations SET code = 'org-hq' WHERE id = '00000000-0000-4000-8000-000000000001' AND code IS NULL;

INSERT INTO permissions (code, description) VALUES ('brand.manage', '修改本組織品牌：名稱、副標題、Logo、主題色')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_code, permission_code)
SELECT r, 'brand.manage' FROM (VALUES ('hq_admin'), ('operator_admin'), ('franchisee_owner'), ('licensee_admin')) AS t(r)
WHERE EXISTS (SELECT 1 FROM roles WHERE code = t.r)
ON CONFLICT DO NOTHING;

CREATE TABLE org_branding (
  org_id        UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 20),
  subtitle      TEXT NOT NULL DEFAULT '' CHECK (char_length(subtitle) <= 20),
  accent_color  TEXT CHECK (accent_color ~ '^#[0-9A-F]{6}$'),          -- NULL＝預設色
  logo          BYTEA CHECK (logo IS NULL OR octet_length(logo) <= 524288),   -- 最大 512 KB
  logo_type     TEXT CHECK (logo_type IN ('image/png', 'image/jpeg', 'image/webp')),
  logo_hash     TEXT,                                                -- 網址版本，換圖後瀏覽器重新下載
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT,
  CHECK ((logo IS NULL) = (logo_type IS NULL))
);
