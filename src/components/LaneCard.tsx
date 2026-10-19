import type { Lane } from "@/lib/types";
import { formatTime } from "@/lib/format";
import { Chip } from "./Chip";
import { RemoteOpenButton } from "./RemoteOpenDialog";

export function LaneCard({ lane }: { lane: Lane }) {
  return (
    <article className={lane.attention ? "pd-card pd-card--warn" : "pd-card"} style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Chip tone={lane.direction === "entry" ? "ok" : "info"}>{lane.direction === "entry" ? "入口" : "出口"}</Chip>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>{lane.name}</h3>
        </div>
        {lane.attention ? <Chip tone="warn" dot>{lane.attention}</Chip> : <Chip tone="ok" dot>{lane.online ? "連線中" : "離線"}</Chip>}
      </div>
      <div className="pd-grid pd-grid-3" style={{ gap: 12 }}>
        <div className="pd-camera pd-span-2" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px)", backgroundSize: "24px 24px" }}>
          <span>{lane.name} 即時影像（接上 Edge 後顯示）</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="pd-plate-box">
            <span className="pd-label" style={{ fontSize: 12 }}>辨識車牌</span>
            <span className="pd-plate">{lane.lastPlate}</span>
          </div>
          <div className="pd-label">時間 <span className="pd-mono" style={{ color: "var(--pd-ink)" }}>{formatTime(lane.lastAt)}</span></div>
          <div className="pd-label">信心值 <span className="pd-mono" style={{ color: "var(--pd-ink)" }}>{lane.confidence}%</span></div>
          <div className="pd-label">結果 <span style={{ color: "var(--pd-accent-hover)", fontWeight: 500 }}>{lane.result}</span></div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", borderTop: "1px solid var(--pd-line-soft)", paddingTop: 12 }}>
        <div className="pd-label" style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <span>柵欄：<span style={{ color: "var(--pd-ink)" }}>{lane.gate === "open" ? "開啟" : "已關閉"}</span></span>
          <span>雷達：<span style={{ color: "var(--pd-ink)" }}>{lane.radar === "occupied" ? "有車" : "無車"}</span></span>
          <span>LED：<span style={{ color: "var(--pd-ink)" }}>{lane.ledText}</span></span>
        </div>
        <RemoteOpenButton laneName={lane.name} plate={lane.lastPlate} />
      </div>
    </article>
  );
}
