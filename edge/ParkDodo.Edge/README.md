# ParkDodo Edge（場站工控機程式）

場站工控機只要用網路線接 ICE 車牌辨識攝影機：

```
ICE 相機 ──繼電器 IO1──▶ 柵欄機（開閘）
   │ ◀──IO 輸入 1───── 雷達「車輛已通過」
   │ ──RS-485──────▶ FK 顯示語音卡
   └──網路線──▶ 工控機（本程式）──網際網路──▶ ParkDodo 雲端
```

## 需要準備

1. Windows 10／11（64 位元），建議 IoT Enterprise LTSC
2. 工控機與相機在同一個網段（例：工控機 192.168.1.10，相機 192.168.1.100／101）
3. ICE SDK 的 DLL（廠商提供，**不放在 Git**）：把 SDK 裡 `ice_ipcsdk/bin`（64 位元版）全部檔案複製到本程式資料夾
   `ice_ipcsdk.dll`、`avutil-52.dll`、`hi_h264dec_w64.dll`、`swscale-2.dll`、`draw.dll`、`draw.ini`、`ice_decode.dll`、`zlibwapi.dll` 等

## 第一次安裝（約 10 分鐘）

1. 把 `ParkDodo.Edge-win-x64.zip` 解壓縮到 `C:\ParkDodo\Edge`，放入上面的 ICE DLL
2. 複製 `settings.example.json` 為 `settings.json`，把 `cloudUrl` 改成雲端網址
3. 後台「場站與設備 → 站點 → 配對工控機」，取得 8 位數配對碼（10 分鐘內有效）
4. 在 `C:\ParkDodo\Edge` 開啟「命令提示字元（系統管理員）」：
   ```
   ParkDodo.Edge.exe pair 12345678
   ```
   看到「✅ 已配對」就完成
5. 先手動試跑，確認相機連線、顯示卡有字：`ParkDodo.Edge.exe run`（Ctrl+C 結束）
6. 設定開機自動執行：`powershell -ExecutionPolicy Bypass -File .\install-service.ps1`

相機 IP、繼電器、雷達接哪個 IO，都在雲端後台的「車道與設備」設定（預設：開閘 IO1、雷達 IO 輸入 1、顯示卡位址 100），工控機會自動下載。

## 沒有設備時先測試（模擬模式）

`settings.json` 設 `"simulate": true`，執行 `run` 後用瀏覽器開 http://localhost:8787 ，輸入車牌模擬入場、出場、雷達通過。

## 斷網時

- 入場照常開閘；紀錄存在本機，網路恢復後自動補傳（不會重複）
- 出口：已付款（15 分鐘內）、月租車照常放行；免費時間內放行
- 斷網且未付款：預設不開閘並顯示「網路異常 請按對講」（`offlineUnpaidExit` 可改成 `open`＝放行並記錄待補收）
- 相機本身也可設定「斷網時比對月租白名單自行開閘」

## 常見問題

- **啟動時說找不到 ice_ipcsdk.dll 或載入失敗**：確認放的是 64 位元版 DLL，且整個 `bin` 資料夾的相依檔都在；若仍失敗，安裝 Microsoft Visual C++ 可轉散發套件（x64）。
- **相機一直離線**：工控機能不能 ping 到相機 IP；相機和工控機要在同一網段；防火牆允許程式連線。
- **顯示卡沒有字**：確認後台的顯示卡位址（出廠 100）與相機 RS-485 接線（A/B 是否接反）。
- **後台顯示「待配對」**：配對碼 10 分鐘內有效，過期請重新產生。

## 檔案位置

- 資料與日誌：`C:\ProgramData\ParkDodo\Edge`（`logs\` 每天一個檔，保留 30 天）
- 裝置金鑰：`device.key`（Windows DPAPI 加密，只有 SYSTEM 與系統管理員能讀）
- 待上傳：`outbox\events`（每筆一個檔）、`outbox\images`（照片，最多 2GB）

## 安全

- 只送 FK 顯示卡的顯示類指令；改地址、改波特率、音量、加解密等參數指令不會自動發送（廠商註明可能損壞硬體）
- 遠端開閘指令 30 秒內有效，逾時作廢，不會延遲開閘
- 更換工控機：後台重新產生配對碼並在新機器 pair，舊機器的金鑰立即失效
