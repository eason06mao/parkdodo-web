<?php
// 用官方 SDK（Apache-2.0）產生測試向量。key/iv 為 SDK README 的範例值，非真實金鑰。
require $argv[1];
$key = '12345678901234567890123456789012';
$iv  = '1234567890123456';
$cases = [
  ['MerID' => 'ABC', 'MerTradeNo' => 'PD20261021000001', 'TradeAmt' => 120, 'Timestamp' => 1792500000,
   'ProdDesc' => '停車費 中航站', 'ReturnURL' => 'https://example.com/pay/return?a=1&b=2', 'NotifyURL' => 'https://example.com/api/notify'],
  ['MerID' => 'ABC', 'TradeNo' => '16614190477810373246', 'Timestamp' => 1792500001],
  ['MerID' => 'ABC', 'Note' => "a b*c~d+e%f=g&h'i\"j", 'Empty' => '', 'Zero' => 0, 'Emoji' => '車'],
];
$api = new \Payuni\Sdk\PayuniApi($key, $iv, 't');
$enc = new ReflectionMethod($api, 'Encrypt'); $enc->setAccessible(true);
$hash = new ReflectionMethod($api, 'HashInfo'); $hash->setAccessible(true);
$out = [];
foreach ($cases as $c) {
  $api->encryptInfo = $c;
  $e = $enc->invoke($api);
  $out[] = ['input' => $c, 'query' => http_build_query($c), 'encryptInfo' => $e, 'hashInfo' => $hash->invoke($api, $e),
            'decrypted' => $api->ResultProcess(['Status' => 'SUCCESS', 'EncryptInfo' => $e, 'HashInfo' => $hash->invoke($api, $e)])['message']['EncryptInfo']];
}
echo json_encode(['key' => $key, 'iv' => $iv, 'cases' => $out], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
