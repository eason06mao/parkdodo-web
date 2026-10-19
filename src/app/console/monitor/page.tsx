import type { Metadata } from "next";
import { Chip } from "@/components/Chip";
import { RemoteOpenButton } from "@/components/RemoteOpenDialog";
import { getLanes } from "@/lib/data";
import { formatTime } from "@/lib/format";

export const metadata: Metadata = { title: "即時監控" };

export default async function MonitorPage() {
  const lanes = await getLanes();
  const warn = lanes.filter((l) => l.attention).length;
  return (
    <main className="pd-main pd-theme-night" style={{ background: "var(--pd-ground)", color: "var(--pd-ink)" }}>
      <header className="pd-page-head">
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <h1 className="pd-page-title" style={{ color: "#fff" }}>即時監控</h1>
          <span className="pd-label">全部場站・<span className="pd-mono">{lanes.length}</span> 個車道・WebSocket 自動更新（Mock）</span>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Chip tone="ok" dot>連線正常 {lanes.length - warn}</Chip>
          {warn > 0 && <Chip tone="warn" dot>需注意 {warn}</Chip>}
        </div>
      </header>

      <div className="pd-grid pd-grid-2">
        {lanes.map((l) => (
          <article key={l.id} className="pd-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12, borderColor: l.attention ? "var(--pd-warn-line)" : undefined }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Chip>{l.siteName}</Chip>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500, color: "#fff" }}>{l.name}</h2>
              </div>
              {l.attention ? <Chip tone="warn" dot>{l.attention}</Chip> : <Chip tone="ok" dot>正常</Chip>}
            </div>
            <div className="pd-camera" style={{ background: "#0D151A" }}>
              <span>{l.name} 即時影像（接上 Edge 後顯示）</span>
              <span className="pd-live-badge">LIVE・{formatTime(l.lastAt)}</span>
            </div>
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, margin: 0 }}>
              <div><dt className="pd-label">最近車牌</dt><dd className="pd-plate" style={{ margin: "4px 0 0", fontSize: 18, color: "#fff" }}>{l.lastPlate}</dd></div>
              <div><dt className="pd-label">信心值</dt><dd className="pd-mono" style={{ margin: "4px 0 0", fontSize: 18 }}>{l.confidence}%</dd></div>
              <div><dt className="pd-label">柵欄</dt><dd style={{ margin: "6px 0 0" }}>{l.gate === "open" ? "開啟中" : "關閉"}</dd></div>
              <div><dt className="pd-label">LED 顯示</dt><dd style={{ margin: "6px 0 0" }}>{l.ledText}</dd></div>
            </dl>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
              <button type="button" className="pd-btn">對講</button>
              <RemoteOpenButton laneName={l.name} plate={l.lastPlate} />
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
