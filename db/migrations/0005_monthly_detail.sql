-- ParkDodo V2 Migration 0005：月租建檔欄位
--   客戶：個人／公司、公司名稱、統編、地址、備註
--   車輛：汽車／機車、廠牌、顏色
--   合約：啟用日（車牌開通日，可早於生效日）、期數、月費、折扣、押金、付款、發票、續約提醒、車位
-- 規則：啟用日不能晚於到期日；工控機白名單以「啟用日～到期日、狀態 active」為準（未付款＝pending 不開通）。
BEGIN;

ALTER TABLE customers
  ADD COLUMN customer_type   TEXT NOT NULL DEFAULT 'person' CHECK (customer_type IN ('person', 'company')),
  ADD COLUMN company_name    TEXT,
  ADD COLUMN tax_id          TEXT CHECK (tax_id IS NULL OR tax_id ~ '^\d{8}$'),
  ADD COLUMN contact_address TEXT,
  ADD COLUMN note            TEXT;
ALTER TABLE customers ADD CONSTRAINT customer_company_fields
  CHECK (customer_type = 'person' OR (company_name IS NOT NULL AND tax_id IS NOT NULL));

ALTER TABLE vehicles
  ADD COLUMN brand TEXT,
  ADD COLUMN color TEXT;

ALTER TABLE monthly_contracts
  ADD COLUMN activates_on    DATE,
  ADD COLUMN months          INT CHECK (months IS NULL OR months > 0),
  ADD COLUMN monthly_fee     BIGINT CHECK (monthly_fee IS NULL OR monthly_fee >= 0),
  ADD COLUMN discount        BIGINT NOT NULL DEFAULT 0 CHECK (discount >= 0),
  ADD COLUMN discount_reason TEXT,
  ADD COLUMN deposit         BIGINT NOT NULL DEFAULT 0 CHECK (deposit >= 0),
  ADD COLUMN payment_method  TEXT CHECK (payment_method IS NULL OR payment_method IN ('cash', 'transfer', 'card', 'online')),
  ADD COLUMN payment_status  TEXT NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid', 'unpaid')),
  ADD COLUMN payment_ref     TEXT,
  ADD COLUMN paid_at         TIMESTAMPTZ,
  ADD COLUMN invoice         JSONB,
  ADD COLUMN remind_days     INT NOT NULL DEFAULT 14 CHECK (remind_days BETWEEN 0 AND 60),
  ADD COLUMN space_label     TEXT,
  ADD COLUMN note            TEXT,
  ADD COLUMN created_by      UUID REFERENCES users(id);
ALTER TABLE monthly_contracts ADD CONSTRAINT monthly_activation_range
  CHECK (activates_on IS NULL OR activates_on <= ends_on);
ALTER TABLE monthly_contracts ADD CONSTRAINT monthly_discount_reason
  CHECK (discount = 0 OR discount_reason IS NOT NULL);
-- 未付款不能是 active（避免沒付錢就開通）
ALTER TABLE monthly_contracts ADD CONSTRAINT monthly_paid_before_active
  CHECK (status <> 'active' OR payment_status = 'paid');

-- 同一站點、同一車位在重疊期間只能有一份有效合約
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE monthly_contracts ADD CONSTRAINT monthly_space_no_overlap EXCLUDE USING gist (
  site_id WITH =, space_label WITH =,
  daterange(COALESCE(activates_on, starts_on), ends_on, '[]') WITH &&
) WHERE (space_label IS NOT NULL AND status IN ('pending', 'active'));

-- 月租合約變更 → 通知工控機重新下載白名單
CREATE TRIGGER trg_edge_cfg_monthly AFTER INSERT OR UPDATE OR DELETE ON monthly_contracts
  FOR EACH ROW EXECUTE FUNCTION bump_edge_config();

COMMIT;
