import type { Metadata } from "next";
import Link from "next/link";
import { Chip } from "@/components/Chip";
import { getSessions } from "@/lib/data";
import { formatDateTime, formatDuration, formatMoney } from "@/lib/format";
import type { ChipTone, SessionStatus, SessionType } from "@/lib/types";

export const metadata: Metadata = { title: "車輛進出紀錄" };

const TYPE_TONE: Record<SessionType, ChipTone> = { 臨停: "ok", 月租: "info", 特殊: "warn" };
const STATUS_TONE: Record<SessionStatus, ChipTone> = { 在場: "ok", 已出場: "neutral", 待確認: "warn" };

export default async function SessionsPage() {
  const rows = await getSessions();
  return (
    <main className="pd-main">
      <header className="pd-page-head">
        <div>
          <nav aria-label="路徑" className="pd-label"><Link href="/console">營運總覽</Link> ／ 車輛進出紀錄</nav>
          <h1 className="pd-page-title">車輛進出紀錄</h1>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="button" className="pd-btn">匯出 Excel</button>
          <button type="button" className="pd-btn pd-btn--primary">補登入場紀錄</button>
        </div>
      </header>

      <form role="search" aria-label="篩選紀錄" className="pd-card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="pd-grid pd-grid-4" style={{ gap: 14 }}>
          <div className="pd-field"><label htmlFor="plate">車牌號碼</label><input id="plate" className="pd-input pd-input--plate" placeholder="ABC-1234" /></div>
          <div className="pd-field"><label htmlFor="from">進場日期</label><input id="from" type="date" className="pd-input" defaultValue="2026-10-18" /></div>
          <div className="pd-field"><label htmlFor="status">車輛狀態</label><select id="status" className="pd-select"><option>全部</option><option>目前在場</option><option>已出場</option><option>待確認</option></select></div>
          <div className="pd-field"><label htmlFor="type">身分</label><select id="type" className="pd-select"><option>全部</option><option>臨停</option><option>月租</option><option>特殊通行</option></select></div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Chip>需人工介入</Chip><Chip>有折抵</Chip><Chip>已開發票</Chip>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="reset" className="pd-btn">清除</button>
            <button type="submit" className="pd-btn pd-btn--primary">搜尋</button>
          </div>
        </div>
      </form>

      <section aria-label="紀錄列表" className="pd-card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="pd-table-wrap">
          <table className="pd-table">
            <thead>
              <tr><th>車牌</th><th>身分</th><th>進場</th><th>出場</th><th>停留</th><th className="pd-num">應收</th><th className="pd-num">折抵</th><th>付款方式</th><th>發票</th><th>狀態</th><th><span className="pd-sr-only">操作</span></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><span className="pd-plate">{r.plate}</span></td>
                  <td><Chip tone={TYPE_TONE[r.type]}>{r.type}</Chip></td>
                  <td className="pd-mono">{formatDateTime(r.entryAt)}</td>
                  <td className="pd-mono">{r.exitAt ? formatDateTime(r.exitAt) : "—"}</td>
                  <td className="pd-mono">{r.exitAt ? formatDuration(r.entryAt, r.exitAt) : "—"}</td>
                  <td className="pd-num">{r.fee !== undefined ? formatMoney(r.fee) : "—"}</td>
                  <td className="pd-num">{r.discount !== undefined ? formatMoney(r.discount) : "—"}</td>
                  <td>{r.method ?? "—"}</td>
                  <td className="pd-mono">{r.invoiceNo ?? "—"}</td>
                  <td><Chip tone={STATUS_TONE[r.status]}>{r.status}</Chip></td>
                  <td><Link href="#">查看</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", flexWrap: "wrap", gap: 10 }}>
          <span className="pd-label">共 {rows.length} 筆・每頁 50 筆</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="pd-btn" aria-label="上一頁" disabled>‹</button>
            <button type="button" className="pd-btn" aria-label="下一頁" disabled>›</button>
          </div>
        </div>
      </section>
    </main>
  );
}
