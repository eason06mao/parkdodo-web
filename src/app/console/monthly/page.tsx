import type { Metadata } from "next";
import Link from "next/link";
import { Chip } from "@/components/Chip";
import { getContracts } from "@/lib/data";
import type { ChipTone, ContractStatus } from "@/lib/types";

export const metadata: Metadata = { title: "月租管理" };

const STATUS_TONE: Record<ContractStatus, ChipTone> = { 有效: "ok", 即將到期: "warn", 已過期: "neutral" };
const md = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}`;

export default async function MonthlyPage() {
  const rows = await getContracts();
  const fixed = rows.filter((r) => r.plan === "固定車位" && r.status !== "已過期").length;
  const shared = rows.filter((r) => r.plan === "共用月租" && r.status !== "已過期").length;
  const expiring = rows.filter((r) => r.status === "即將到期").length;

  return (
    <main className="pd-main">
      <header className="pd-page-head">
        <div>
          <nav aria-label="路徑" className="pd-label"><Link href="/console">營運總覽</Link> ／ 月租管理</nav>
          <h1 className="pd-page-title">月租管理</h1>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="button" className="pd-btn">匯入名單</button>
          <button type="button" className="pd-btn">下載範本</button>
          <button type="button" className="pd-btn pd-btn--primary">新增月租</button>
        </div>
      </header>

      <section aria-label="月租概況" className="pd-grid pd-grid-4">
        <div className="pd-card"><div className="pd-label">固定車位（有效）</div><div style={{ marginTop: 8 }}><span className="pd-mono" style={{ fontSize: 32, fontWeight: 600 }}>{fixed}</span><span className="pd-label"> 份</span></div></div>
        <div className="pd-card"><div className="pd-label">共用月租（有效）</div><div style={{ marginTop: 8 }}><span className="pd-mono" style={{ fontSize: 32, fontWeight: 600 }}>{shared}</span><span className="pd-label"> 份</span></div><div className="pd-label" style={{ marginTop: 6 }}>保留車位 0 格（場站設定）</div></div>
        <div className="pd-card pd-card--warn"><div className="pd-label" style={{ color: "var(--pd-warn-ink)" }}>14 天內到期</div><div style={{ marginTop: 8 }}><span className="pd-mono" style={{ fontSize: 32, fontWeight: 600, color: "var(--pd-warn-ink)" }}>{expiring}</span><span className="pd-label"> 份</span></div><Link href="#" style={{ display: "inline-block", marginTop: 6, fontSize: 14, color: "var(--pd-warn-ink)" }}>發送續約提醒 →</Link></div>
        <div className="pd-card"><div className="pd-label">候補名單</div><div style={{ marginTop: 8 }}><span className="pd-mono" style={{ fontSize: 32, fontWeight: 600 }}>0</span><span className="pd-label"> 人</span></div></div>
      </section>

      <div className="pd-split">
        <section aria-label="月租合約" className="pd-card" style={{ flex: "999 1 640px", minWidth: 0, padding: 0, overflow: "hidden" }}>
          <form role="search" aria-label="篩選月租" style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: "16px 18px", borderBottom: "1px solid var(--pd-line-soft)", alignItems: "flex-end" }}>
            <div className="pd-field" style={{ flex: "1 1 200px" }}><label htmlFor="q">搜尋車牌或姓名</label><input id="q" className="pd-input" placeholder="ABC-1234 或 王小明" /></div>
            <div className="pd-field" style={{ flex: "0 1 160px" }}><label htmlFor="plan">方案</label><select id="plan" className="pd-select"><option>全部</option><option>固定車位</option><option>共用月租</option></select></div>
            <div className="pd-field" style={{ flex: "0 1 160px" }}><label htmlFor="st">狀態</label><select id="st" className="pd-select"><option>全部</option><option>有效</option><option>即將到期</option><option>已過期</option></select></div>
          </form>
          <div className="pd-table-wrap">
            <table className="pd-table">
              <thead><tr><th>車主</th><th>車牌</th><th>方案</th><th>車位</th><th>期間</th><th>在場</th><th>狀態</th><th><span className="pd-sr-only">操作</span></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.owner}</td>
                    <td><span className="pd-plate">{r.plate}</span></td>
                    <td><Chip tone={r.plan === "固定車位" ? "info" : "ok"}>{r.plan}</Chip></td>
                    <td className="pd-mono">{r.space ?? "—"}</td>
                    <td className="pd-mono">{md(r.startsOn)} – {md(r.endsOn)}</td>
                    <td>{r.inside ? "在場" : "未進場"}</td>
                    <td><Chip tone={STATUS_TONE[r.status]}>{r.status}</Chip></td>
                    <td><Link href="#">管理</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside aria-labelledby="rule-h" className="pd-card" style={{ flex: "1 1 300px", maxWidth: 360, display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 id="rule-h" className="pd-serif" style={{ margin: 0, fontSize: 18 }}>本站月租規則</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 14, lineHeight: 1.7, color: "var(--pd-ink-2)" }}>
            <p style={{ margin: 0 }}><strong style={{ fontWeight: 500, color: "var(--pd-ink)" }}>固定車位</strong>：指定車位，進場一律放行，不開放給臨停。</p>
            <p style={{ margin: 0 }}><strong style={{ fontWeight: 500, color: "var(--pd-ink)" }}>共用月租</strong>：先到先停、不保證車位。共用區滿位時，離場後返回須等待。</p>
            <p style={{ margin: 0 }}><strong style={{ fontWeight: 500, color: "var(--pd-ink)" }}>容量</strong>：臨停與共用月租共用同一個共用區容量。</p>
          </div>
          <button type="button" className="pd-btn" style={{ alignSelf: "flex-start" }}>調整規則</button>
        </aside>
      </div>
    </main>
  );
}
