import type { Metadata } from "next";
import Link from "next/link";
import { Chip } from "@/components/Chip";
import { LaneCard } from "@/components/LaneCard";
import { getCashKiosk, getIncidents, getLanes, getSites, getAnalytics } from "@/lib/data";
import { formatMoney, formatTime } from "@/lib/format";

export const metadata: Metadata = { title: "營運總覽" };
export const dynamic = "force-dynamic"; // 問候語與日期依當下時間

function greeting(hour: number) {
  if (hour < 11) return "早安";
  if (hour < 14) return "午安";
  if (hour < 18) return "午安";
  return "晚安";
}

export default async function OverviewPage() {
  const [sites, lanes, incidents, kiosk] = await Promise.all([getSites(), getLanes(), getIncidents(), getCashKiosk()]);
  const site = sites[0];
  const open = incidents.filter((i) => i.status === "open");
  const today = getAnalytics("day");
  const last = today.points[today.points.length - 1];
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", hour: "numeric", hour12: false }).format(now));
  const dateText = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(now);
  const usedPct = ((site.totalSpaces - site.freeSpaces) / site.totalSpaces) * 100;

  return (
    <main className="pd-main">
      <header className="pd-page-head">
        <div>
          <div className="pd-label">{dateText}</div>
          <h1 className="pd-serif" style={{ margin: "6px 0 0", fontSize: "var(--pd-fs-display)" }}>
            {greeting(hour)}，{open.length === 0 ? "今天一切運作平穩。" : `有 ${open.length} 件事需要你看一下。`}
          </h1>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <label htmlFor="site" className="pd-sr-only">場站</label>
          <select id="site" className="pd-select" style={{ width: "auto", minWidth: 180 }} defaultValue={site.id}>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}・{s.address}</option>)}
          </select>
          <button type="button" className="pd-btn">人工收費</button>
          <button type="button" className="pd-btn">盤點車輛</button>
        </div>
      </header>

      <section aria-label="今日概況" className="pd-grid pd-grid-4">
        <div className="pd-card">
          <div className="pd-label">剩餘車位</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 10 }}>
            <span className="pd-metric-value">{site.freeSpaces}</span><span className="pd-label">/ {site.totalSpaces}</span>
          </div>
          <div className="pd-meter" style={{ marginTop: 14 }} role="img" aria-label={`使用率 ${usedPct.toFixed(0)}%`}><span style={{ width: `${usedPct}%` }} /></div>
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <Chip tone="ok">臨停 {site.occupancy.transient}</Chip>
            <Chip tone="info">月租 {site.occupancy.monthly}</Chip>
            <Chip tone="warn">特殊 {site.occupancy.special}</Chip>
          </div>
        </div>
        <div className="pd-card">
          <div className="pd-label">今日營收（示意）</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 10 }}>
            <span className="pd-label">NT$</span><span className="pd-metric-value">{formatMoney(last.transient + last.monthly + last.merchant)}</span>
          </div>
          <div className="pd-label" style={{ marginTop: 14 }}>LINE Pay・信用卡・uTagGo{kiosk ? "・現金" : "（現金預留）"}</div>
        </div>
        <div className="pd-card">
          <div className="pd-label">今日進出（示意）</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginTop: 10 }}>
            <div><span className="pd-metric-value">{last.entries}</span><span className="pd-label" style={{ marginLeft: 6 }}>進場</span></div>
            <div><span className="pd-mono" style={{ fontSize: 28, fontWeight: 600, color: "var(--pd-muted)" }}>{last.exits}</span><span className="pd-label" style={{ marginLeft: 6 }}>出場</span></div>
          </div>
        </div>
        <div className={open.length ? "pd-card pd-card--warn" : "pd-card"}>
          <div className="pd-label" style={{ color: open.length ? "var(--pd-warn-ink)" : undefined }}>待處理例外</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 10 }}>
            <span className="pd-metric-value" style={{ color: open.length ? "var(--pd-warn-ink)" : undefined }}>{open.length}</span><span className="pd-label">件</span>
          </div>
          <Link href="/console/incidents" style={{ display: "inline-block", marginTop: 14, fontSize: 14, color: "var(--pd-warn-ink)" }}>前往處理 →</Link>
        </div>
      </section>

      <section aria-labelledby="lanes-h" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h2 id="lanes-h" className="pd-section-title">車道即時狀態</h2>
          <Chip tone="ok" dot>全部設備連線正常</Chip>
        </div>
        <div className="pd-grid pd-grid-2">
          {lanes.map((l) => <LaneCard key={l.id} lane={l} />)}
        </div>
      </section>

      <div className="pd-grid pd-grid-3">
        <section aria-labelledby="ex-h" className="pd-card pd-span-2" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 id="ex-h" className="pd-serif" style={{ margin: 0, fontSize: 18 }}>需要你注意</h2>
            <Link href="/console/incidents" style={{ fontSize: 14 }}>全部例外 →</Link>
          </div>
          {open.length === 0 && <p className="pd-label" style={{ margin: 0 }}>目前沒有待處理的例外。</p>}
          {open.slice(0, 3).map((i) => (
            <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", borderRadius: 10, background: "#FFFBF5", border: "1px solid #F0DDC4" }}>
              <span className="pd-dot" style={{ background: i.level === "critical" ? "var(--pd-danger)" : "var(--pd-warn)", width: 10, height: 10 }} aria-hidden="true" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{i.title}</div>
                <div className="pd-label">{i.where}・<span className="pd-mono">{formatTime(i.openedAt)}</span></div>
              </div>
              <Link href={`/console/incidents?id=${i.id}`} className="pd-btn">處理</Link>
            </div>
          ))}
        </section>

        {kiosk ? (
          <section aria-labelledby="kiosk-h" className="pd-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 id="kiosk-h" className="pd-serif" style={{ margin: 0, fontSize: 18 }}>{kiosk.name}</h2>
              <Chip tone={kiosk.running ? "ok" : "danger"}>{kiosk.running ? "正常運作" : "停止"}</Chip>
            </div>
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px 16px", margin: 0, fontSize: 14 }}>
              {[...kiosk.bills, ...kiosk.coins].map((x) => (
                <div key={x.label} style={{ display: "contents" }}>
                  <dt className="pd-label">{x.label}</dt><dd className="pd-mono" style={{ margin: 0, textAlign: "right" }}>{x.count}</dd>
                </div>
              ))}
              <dt className="pd-label">感熱紙</dt><dd style={{ margin: 0, textAlign: "right" }}>{kiosk.paper}</dd>
            </dl>
            <button type="button" className="pd-btn" style={{ alignSelf: "flex-start" }}>重新啟動</button>
          </section>
        ) : (
          <section aria-labelledby="kiosk-r-h" className="pd-card pd-card--reserved" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 id="kiosk-r-h" className="pd-serif" style={{ margin: 0, fontSize: 18, color: "var(--pd-ink-2)" }}>現金繳費機</h2>
              <Chip>預留・未啟用</Chip>
            </div>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: "var(--pd-muted)" }}>本站採無人化、無現金收費。安裝繳費機後在「場站與設備」啟用，這裡會顯示鈔票、硬幣存量與感熱紙狀態。</p>
          </section>
        )}
      </div>
    </main>
  );
}
