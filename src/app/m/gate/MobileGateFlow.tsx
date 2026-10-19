"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { GATE_REASONS, type GateReason, type Lane } from "@/lib/types";

type Step = "list" | "reason" | "verify" | "done";

export function MobileGateFlow({ lanes }: { lanes: Lane[] }) {
  const [step, setStep] = useState<Step>("list");
  const [lane, setLane] = useState<Lane | null>(null);
  const [reason, setReason] = useState<GateReason>("intercom_request");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const reasonLabel = GATE_REASONS.find((r) => r.code === reason)!.label;
  const attention = lanes.find((l) => l.attention);

  const heading = { list: "遠端開閘", reason: lane?.name ?? "", verify: "安全驗證", done: "完成" }[step];

  const toVerify = () => {
    if (reason === "other" && note.trim() === "") { setError("原因選「其他」時，請填寫補充說明。"); return; }
    setError(""); setStep("verify");
  };

  return (
    <div style={{ minHeight: "100vh", maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", background: "var(--pd-ground)" }}>
      <div className="pd-mock-banner" role="note">模擬環境・未連接設備</div>
      <header style={{ padding: "20px 20px 14px", display: "flex", alignItems: "center", gap: 12 }}>
        {(step === "reason" || step === "verify") ? (
          <button type="button" aria-label="返回" className="pd-btn" style={{ width: 44, padding: 0 }} onClick={() => setStep(step === "verify" ? "reason" : "list")}>
            <Icon name="chevronLeft" size={20} strokeWidth={2} />
          </button>
        ) : (
          <Link href="/console" aria-label="回到後台" className="pd-btn" style={{ width: 44, padding: 0 }}><Icon name="chevronLeft" size={20} strokeWidth={2} /></Link>
        )}
        <div>
          <div className="pd-label">中航站</div>
          <h1 className="pd-serif" style={{ margin: "2px 0 0", fontSize: 22 }}>{heading}</h1>
        </div>
      </header>

      <main style={{ flex: 1, padding: "0 20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
        {step === "list" && (
          <>
            {attention && (
              <div role="status" style={{ padding: "14px 16px", borderRadius: 16, background: "#FFFBF5", border: "1px solid #F0DDC4", color: "var(--pd-warn-ink)" }}>
                <div style={{ fontWeight: 500 }}>{attention.name} {attention.attention}</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>車牌 <span className="pd-plate">{attention.lastPlate}</span>・{attention.result}</div>
              </div>
            )}
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
              {lanes.map((l) => (
                <li key={l.id}>
                  <button type="button" onClick={() => { setLane(l); setStep("reason"); }}
                    className="pd-card" style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left", font: "inherit", cursor: "pointer", padding: 16, borderRadius: 16, borderColor: l.attention ? "var(--pd-warn-line)" : undefined, color: "var(--pd-ink)" }}>
                    <span>
                      <span style={{ display: "block", fontSize: 17, fontWeight: 500 }}>{l.name}</span>
                      <span className="pd-label" style={{ display: "block", marginTop: 4 }}>最近 <span className="pd-plate" style={{ color: "var(--pd-ink)" }}>{l.lastPlate}</span>・{l.radar === "occupied" ? "有車" : "無車"}</span>
                    </span>
                    <Icon name="chevronRight" size={20} strokeWidth={2} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {step === "reason" && lane && (
          <>
            <div className="pd-camera" style={{ aspectRatio: "16 / 10", borderRadius: 16 }}>
              <span>{lane.name} 即時影像</span>
              <span className="pd-live-badge">{lane.lastPlate}</span>
            </div>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ fontSize: 15, fontWeight: 500, marginBottom: 10 }}>開閘原因</legend>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                {GATE_REASONS.map((r) => (
                  <button key={r.code} type="button" className="pd-choice" aria-pressed={reason === r.code} onClick={() => { setReason(r.code); setError(""); }} style={{ minHeight: 52, fontSize: 15, borderRadius: 14 }}>
                    {r.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="pd-field">
              <label htmlFor="m-note">補充說明{reason === "other" ? "（必填）" : ""}</label>
              <textarea id="m-note" className="pd-textarea" rows={2} value={note} onChange={(e) => { setNote(e.target.value); setError(""); }} aria-invalid={error ? true : undefined} aria-describedby={error ? "m-err" : undefined} />
              {error && <p id="m-err" role="alert" style={{ margin: 0, fontSize: 13, color: "var(--pd-danger)" }}>{error}</p>}
            </div>
            <p className="pd-label" style={{ margin: 0 }}>指令 30 秒內有效，執行後會記入稽核紀錄。</p>
          </>
        )}

        {step === "verify" && lane && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center", textAlign: "center", paddingTop: 24 }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", background: "var(--pd-accent-tint)", color: "var(--pd-accent)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="lock" size={34} /></div>
            <div style={{ fontSize: 17, fontWeight: 500 }}>確認是你本人</div>
            <p className="pd-label" style={{ margin: 0, lineHeight: 1.7 }}>將開啟 <span style={{ color: "var(--pd-ink)" }}>{lane.name}</span>，原因：<span style={{ color: "var(--pd-ink)" }}>{reasonLabel}</span>。<br />請用 Face ID 或驗證碼完成驗證。</p>
          </div>
        )}

        {step === "done" && lane && (
          <div role="status" style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center", textAlign: "center", paddingTop: 24 }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", background: "var(--pd-accent)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="check" size={34} strokeWidth={2.2} /></div>
            <div className="pd-serif" style={{ fontSize: 22, fontWeight: 700 }}>指令已送出（示意）</div>
            <p className="pd-label" style={{ margin: 0, lineHeight: 1.7 }}>{lane.name}・等待現場執行<br />雷達確認車輛通過後自動結案</p>
          </div>
        )}
      </main>

      <footer style={{ padding: "12px 20px 28px" }}>
        {step === "reason" && <button type="button" className="pd-btn pd-btn--primary pd-btn--lg pd-btn--block" onClick={toVerify}>下一步：驗證</button>}
        {step === "verify" && <button type="button" className="pd-btn pd-btn--primary pd-btn--lg pd-btn--block" onClick={() => setStep("done")}>驗證並開閘</button>}
        {step === "done" && <button type="button" className="pd-btn pd-btn--lg pd-btn--block" onClick={() => { setStep("list"); setLane(null); setNote(""); }}>回到車道列表</button>}
      </footer>
    </div>
  );
}
