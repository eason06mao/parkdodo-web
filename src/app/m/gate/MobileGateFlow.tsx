"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { formatTime } from "@/lib/format";
import { sendGateCommand, watchGateCommand, type GateOutcome } from "@/lib/gateClient";
import { GATE_REASONS, type GateReason } from "@/lib/types";

export interface GateLane {
  id: string; siteId: string; siteName: string; code: string; name: string;
  paired: boolean; online: boolean; lastPlate: string | null; lastAt: string | null;
  attention: string | null;   // 需注意的說明（離線、未配對…）
}

type Step = "list" | "reason" | "sending" | "waiting" | "result";

const RESULT: Record<GateOutcome["kind"], { title: string; text: (lane: string, detail: string) => string; ok: boolean }> = {
  executed: { ok: true, title: "已開閘", text: (l) => `${l}：工控機已執行開閘。` },
  failed: { ok: false, title: "開閘失敗", text: (l, d) => `${l}：工控機回報無法開閘${d ? `（${d}）` : ""}。請改由現場人員處理。` },
  expired: { ok: false, title: "工控機沒有回應", text: (l) => `${l}：30 秒內沒有執行，指令已作廢，之後也不會突然開閘。請確認工控機是否連線。` },
  mock: { ok: true, title: "指令已送出（示意）", text: (l) => `${l}：這是示意畫面，沒有連接實際設備。` },
};

