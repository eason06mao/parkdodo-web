import type { Metadata } from "next";
import { Chip } from "@/components/Chip";
import { RemoteOpenButton } from "@/components/RemoteOpenDialog";
import { getCurrentUser } from "@/lib/auth";
import { getLanes, getSiteRecords } from "@/lib/data";
import { dbConfigured } from "@/lib/db";
import { formatDateTime, formatTime } from "@/lib/format";
import { listLiveLanes, type LiveLane } from "@/lib/lanesDb";

export const metadata: Metadata = { title: "即時監控" };
export const dynamic = "force-dynamic";

export default async function MonitorPage() {
  if (dbConfigured()) {
    const user = await getCurrentUser();
    return <LiveMonitor lanes={await listLiveLanes((await getSiteRecords(user)).map((s) => s.code))} />;
  }
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
              <RemoteOpenButton siteId={l.siteId} laneCode={l.code} laneName={l.name} plate={l.lastPlate} />
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}

/** 有雲端資料庫時：真實車道、工控機連線狀態、最近辨識車牌、遠端開閘。重新整理頁面更新。 */
function LiveMonitor({ lanes }: { lanes: LiveLane[] }) {
  const down = lanes.filter((l) => !l.online).length;
  const state = (l: LiveLane) => !l.paired ? { tone: "warn" as const, text: "尚未配對工控機" }
    : !l.online ? { tone: "warn" as const, text: "工控機離線" } : { tone: "ok" as const, text: "工控機在線" };
  return (
    <main className="pd-main pd-theme-night" style={{ background: "var(--pd-ground)", color: "var(--pd-ink)" }}>
      <header className="pd-page-head">
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <h1 className="pd-page-title" style={{ color: "#fff" }}>即時監控</h1>
          <span className="pd-label"><span className="pd-mono">{lanes.length}</span> 個車道・重新整理頁面即更新</span>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Chip tone="ok" dot>在線 {lanes.length - down}</Chip>
          {down > 0 && <Chip tone="warn" dot>需注意 {down}</Chip>}
        </div>
      </header>
      {lanes.length === 0 && <p className="pd-label">還沒有車道資料。</p>}
      <div className="pd-grid pd-grid-2">
        {lanes.map((l) => {
          const st = state(l);
          return (
            <article key={l.id} className="pd-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12, borderColor: st.tone === "warn" ? "var(--pd-warn-line)" : undefined }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Chip>{l.siteName}</Chip>
                  <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500, color: "#fff" }}>{l.name}</h2>
                </div>
                <Chip tone={st.tone} dot>{st.text}</Chip>
              </div>
              <dl style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, margin: 0 }}>
                <div><dt className="pd-label">最近車牌</dt><dd className="pd-plate" style={{ margin: "4px 0 0", fontSize: 18, color: "#fff" }}>{l.lastPlate ?? "—"}</dd></div>
                <div><dt className="pd-label">辨識時間</dt><dd className="pd-mono" style={{ margin: "6px 0 0" }}>{l.lastAt ? formatTime(l.lastAt) : "—"}</dd></div>
                <div><dt className="pd-label">工控機最後回報</dt><dd className="pd-mono" style={{ margin: "6px 0 0", fontSize: 13 }}>{l.edgeSeenAt ? formatDateTime(l.edgeSeenAt) : "—"}</dd></div>
              </dl>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
                <RemoteOpenButton siteId={l.siteId} laneCode={l.code} laneName={`${l.siteName}・${l.name}`} plate={l.lastPlate ?? undefined} />
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
