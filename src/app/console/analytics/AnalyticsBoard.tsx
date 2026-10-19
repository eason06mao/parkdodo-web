"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Chip } from "@/components/Chip";
import { getAnalytics } from "@/lib/data";
import { formatMinutes, formatMoney, signedPct } from "@/lib/format";
import type { Period } from "@/lib/types";

const PERIODS: { key: Period; label: string; unit: string }[] = [
  { key: "day", label: "日", unit: "每日" },
  { key: "week", label: "週", unit: "每週" },
  { key: "month", label: "月", unit: "每月" },
  { key: "quarter", label: "季", unit: "每季" },
];
const MIX_COLORS = ["var(--pd-chart-1)", "var(--pd-chart-2)", "var(--pd-chart-3)", "var(--pd-chart-4)", "var(--pd-chart-5)"];
const HEAT = ["#EEF5F3", "#B9DCD7", "#6FB3AA", "#2E8C82", "#0F5F58"];
const DAYS = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"];

export function AnalyticsBoard() {
  const [period, setPeriod] = useState<Period>("month");
  const data = useMemo(() => getAnalytics(period), [period]);
  const [from, setFrom] = useState(data.from);
  const [to, setTo] = useState(data.to);
  const unit = PERIODS.find((p) => p.key === period)!.unit;

  const pick = (p: Period) => {
    const d = getAnalytics(p);
    setPeriod(p); setFrom(d.from); setTo(d.to);
  };

  const totals = data.points.map((p) => p.transient + p.monthly + p.merchant);
  const max = Math.max(...totals) * 1.1;
  const vmax = Math.max(...data.points.map((p) => p.entries)) * 1.1;
  const pct = (v: number, m: number) => `${((v / m) * 100).toFixed(1)}%`;
  const topSite = Math.max(...data.sites.map((s) => s.revenue));

  const kpis = [
    { label: "總營收", pre: "NT$", value: formatMoney(data.totals.revenue), unit: "", delta: `${signedPct(data.deltas.revenue)} 較前期`, good: data.deltas.revenue >= 0 },
    { label: "進場車次", pre: "", value: formatMoney(data.totals.entries), unit: "次", delta: `${signedPct(data.deltas.entries)} 較前期`, good: data.deltas.entries >= 0 },
    { label: "平均客單", pre: "NT$", value: formatMoney(data.totals.avgTicket), unit: "", delta: `${signedPct(data.deltas.avgTicket)} 較前期`, good: data.deltas.avgTicket >= 0 },
    { label: "車位使用率", pre: "", value: String(data.totals.occupancyPct), unit: "%", delta: `${data.deltas.occupancyPts >= 0 ? "▲" : "▼"} ${Math.abs(data.deltas.occupancyPts)} 個百分點`, good: data.deltas.occupancyPts >= 0 },
    // 遠端開閘越少越好：下降顯示為好
    { label: "遠端開閘", pre: "", value: String(data.totals.remoteOpens), unit: "次", delta: `${signedPct(data.deltas.remoteOpens)} 較前期`, good: data.deltas.remoteOpens <= 0 },
  ];

  return (
    <main className="pd-main">
      <header className="pd-page-head">
        <div>
          <nav aria-label="路徑" className="pd-label"><Link href="/console">營運總覽</Link> ／ 營收與車輛戰情板</nav>
          <h1 className="pd-page-title">營收與車輛戰情板</h1>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="pd-field"><label htmlFor="site">場站</label><select id="site" className="pd-select" style={{ minWidth: 160 }}><option>全部場站</option><option>中航站</option></select></div>
          <div className="pd-segmented" role="group" aria-label="統計單位">
            {PERIODS.map((p) => <button key={p.key} type="button" aria-pressed={period === p.key} onClick={() => pick(p.key)}>{p.label}</button>)}
          </div>
          <div className="pd-field"><label htmlFor="from">起</label><input id="from" type="date" className="pd-input" value={from} onChange={(e) => setFrom(e.target.value)} max={to} /></div>
          <div className="pd-field"><label htmlFor="to">迄</label><input id="to" type="date" className="pd-input" value={to} onChange={(e) => setTo(e.target.value)} min={from} /></div>
          <button type="button" className="pd-btn">匯出報表</button>
        </div>
      </header>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <span className="pd-label">{from} 至 {to}・{unit}彙總・與前一期比較</span>
        <Chip>示意資料・上線後接 daily_site_metrics</Chip>
      </div>

      <section aria-label="關鍵指標" className="pd-grid pd-grid-5" style={{ gap: 14 }}>
        {kpis.map((k) => (
          <div key={k.label} className="pd-card" style={{ padding: "18px 20px" }}>
            <div className="pd-label">{k.label}</div>
            <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 6 }}>
              {k.pre && <span className="pd-label">{k.pre}</span>}
              <span className="pd-mono" style={{ fontSize: "clamp(20px, 1.9vw, var(--pd-fs-metric-sm))", fontWeight: 600, overflowWrap: "anywhere" }}>{k.value}</span>
              {k.unit && <span className="pd-label">{k.unit}</span>}
            </div>
            <div className={`pd-metric-delta ${k.good ? "pd-delta-good" : "pd-delta-bad"}`} style={{ marginTop: 8 }}>{k.delta}</div>
          </div>
        ))}
      </section>

      <div className="pd-grid pd-grid-3">
        <section aria-labelledby="rev-h" className="pd-card pd-span-2" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <h2 id="rev-h" className="pd-serif" style={{ margin: 0, fontSize: 18 }}>營收趨勢（{unit}）</h2>
            <div className="pd-label" style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <span><span className="pd-swatch" style={{ background: "var(--pd-chart-1)" }} />臨停</span>
              <span><span className="pd-swatch" style={{ background: "var(--pd-chart-3)" }} />月租</span>
              <span><span className="pd-swatch" style={{ background: "var(--pd-chart-5)" }} />商家折抵請款</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, height: 260, paddingBottom: 24 }}>
            <div className="pd-mono pd-label" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", textAlign: "right", fontSize: 11, width: 64 }}>
              <span>{formatMoney(Math.round(max))}</span><span>{formatMoney(Math.round(max / 2))}</span><span>0</span>
            </div>
            <div className="pd-bar-chart" style={{ flex: 1, minWidth: 0 }} role="img" aria-label={`營收趨勢，共 ${data.points.length} 期`}>
              {data.points.map((p, i) => (
                <div key={p.label} className="pd-bar" title={`${p.label} 營收 NT$ ${formatMoney(totals[i])}`}>
                  <div style={{ height: pct(p.merchant, max), background: "var(--pd-chart-5)", borderRadius: "4px 4px 0 0" }} />
                  <div style={{ height: pct(p.monthly, max), background: "var(--pd-chart-3)" }} />
                  <div style={{ height: pct(p.transient, max), background: "var(--pd-chart-1)" }} />
                  <span className="pd-bar-label">{p.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="mix-h" className="pd-card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 id="mix-h" className="pd-serif" style={{ margin: 0, fontSize: 18 }}>付款方式占比</h2>
          <div style={{ display: "flex", height: 14, borderRadius: 999, overflow: "hidden" }} aria-hidden="true">
            {data.paymentMix.map((m, i) => <div key={m.label} style={{ width: `${m.pct}%`, background: MIX_COLORS[i] }} />)}
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            {data.paymentMix.map((m, i) => (
              <li key={m.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span><span className="pd-swatch" style={{ background: MIX_COLORS[i] }} />{m.label}</span>
                <span className="pd-mono">{m.pct}%</span>
              </li>
            ))}
          </ul>
          <p className="pd-label" style={{ margin: 0 }}>現金繳費機啟用後，會自動加入「現金」項目。</p>
        </section>

        <section aria-labelledby="veh-h" className="pd-card pd-span-2" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <h2 id="veh-h" className="pd-serif" style={{ margin: 0, fontSize: 18 }}>車流量（{unit}）</h2>
            <div className="pd-label" style={{ display: "flex", gap: 14 }}>
              <span><span className="pd-swatch" style={{ background: "var(--pd-chart-ink)" }} />進場</span>
              <span><span className="pd-swatch" style={{ background: "var(--pd-chart-ink-2)" }} />出場</span>
            </div>
          </div>
          <div className="pd-bar-chart" style={{ height: 180 }} role="img" aria-label="進出場車次">
            {data.points.map((p) => (
              <div key={p.label} style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", alignItems: "flex-end", gap: 2 }} title={`${p.label} 進場 ${p.entries}・出場 ${p.exits}`}>
                <div style={{ flex: 1, height: pct(p.entries, vmax), background: "var(--pd-chart-ink)", borderRadius: "3px 3px 0 0" }} />
                <div style={{ flex: 1, height: pct(p.exits, vmax), background: "var(--pd-chart-ink-2)", borderRadius: "3px 3px 0 0" }} />
              </div>
            ))}
          </div>
          <dl className="pd-grid pd-grid-3" style={{ gap: 12, margin: 0 }}>
            <div><dt className="pd-label">臨停占比</dt><dd className="pd-mono" style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 600 }}>{data.transientShare}%</dd></div>
            <div><dt className="pd-label">平均停留</dt><dd className="pd-mono" style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 600 }}>{formatMinutes(data.avgStayMinutes)}</dd></div>
            <div><dt className="pd-label">尖峰時段</dt><dd className="pd-mono" style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 600 }}>週五 18–20 時</dd></div>
          </dl>
        </section>

        <section aria-labelledby="site-h" className="pd-card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 id="site-h" className="pd-serif" style={{ margin: 0, fontSize: 18 }}>場站排行</h2>
          {data.sites.map((s) => (
            <div key={s.name} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}><span>{s.name}</span><span className="pd-mono">NT$ {formatMoney(s.revenue)}</span></div>
              <div className="pd-meter" style={{ height: 8 }} aria-hidden="true"><span style={{ width: pct(s.revenue, topSite) }} /></div>
              <div className="pd-label">周轉率 <span className="pd-mono">{s.turnover}</span>・使用率 <span className="pd-mono">{s.occupancyPct}%</span></div>
            </div>
          ))}
        </section>
      </div>

      <section aria-labelledby="heat-h" className="pd-card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h2 id="heat-h" className="pd-serif" style={{ margin: 0, fontSize: 18 }}>進場熱力圖（星期 × 時段）</h2>
          <div className="pd-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>少<span style={{ display: "inline-flex", gap: 3 }}>{HEAT.map((c) => <span key={c} className="pd-swatch" style={{ background: c, margin: 0 }} />)}</span>多</div>
        </div>
        <div className="pd-table-wrap">
          <div style={{ minWidth: 760, display: "flex", flexDirection: "column", gap: 4 }} role="img" aria-label="各星期與時段的進場量熱力圖">
            <div className="pd-heat"><span />{Array.from({ length: 24 }, (_, h) => <span key={h} className="pd-mono pd-label" style={{ fontSize: 10, textAlign: "center" }}>{h}</span>)}</div>
            {data.heatmap.map((row, d) => (
              <div key={DAYS[d]} className="pd-heat">
                <span className="pd-label" style={{ fontSize: 12, alignSelf: "center" }}>{DAYS[d]}</span>
                {row.map((v, h) => <span key={h} className="pd-heat-cell" title={`${DAYS[d]} ${h}:00`} style={{ background: HEAT[v] }} />)}
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
