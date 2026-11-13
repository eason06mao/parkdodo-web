import type { Metadata } from "next";
import Link from "next/link";
import { Chip } from "@/components/Chip";
import { getCurrentUser } from "@/lib/auth";
import { getSessions, getSiteRecords } from "@/lib/data";
import { dbConfigured } from "@/lib/db";
import { listSessions, SESSION_LIMIT, type SessionFilter } from "@/lib/sessionsDb";
import { formatDateTime, formatDuration, formatMoney } from "@/lib/format";
import type { ChipTone, SessionStatus, SessionType } from "@/lib/types";

export const metadata: Metadata = { title: "車輛進出紀錄" };

const TYPE_TONE: Record<SessionType, ChipTone> = { 臨停: "ok", 月租: "info", 特殊: "warn" };
const STATUS_TONE: Record<SessionStatus, ChipTone> = { 在場: "ok", 已出場: "neutral", 待確認: "warn" };

// 有雲端資料庫：讀真實紀錄（工控機入出場、後台補登、線上付款），篩選用網址參數（GET 表單）。
// 沒有資料庫（本機開發）：顯示示範資料。
export default async function SessionsPage({ searchParams }: { searchParams: Promise<SessionFilter> }) {
  const f = await searchParams;
  const live = dbConfigured();
  const rows = live
    ? await listSessions((await getSiteRecords(await getCurrentUser())).map((x) => x.code), f)
    : await getSessions();
  return (
    <main className="pd-main">
      <header className="pd-page-head">
        <div>
          <nav aria-label="路徑" className="pd-label"><Link href="/console">營運總覽</Link> ／ 車輛進出紀錄</nav>
          <h1 className="pd-page-title">車輛進出紀錄</h1>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="button" className="pd-btn">匯出 Excel</button>
          <Link href="/console/sessions/manual" className="pd-btn pd-btn--primary">補登入場紀錄</Link>
        </div>
      </header>

      <form role="search" aria-label="篩選紀錄" method="get" className="pd-card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="pd-grid pd-grid-4" style={{ gap: 14 }}>
          <div className="pd-field"><label htmlFor="plate">車牌號碼</label><input id="plate" name="plate" className="pd-input pd-input--plate" placeholder="ABC-1234 或 1234" defaultValue={f.plate ?? ""} /></div>
          <div className="pd-field"><label htmlFor="from">進場日期</label><input id="from" name="date" type="date" className="pd-input" defaultValue={f.date ?? ""} /></div>
          <div className="pd-field"><label htmlFor="status">車輛狀態</label><select id="status" name="status" className="pd-select" defaultValue={f.status ?? ""}><option value="">全部</option><option>目前在場</option><option>已出場</option><option>待確認</option></select></div>
          <div className="pd-field"><label htmlFor="type">身分</label><select id="type" name="type" className="pd-select" defaultValue={f.type ?? ""}><option value="">全部</option><option>臨停</option><option>月租</option><option>特殊通行</option></select></div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <span className="pd-label">{live ? "雲端資料庫・含工控機入出場、後台補登、線上付款" : "示範資料（未連線雲端資料庫）"}</span>
          <div style={{ display: "flex", gap: 10 }}>
            <Link href="/console/sessions" className="pd-btn">清除</Link>
            <button type="submit" className="pd-btn pd-btn--primary">搜尋</button>
          </div>
        </div>
      </form>

      <section aria-label="紀錄列表" className="pd-card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="pd-table-wrap">
          <table className="pd-table">
            <thead>
              <tr><th>車牌</th>{live && <th>站點</th>}<th>身分</th><th>進場</th><th>出場</th><th>停留</th><th className="pd-num">{live ? "已收" : "應收"}</th><th className="pd-num">折抵</th><th>付款方式</th><th>發票</th><th>狀態</th></tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={live ? 11 : 10} style={{ textAlign: "center", padding: 32, color: "var(--pd-muted)" }}>沒有符合條件的紀錄</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className="pd-plate">{r.plate}</span>
                    {r.source === "補登" && <span className="pd-label" style={{ display: "block" }}>後台補登</span>}
                  </td>
                  {live && <td>{r.siteName}</td>}
                  <td><Chip tone={TYPE_TONE[r.type]}>{r.type}</Chip></td>
                  <td className="pd-mono">{formatDateTime(r.entryAt)}</td>
                  <td className="pd-mono">{r.exitAt ? formatDateTime(r.exitAt) : "—"}</td>
                  <td className="pd-mono">{r.exitAt ? formatDuration(r.entryAt, r.exitAt) : "—"}</td>
                  <td className="pd-num">{r.fee !== undefined ? formatMoney(r.fee) : "—"}</td>
                  <td className="pd-num">{r.discount !== undefined ? formatMoney(r.discount) : "—"}</td>
                  <td>{r.method ?? "—"}</td>
                  <td className="pd-mono">{r.invoiceNo ?? "—"}</td>
                  <td><Chip tone={STATUS_TONE[r.status]}>{r.status}</Chip></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", flexWrap: "wrap", gap: 10 }}>
          <span className="pd-label">
            共 {rows.length} 筆{live && rows.length >= SESSION_LIMIT ? `・只顯示最新 ${SESSION_LIMIT} 筆，請用日期或車牌縮小範圍` : ""}
          </span>
        </div>
      </section>
    </main>
  );
}
