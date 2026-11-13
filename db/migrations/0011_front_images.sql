-- 0011：繳費頁認車用的「車牌＋車頭」裁切照片（由入場的整張照與車牌特寫自動產生）
ALTER TABLE event_images DROP CONSTRAINT IF EXISTS event_images_kind_check;
ALTER TABLE event_images ADD CONSTRAINT event_images_kind_check CHECK (kind IN ('plate', 'full', 'front'));
