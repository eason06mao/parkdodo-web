<?php
// 巢狀回傳（交易查詢 Result 陣列）的測試向量：用官方 SDK 加密，再用 SDK 的 ResultProcess 解回
require $argv[1];
$key = '12345678901234567890123456789012'; $iv = '1234567890123456';
$api = new \Payuni\Sdk\PayuniApi($key, $iv, 't');
$enc = new ReflectionMethod($api, 'Encrypt'); $enc->setAccessible(true);
$hash = new ReflectionMethod($api, 'HashInfo'); $hash->setAccessible(true);
$api->encryptInfo = ['Status' => 'SUCCESS', 'MerID' => 'ABC', 'Result' => [
  ['Status' => 'SUCCESS', 'Message' => '查詢成功', 'MerTradeNo' => 'PD0001', 'TradeNo' => '1700000000001', 'TradeAmt' => 120,
   'TradeStatus' => 1, 'PaymentType' => 1, 'DataSource' => 'A', 'PaymentDay' => '2026-10-22 01:20:00'],
  ['Status' => 'SUCCESS', 'MerTradeNo' => 'PD0002', 'TradeStatus' => 9, 'DataSource' => 'B'],
]];
$e = $enc->invoke($api);
$h = $hash->invoke($api, $e);
echo json_encode(['encryptInfo' => $e, 'hashInfo' => $h,
  'decrypted' => $api->ResultProcess(['Status' => 'SUCCESS', 'EncryptInfo' => $e, 'HashInfo' => $h])['message']['EncryptInfo']],
  JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
