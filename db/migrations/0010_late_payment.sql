-- 0010 逾期訂單的晚到付款：車主在付款頁停留太久、訂單已標為逾期，統一金流之後仍通知「已付款」時，
-- 錢已經收到，必須能入帳（之後由後台判斷是否重複付款、需要退款）。
INSERT INTO payment_order_transitions VALUES ('expired', 'paid') ON CONFLICT DO NOTHING;
