"use client";

import { useState } from "react";
import Link from "next/link";
import { Chip } from "@/components/Chip";
import { RemoteOpenButton } from "@/components/RemoteOpenDialog";
import type { Incident } from "@/lib/types";
import { formatTime } from "@/lib/format";

const LEVEL = { critical: { label: "緊急", color: "var(--pd-danger)" }, warning: { label: "注意", color: "var(--pd-warn)" }, info: { label: "一般", color: "var(--pd-muted)" } } as const;
const STATUS = { open: { label: "待處理", tone: "warn" }, acknowledged: { label: "處理中", tone: "info" }, resolved: { label: "已結案", tone: "neutral" } } as const;

export function IncidentWorkspace({ incidents, initialId }: { incidents: Incident[]; initialId?: string }) {
  const [filter, setFilter] = useState<"open" | "mine" | "resolved">("open");
  const [selId, setSelId] = useState(initialId ?? incidents[0]?.id);
  const list = incidents.filter((i) => (filter === "resolved" ? i.status === "resolved" : filter === "mine" ? i.status === "acknowledged" : i.status !== "resolved"));
  const cur = incidents.find((i) => i.id === selId) ?? list[0];
  const count = (lv: Incident["level"]) => incidents.filter((i) => i.level === lv && i.status !== "resolved").length;

  return (
    <main className="pd-main">
      <header className="pd-page-head">
        <div>
          <nav aria-label="路徑" className="pd-label"><Link href="/console">營運總覽</Link> ／ 例外處理</nav>
          <h1 className="pd-page-title">例外處理</h1>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Chip tone="danger">緊急 {count("critical")}</Chip>
          <Chip tone="warn">注意 {count("warning")}</Chip>
          <Chip tone="info">一般 {count("info")}</Chip>
        </div>
      </header>

      <div className="pd-split">
        <section aria-label="例外清單" className="pd-card" style={{ flex: "1 1 360px", maxWidth: 460, padding: 10, display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="pd-segmented" role="group" aria-label="篩選" style={{ margin: "6px 6px 10px" }}>
            {([["open", "未結案"], ["mine", "處理中"], ["resolved", "已結案"]] as const).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
            ))}
          </div>
          {list.length === 0 && <p className="pd-label" style={{ padding: 16, margin: 0 }}>沒有符合的事件。</p>}
          {list.map((i) => (
            <button key={i.id} type="button" className="pd-incident-item" aria-current={cur?.id === i.id} onClick={() => setSelId(i.id)}>
              <span className="pd-dot" aria-hidden="true" style={{ background: LEVEL[i.level].color, width: 10, height: 10, marginTop: 6, flex: "none" }} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontWeight: 500 }}>{i.title}</span>
                  <span className="pd-mono pd-label">{formatTime(i.openedAt).slice(0, 5)}</span>
                </span>
                <span className="pd-label">{LEVEL[i.level].label}・{i.where}</span>
                <span style={{ alignSelf: "flex-start" }}><Chip tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Chip></span>
              </span>
            </button>
          ))}
        </section>

        {cur && (
          <section aria-labelledby="d-h" className="pd-card" style={{ flex: "999 1 560px", minWidth: 0, padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Chip tone={STATUS[cur.status].tone}>{STATUS[cur.status].label}</Chip>
                  <span className="pd-label">事件 <span className="pd-mono">{cur.code}</span></span>
                </div>
                <h2 id="d-h" className="pd-serif" style={{ margin: "10px 0 0", fontSize: 24 }}>{cur.title}</h2>
                <div className="pd-label" style={{ marginTop: 6 }}>{cur.where}・發生於 <span className="pd-mono">{formatTime(cur.openedAt)}</span></div>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button type="button" className="pd-btn">指派給…</button>
                <button type="button" className="pd-btn pd-btn--primary">認領處理</button>
              </div>
            </div>

            {cur.plate && (
              <div className="pd-grid pd-grid-3" style={{ gap: 14 }}>
                <div className="pd-camera pd-span-2"><span>事件當下的全景照片</span></div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div className="pd-plate-box">
                    <span className="pd-label">相機辨識</span>
                    <span className="pd-plate">{cur.plate}</span>
                    {cur.confidence !== undefined && <span className="pd-label">信心值 <span className="pd-mono" style={{ color: cur.confidence < 85 ? "var(--pd-warn-ink)" : undefined }}>{cur.confidence}%</span></span>}
                  </div>
                  <div className="pd-field">
                    <label htmlFor={`fix-${cur.id}`}>人工確認車牌</label>
                    <input key={cur.id} id={`fix-${cur.id}`} className="pd-input pd-input--plate" defaultValue={cur.plate} />
                  </div>
                </div>
              </div>
            )}

            <div className="pd-grid pd-grid-2" style={{ gap: 14 }}>
              <div style={{ border: "1px solid var(--pd-line-soft)", borderRadius: 12, padding: 16 }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>系統判斷</h3>
                <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.75, color: "var(--pd-ink-2)" }}>{cur.reason}</p>
              </div>
              <div style={{ border: "1px solid var(--pd-line-soft)", borderRadius: 12, padding: 16 }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>建議處理方式</h3>
                <ul style={{ margin: "8px 0 0", paddingLeft: 20, fontSize: 14, lineHeight: 1.85, color: "var(--pd-ink-2)" }}>
                  <li>比對照片後修正車牌，系統會重新配對進場紀錄</li>
                  <li>確認已付款或屬月租後，可遠端開閘</li>
                  <li>無法判斷時以對講聯絡車主</li>
                </ul>
              </div>
            </div>

            <div>
              <h3 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 500 }}>處理紀錄</h3>
              <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {cur.timeline.map((t, idx) => (
                  <li key={idx} style={{ display: "flex", gap: 12, fontSize: 14 }}>
                    <span className="pd-mono pd-label" style={{ flex: "none" }}>{formatTime(t.at)}</span><span>{t.text}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap", borderTop: "1px solid var(--pd-line-soft)", paddingTop: 16 }}>
              <button type="button" className="pd-btn">對講車主</button>
              {cur.plate && <button type="button" className="pd-btn">修正車牌並重新配對</button>}
              {cur.laneId && <RemoteOpenButton siteId="site-001" laneCode={cur.laneId.replace(/^lane-/, "").toUpperCase()} laneName={cur.where.split("・")[1] ?? cur.where} plate={cur.plate} />}
              <button type="button" className="pd-btn">結案</button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
