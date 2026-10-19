# ParkDodo V2 營運後台（Mock 資料版）

ParkDodo 停車營運中心的 Web 後台，依《ParkDodo V2 總規格 F 版》與《停車管理系統改版》設計稿實作。
目前全部使用 **Mock 資料**，不連接設備、金流或資料庫。

## 啟動

需要 Node.js 20 以上。

```bash
npm install
npm run dev          # 開發模式 http://localhost:3000
npm run build && npm start   # 正式建置
```

開啟 `http://localhost:3000` 會自動導向登入頁，按「登入」即可進入（Mock 不驗證帳密）。

要預覽「現金繳費機已啟用」的畫面：

```bash
NEXT_PUBLIC_FEATURE_CASH_KIOSK=true npm run dev
```

## 畫面

| 路由 | 畫面 |
| --- | --- |
| `/login` | 登入（總部／自營／加盟共用） |
| `/console` | 營運總覽 |
| `/console/monitor` | 即時監控（深色） |
| `/console/incidents` | 例外處理（清單＋詳情） |
| `/console/sessions` | 車輛進出紀錄 |
| `/console/monthly` | 月租管理 |
| `/console/analytics` | 營收與車輛戰情板（日／週／月／季＋自訂日期） |
| `/m/gate` | 手機版遠端開閘 |
| `POST /api/gate-commands` | 遠端開閘 Mock API（只驗證欄位，不控制設備） |

## 專案結構

```
src/
  app/                 頁面（Next.js App Router）
  components/          共用元件（側欄、車道卡、遠端開閘對話框…）
  lib/
    data.ts            資料存取層：畫面只呼叫這裡；接 API 時只改這個檔
    mock/data.ts       Mock 資料（車牌皆為範例格式）
    features.ts        功能開關（現金繳費機等）
    types.ts           型別，對應資料表
  styles/parkdodo-ui.css  設計系統（色票、字型、元件樣式）
docs/ui-design-spec.md    UI 設計規格
db/migrations/            PostgreSQL 資料表 Migration 草案（53 張表）
db/tests/                 資料表約束測試
edge/FkProtocol/          Edge 用 FK 顯示語音卡封包產生器（C#）
edge/FkProtocol.Tests/    以廠商 114 個真實封包驗證 CRC
```

## 檢查

```bash
npm run typecheck   # TypeScript
npm run lint        # ESLint
npm run build       # 正式建置
```

## 本機測試資料庫（Docker）

需要 Docker Desktop。資料庫只綁定 `127.0.0.1:5432`。

```bash
cp .env.example .env.local   # Windows：copy .env.example .env.local
npm run db:up        # 啟動 PostgreSQL 16
npm run db:migrate   # 在 parkdodo_dev 建立 53 張資料表
npm run db:test      # 用暫時的 pdtest 資料庫跑約束測試，最後應顯示 ALL CONSTRAINT TESTS PASSED
npm run db:reset     # 清空本機資料重來
```

不用 Docker、自己裝 PostgreSQL 16 的話，也可以手動執行：

```bash
createdb pdtest
psql -d pdtest -f db/migrations/0001_v2_core.sql
psql -d pdtest -f db/tests/0001_constraints_test.sql   # 最後應顯示 ALL CONSTRAINT TESTS PASSED
```

FK 封包測試（需要 .NET 8）：

```bash
cd edge/FkProtocol.Tests && dotnet run
```

## 下一步

1. 建立雲端 API，將 `src/lib/data.ts` 改為呼叫 API。
2. 登入改為伺服器端驗證＋MFA，`/console` 加上權限檢查。
3. 即時監控與例外清單改用 WebSocket 更新。
4. 接上統一金流 PAYUNi 沙箱與電子發票。
5. 尚未實作的頁面：財務與發票、場站與設備、帳號權限、官網。
