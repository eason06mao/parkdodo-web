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
  - 南屯：408臺中市南屯區惠中里大墩十二街458號；沙鹿：433臺中市沙鹿區竹林里中山路128-33號。
    兩站 24 小時、約 30 格。車道數待確認。「中航站」只是早期示範資料。
- 電子發票字軌：兩站 2026 年 11–12 月已配號（各 50 本）。加值中心尚未決定（關貿或統一金流）。
- 時程：IPC 11/13 到貨；**攝影機、柵欄、車牌辨識 11/15 到貨測試；月底正式上線**。
- 網域：**parkdodo.tw**（Gandi 註冊）；公司信箱 **service@parkdodo.tw**（Gandi 信箱）。
- 公司網站（統一金流審核需要）：首頁＋隱私權／退款與申訴／服務條款，內容只改 `src/lib/siteContent.ts`。
  **維護方式：業主口頭告訴 Claude 要改什麼 → Claude 開 PR → 業主合併並部署正式站**（11/15 決定）。
  之後有正式後台登入再考慮做「官網內容」管理頁。客服電話暫不公開；LINE 官方帳號「候補」。

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
| | 測試站（已上線） | 正式站（已建置，尚未對外） |
|---|---|---|
| 專案 | parkdodo-staging | parkdodo-prod-tw（11/15 建立，資料庫高可用） |
| 網址 | staging.parkdodo.tw（原 parkdodo-staging-617659344056.asia-east1.run.app） | parkdodo.tw／www（官網）、pay.parkdodo.tw（繳費）、admin.parkdodo.tw（後台）；run.app 網址不對外使用 |
| 部署 | main 合併、自動檢查通過後自動部署 | Actions「部署正式站」手動 |
| 說明 | | `docs/production.md` |

正式站目前：統一金流仍為測試區（sandbox）、尚未設定正式金鑰與離線通知。
網域（11/15）：Google 已驗證 parkdodo.tw；Cloud Run 網址對應已建；Gandi DNS：A @ 216.239.32.21（Gandi 介面一筆只能一個值，
其餘 3 個 A 與 AAAA 暫不加，不影響使用）、CNAME www/pay/admin/staging → ghs.googlehosted.com.；
信箱相關記錄（MX、SPF、DMARC、gm1–3、mailsa、webmail、SRV、google-site-verification）不可動。
11/15 17:36 DomainRoutable=True，HTTPS 憑證發放中。
GitHub Variables（正式站）：PROD_GCP_PROJECT_ID、PROD_GCP_WIF_PROVIDER、PROD_GCP_DEPLOY_SA、PROD_CLOUDSQL_INSTANCE、PROD_EDGE_IMAGE_BUCKET；
GitHub Environment「production」需業主核准、只允許 main。
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
7. 網域憑證 Ready=True 後：確認統一金流導回／通知網址指向 pay.parkdodo.tw；之後才印場內 QR Code

## 七、已知缺口（上線前要補）
- 正式站建置腳本：後台密碼太短時直接結束，應改成重新輸入（小修）。
- **後台沒有正式帳號登入**：測試站靠整站門禁；正式站暫用 ADMIN_GATE 擋後台。需做個人帳號＋兩步驟驗證。
- 後台仍是示範資料的頁面：營運總覽、營收戰情板、例外處理、月租管理、帳號權限、場站與設備。
- 遠端開閘（後台「即時監控」與手機版 /m/gate）已接真實車道與工控機（PR #34）；尚無兩步驟驗證，
  正式站共用帳密時稽核一律記為 service@parkdodo.tw。
- 電子發票只建立待開立紀錄，尚未串接加值中心實際開立。
- 統一金流付款頁客服信箱仍是打錯的 gmail.cmm，要改成 service@parkdodo.tw（業主在統一金流後台改）。
- 網路建議改有線（IPC 目前用 Wi-Fi）。遠端工具：建議 RDP＋Tailscale，Chrome 遠端桌面備用；AnyDesk 免費版不能商用。

## 八、暫緩（等看過現場）
- 出口掃碼自動帶出車牌、柱子 QR Code 改良。
- 後台改版（設計稿已有：Main／Vehicle／Mobile／Monitor）。

## 九、計費規則
免費 10 分鐘；超過從入場起算，每 30 分鐘 30 元、未滿以 30 分鐘計（11–30 分收半小時、31 分起收 1 小時）；
付款後 15 分鐘內離場；當日上限每站可設（預設不設）。規則在 `src/lib/billing/fee.ts`，工控機同一套（測試向量比對）。
