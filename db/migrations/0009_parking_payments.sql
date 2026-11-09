-- 0009 停車繳費串接統一金流（PAYUNi）
-- 1. 每站各自的開票營業人（同一家公司的不同營業據點，各有統編，例如台中南屯停車場、台中沙鹿停車場）
-- 2. 付款訂單記下車牌、發票選擇、會員；付款成功後建立待開立的發票紀錄（開立主體＝該站統編）

ALTER TABLE sites ADD COLUMN invoice_seller_tax_id TEXT CHECK (invoice_seller_tax_id ~ '^\d{8}$');
ALTER TABLE sites ADD COLUMN invoice_seller_name   TEXT;

ALTER TABLE payment_orders ADD COLUMN plate_no        TEXT;
ALTER TABLE payment_orders ADD COLUMN invoice_request JSONB;          -- 車主選的發票方式（統編、Email、載具等），開立發票時使用
ALTER TABLE payment_orders ADD COLUMN member_id       UUID REFERENCES members(id);

ALTER TABLE invoice_records ADD COLUMN issuer_tax_id TEXT CHECK (issuer_tax_id ~ '^\d{8}$');
ALTER TABLE invoice_records ADD COLUMN issuer_name   TEXT;
ALTER TABLE invoice_records ADD COLUMN member_id     UUID REFERENCES members(id);

-- 待確認的訂單（付款中、結果不明）由背景查詢補齊
CREATE INDEX ix_payment_orders_status ON payment_orders(status, created_at) WHERE status IN ('created', 'pending', 'unknown');
