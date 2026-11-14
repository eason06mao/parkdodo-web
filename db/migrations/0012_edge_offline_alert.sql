-- 0012：工控機離線通知。offline_alerted_at 有值＝已寄過離線通知、尚未恢復（避免每分鐘重複寄）
ALTER TABLE edge_gateways ADD COLUMN IF NOT EXISTS offline_alerted_at TIMESTAMPTZ;
