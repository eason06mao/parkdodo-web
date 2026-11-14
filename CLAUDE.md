# ParkDodo V2：專案需求與目前狀態（每次工作前先讀）

> 這份是唯一的「目前狀態總表」。對話很長時會忘記細節，**以這份為準**；有變動就更新這份。
> 最後更新：2026-11-15

## 一、溝通與工作規則
- **一律用繁體中文回覆**，用詞以業主看得懂為準（業主不是工程師）。
- **一次只做一件事**。給指令前說清楚驗證程度：本機實際跑過／只檢查語法／未驗證。
  Google Cloud、IPC 上的腳本我無法先實跑，請業主先用「只讀取、不改東西」的指令確認，再執行會改東西的。
- **有官方文件先查文件**：統一金流文件在對話附件（UPP Ver 2.0 等 PDF），測試方式整理在 `docs/payuni-testing.md`。
- 改程式一律開 PR，不直接改 main；合併由業主按。commit／PR 結尾加 Claude 署名。
- 不代為登入、不輸入密碼、不貼金鑰；金鑰只放 Secret Manager，由業主用腳本輸入（畫面不顯示）。
  曾外流的密碼要立即更換。不重述業主貼過的金鑰或產品序號。
- 政府、金流平台上的「送出」動作（例如電子發票取號）要業主明確同意；我只查看。
- 不自動送 FK 參數指令（0x45、0x56、0xF0、0xF2–0xF4、0xF8），只送顯示指令。車牌只用範例。
- 不推薦 Windows 破解、KMS 工具；廠商 DLL 不放進 Git。

## 二、公司與場站
- 公司：車格跳動有限公司（統編 62171653，臺中市西區大昌街216號1樓，中區國稅局）。
- 兩個營運站（同公司、各自統編開發票）：
  - 台中南屯停車場：統編 61079159，代號 **TXG001**
  - 台中沙鹿停車場：統編 61082892，代號 **TXG002**
  - 地址、車位數、車道數待業主提供。「中航站」只是早期示範資料。
- 電子發票字軌：兩站 2026 年 11–12 月已配號（各 50 本）。加值中心尚未決定（關貿或統一金流）。
- 時程：IPC 11/13 到貨；**攝影機、柵欄、車牌辨識 11/15 到貨測試；月底正式上線**。
- 網域：**parkdodo.tw**（Gandi 註冊）；公司信箱 **service@parkdodo.tw**（Gandi 信箱）。

## 三、系統組成
- 雲端：Next.js 15＋PostgreSQL 16（Cloud SQL），部署在 Google Cloud Run（台灣 asia-east1）。
- 工控機（IPC）：Windows 11 IoT Enterprise LTSC，C# .NET 8 程式 `ParkDodo.Edge`（`edge/`），
  裝在 `D:\parkdodo\Edge`，資料與日誌在 `C:\ProgramData\ParkDodo\Edge`（logs 保留 30 天）。
  IPC 本機不用資料庫（斷電安全）：設定副本 config.json、待上傳事件 outbox、日誌。
- 設備：ICE 車牌辨識攝影機（64 位元 SDK DLL 已放進 Edge 資料夾）、FK 顯示語音卡（經攝影機 RS-485）、
  柵欄由攝影機繼電器控制、雷達「已通過」接攝影機 IO。
- 金流：統一金流 PAYUNi UPP。測試商店 S036124799（測試區）。正式商店尚未開通。
- IPC 硬體：AMI Aptio BIOS、IT8786 Super IO、4 個 Intel I226-V 網路孔。

## 四、環境
| | 測試站（已上線） | 正式站（建置中） |
|---|---|---|
| 專案 | parkdodo-staging | parkdodo-prod-tw（尚未建立成功） |
| 網址 | parkdodo-staging-617659344056.asia-east1.run.app（之後 staging.parkdodo.tw） | pay.parkdodo.tw、admin.parkdodo.tw |
| 部署 | main 合併、自動檢查通過後自動部署 | Actions「部署正式站」手動 |
| 說明 | | `docs/production.md` |

GitHub Variables（測試站）：GCP_*、CLOUDSQL_INSTANCE、EDGE_IMAGE_BUCKET、PAYUNI_SECRETS=on、
PAYUNI_METHODS=Credit,ApplePay,GooglePay,SamsungPay,LinePay,JKoPay、ALERTS=on。

## 五、已完成且實測過
- 車主繳費頁：完整車牌（可省略 -）／只打數字選車、免費提示「請盡速離場」、付款失敗可換卡、只列已開通的付款方式。
- 統一金流測試區：信用卡付款成功（測試卡 4147 6310 0000 0001）、授權失敗頁、LINE Pay／街口／Samsung Pay 已開通。
- IPC：配對 TXG001、開機自動執行（排程「ParkDodo Edge」）、兩層軟體 watchdog、停電後自動開機（BIOS）、
  開機時沒網路先用本機模式並自動補傳、日誌主控台不阻塞。
- 工控機離線 2 分鐘寄信到 service@parkdodo.tw（已實測收到）。
- 後台「車輛進出紀錄」讀真實資料。

## 六、還沒驗證（上線前必做）
1. 付款成功 → 出口**自動開閘**（KB-7788，模擬器）
2. 11/15 實車：進場、付款、出場；量測辨識到開閘、付款速度
3. 離線通知的「已恢復連線」那封信
4. BIOS 硬體 watchdog：曾因沒有程式「餵」它，IPC 每 4 分鐘重開；已請業主關閉，需確認開機時間不再變動。
   之後找原廠工具再開。
5. 車頭照片裁切（需實際攝影機照片）
6. 正式站：真卡小額付款＋退款

## 七、已知缺口（上線前要補）
- **後台沒有正式帳號登入**：測試站靠整站門禁；正式站暫用 ADMIN_GATE 擋後台。需做個人帳號＋兩步驟驗證。
- 後台仍是示範資料的頁面：營運總覽、營收戰情板、例外處理、即時監控、月租管理、帳號權限。
- 電子發票只建立待開立紀錄，尚未串接加值中心實際開立。
- 統一金流付款頁客服信箱仍是打錯的 gmail.cmm，要改成 service@parkdodo.tw（業主在統一金流後台改）。
- 網路建議改有線（IPC 目前用 Wi-Fi）。遠端工具：建議 RDP＋Tailscale，Chrome 遠端桌面備用；AnyDesk 免費版不能商用。

## 八、暫緩（等看過現場）
- 出口掃碼自動帶出車牌、柱子 QR Code 改良。
- 後台改版（設計稿已有：Main／Vehicle／Mobile／Monitor）。

## 九、計費規則
免費 10 分鐘；超過從入場起算，每 30 分鐘 30 元、未滿以 30 分鐘計（11–30 分收半小時、31 分起收 1 小時）；
付款後 15 分鐘內離場；當日上限每站可設（預設不設）。規則在 `src/lib/billing/fee.ts`，工控機同一套（測試向量比對）。