export function MobileGateFlow({ lanes, live }: { lanes: GateLane[]; live: boolean }) {
  const [step, setStep] = useState<Step>("list");
  const [lane, setLane] = useState<GateLane | null>(null);
  const [reason, setReason] = useState<GateReason>("intercom_request");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<GateOutcome | null>(null);
  const stopWatch = useRef<(() => void) | null>(null);
  useEffect(() => () => stopWatch.current?.(), []);

  const sites = [...new Set(lanes.map((l) => l.siteName))];
  const heading = { list: "遠端開閘", reason: lane?.name ?? "", sending: "送出中", waiting: "等待工控機", result: "結果" }[step];

  const back = () => { stopWatch.current?.(); setStep("list"); setLane(null); setNote(""); setError(""); setOutcome(null); };

  const submit = async () => {
    if (!lane) return;
    if (reason === "other" && note.trim() === "") { setError("原因選「其他」時，請填寫補充說明。"); return; }
    setError(""); setStep("sending");
    let sent: { id: string | null; expiresAt: number };
    try { sent = await sendGateCommand({ siteId: lane.siteId, laneCode: lane.code, plate: lane.lastPlate ?? undefined, reasonCode: reason, reasonNote: note }); }
    catch (e) { setStep("reason"); setError((e as Error).message); return; }
    if (!sent.id) { setOutcome({ kind: "mock" }); setStep("result"); return; }
    setStep("waiting");
    stopWatch.current = watchGateCommand(sent.id, sent.expiresAt, (o) => { stopWatch.current = null; setOutcome(o); setStep("result"); });
  };

  return (
    <div style={{ minHeight: "100vh", maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", background: "var(--pd-ground)" }}>
      {!live && <div className="pd-mock-banner" role="note">示意畫面・未連接設備</div>}
      <header style={{ padding: "20px 20px 14px", display: "flex", alignItems: "center", gap: 12 }}>
        {step === "reason" ? (
          <button type="button" aria-label="返回" className="pd-btn" style={{ width: 44, padding: 0 }} onClick={back}>
            <Icon name="chevronLeft" size={20} strokeWidth={2} />
          </button>
        ) : (
          <Link href="/console" aria-label="回到後台" className="pd-btn" style={{ width: 44, padding: 0 }}><Icon name="chevronLeft" size={20} strokeWidth={2} /></Link>
        )}
        <div>
          <div className="pd-label">{lane ? lane.siteName : "選擇要開的車道"}</div>
          <h1 className="pd-serif" style={{ margin: "2px 0 0", fontSize: 22 }}>{heading}</h1>
        </div>
      </header>

      <main style={{ flex: 1, padding: "0 20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
        {step === "list" && lanes.length === 0 && (
          <p className="pd-label" style={{ lineHeight: 1.8 }}>沒有可以遠端開閘的車道。請確認帳號權限，或場站是否已建立車道。</p>
        )}
        {step === "list" && sites.map((site) => (
          <section key={site} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 style={{ margin: "6px 0 0", fontSize: 15, color: "var(--pd-muted)", fontWeight: 500 }}>{site}</h2>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {lanes.filter((l) => l.siteName === site).map((l) => (
                <li key={l.id}>
                  <button type="button" onClick={() => { setLane(l); setStep("reason"); }}
                    className="pd-card" style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, textAlign: "left", font: "inherit", cursor: "pointer", padding: 16, borderRadius: 16, borderColor: l.attention ? "var(--pd-warn-line)" : undefined, color: "var(--pd-ink)" }}>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 17, fontWeight: 500 }}>{l.name}</span>
                      <span className="pd-label" style={{ display: "block", marginTop: 4 }}>
                        {l.attention
                          ? <span style={{ color: "var(--pd-warn-ink)" }}>{l.attention}</span>
                          : <>工控機在線{l.lastPlate ? <>・最近 <span className="pd-plate" style={{ color: "var(--pd-ink)" }}>{l.lastPlate}</span>{l.lastAt ? ` ${formatTime(l.lastAt)}` : ""}</> : ""}</>}
                      </span>
                    </span>
                    <Icon name="chevronRight" size={20} strokeWidth={2} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {step === "reason" && lane && (
          <>
            {lane.attention && (
              <div role="alert" style={{ padding: "12px 14px", borderRadius: 14, background: "#FFFBF5", border: "1px solid #F0DDC4", color: "var(--pd-warn-ink)", lineHeight: 1.7 }}>
                {lane.attention}：指令可能不會被執行，30 秒後會自動作廢。
              </div>
            )}
            {lane.lastPlate && <p className="pd-label" style={{ margin: 0 }}>最近辨識車牌 <span className="pd-plate" style={{ color: "var(--pd-ink)" }}>{lane.lastPlate}</span></p>}
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
              <label htmlFor="m-note">補充說明{reason === "other" ? "（必填）" : "（選填）"}</label>
              <textarea id="m-note" className="pd-textarea" rows={2} value={note} onChange={(e) => { setNote(e.target.value); setError(""); }} aria-invalid={error ? true : undefined} aria-describedby={error ? "m-err" : undefined} />
              {error && <p id="m-err" role="alert" style={{ margin: 0, fontSize: 13, color: "var(--pd-danger)" }}>{error}</p>}
            </div>
            <p className="pd-label" style={{ margin: 0 }}>按下後柵欄只開一次。指令 30 秒內有效，會記入稽核紀錄。</p>
          </>
        )}

        {(step === "sending" || step === "waiting") && lane && (
          <div role="status" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center", textAlign: "center", paddingTop: 32 }}>
            <div className="pd-spinner" aria-hidden="true" style={{ width: 48, height: 48, borderRadius: "50%", border: "4px solid var(--pd-line)", borderTopColor: "var(--pd-accent)", animation: "pd-spin 0.9s linear infinite" }} />
            <div style={{ fontSize: 17, fontWeight: 500 }}>{step === "sending" ? "送出中…" : `等待 ${lane.name} 執行…`}</div>
            <p className="pd-label" style={{ margin: 0 }}>通常 2–3 秒內完成，最多等 30 秒。</p>
            <style>{"@keyframes pd-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.pd-spinner{animation:none!important}}"}</style>
          </div>
        )}

        {step === "result" && lane && outcome && (
          <div role="status" style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center", textAlign: "center", paddingTop: 24 }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", background: RESULT[outcome.kind].ok ? "var(--pd-accent)" : "var(--pd-warn-tint)", color: RESULT[outcome.kind].ok ? "#fff" : "var(--pd-warn-ink)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name={RESULT[outcome.kind].ok ? "check" : "alert"} size={34} strokeWidth={2.2} />
            </div>
            <div className="pd-serif" style={{ fontSize: 22, fontWeight: 700 }}>{RESULT[outcome.kind].title}</div>
            <p className="pd-label" style={{ margin: 0, lineHeight: 1.7 }}>{RESULT[outcome.kind].text(lane.name, outcome.kind === "failed" ? outcome.detail : "")}</p>
          </div>
        )}
      </main>

      <footer style={{ padding: "12px 20px 28px" }}>
        {step === "reason" && <button type="button" className="pd-btn pd-btn--primary pd-btn--lg pd-btn--block" onClick={submit}>確認開閘</button>}
        {step === "result" && <button type="button" className="pd-btn pd-btn--lg pd-btn--block" onClick={back}>回到車道列表</button>}
      </footer>
    </div>
  );
}
