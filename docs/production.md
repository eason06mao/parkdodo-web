# 正式站與測試站

同一套程式，兩個完全分開的 Google Cloud 專案。

| | 測試站 | 正式站 |
|---|---|---|
| 專案 | parkdodo-staging | 自訂（例：parkdodo-prod-tw） |
| 服務 | parkdodo-staging | parkdodo |
| 網址 | staging.parkdodo.tw | pay.parkdodo.tw（車主）、admin.parkdodo.tw（後台） |
| 部署 | main 合併、自動檢查通過後自動部署 | Actions →「部署正式站」手動執行，確認自動檢查已通過 |
| 資料 | 測試種子資料（`--seed`） | 正式基本資料（`--seed=prod`，沒有示範資料） |
| 門禁 | 整站需要測試站帳密 | 後台需要管理帳密（`ADMIN_GATE`）；繳費、會員、工控機公開 |
| 資料庫 | 單機、備份 7 天 | 高可用、備份 30 天、可回復到任一時間點、防誤刪 |
| 網站 | 沒人用時關機 | 至少 1 台常駐 |
| 統一金流 | 測試區 | 正式商店（`PROD_PAYUNI_ENV=production` 才會真的扣款） |

## 建置順序（Cloud Shell）
1. `bash scripts/gcp-prod-setup.sh <正式站專案ID>`，照最後的說明新增 GitHub Variables 與 production 環境
2. Actions →「部署正式站」→ Run workflow（輸入「部署」）
3. `bash scripts/gcp-domain-setup.sh <正式站專案ID>`，照畫面在 Gandi 驗證網域、加 CNAME
4. GitHub Variables 設 `PROD_PUBLIC_BASE_URL=https://pay.parkdodo.tw`，再部署一次
5. 正式金鑰：`bash scripts/gcp-payuni-secrets.sh <正式站專案ID>`，設 `PROD_PAYUNI_SECRETS=on`、`PROD_PAYUNI_METHODS`
6. 離線通知：`bash scripts/gcp-alerts-setup.sh <正式站專案ID> parkdodo`，設 `PROD_ALERTS=on`
7. 真卡小額付款＋退款驗證後，設 `PROD_PAYUNI_ENV=production`，再部署一次

## 上線前必須完成
- **後台正式帳號登入（含兩步驟驗證）**：目前後台只有門禁帳密＋預覽身分，正式營運前要換成每個人自己的帳號
- 工控機改連正式站：後台產生配對碼，`settings.json` 的 cloudUrl 改成正式站網址後重新配對
