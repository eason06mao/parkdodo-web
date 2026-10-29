"use client";

import { useRef, useState } from "react";
import { GATE_REASONS, type GateReason } from "@/lib/types";

/**
 * 遠端開閘：原因必選、「其他」須填說明。送出 POST /api/gate-commands，後端寫入 gate_commands（有效 30 秒），
 * 現場工控機取回後透過相機繼電器開閘並回報；畫面每秒查詢一次結果。MFA 尚未實作（TODO）。
 */
type Phase = "form" | "sending" | "waiting" | "executed" | "failed" | "expired" | "mock";

export function RemoteOpenButton({ siteId, laneCode, laneName, plate, variant = "primary" }: { siteId: string; laneCode: string; laneName: string; plate?: string; variant?: "primary" | "default" }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<GateReason>("intercom_request");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [detail, setDetail] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => { if (timer.current) clearInterval(timer.current); timer.current = null; };
  const open = () => { stop(); setPhase("form"); setError(""); setDetail(""); ref.current?.showModal(); };
  const close = () => { stop(); ref.current?.close(); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reason === "other" && note.trim() === "") {
      setError("原因選「其他」時，請填寫補充說明。");
      return;
    }
    setError(""); setPhase("sending");
    const res = await fetch("/api/gate-commands", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ siteId, laneCode, plate, reasonCode: reason, reasonNote: note, idempotencyKey: crypto.randomUUID() }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    if (!res?.ok) { setPhase("form"); setError(body?.message ?? "送出失敗，請再試一次。"); return; }
    if (body.mock) { setPhase("mock"); return; }
    setPhase("waiting");
    const until = Date.parse(body.expiresAt) + 3000;
    timer.current = setInterval(async () => {
      const r = await fetch(`/api/gate-commands/${body.id}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
      const st = r?.status as string | undefined;
      if (st === "executed" || st === "failed" || st === "expired") {
        stop(); setPhase(st); setDetail(r?.result?.detail ?? "");
      } else if (Date.now() > until) {
        stop(); setPhase("expired");
      }
    }, 1000);
  };

  const RESULT: Record<Exclude<Phase, "form" | "sending">, { title: string; text: string }> = {
    waiting: { title: "指令已送出", text: `${laneName}：等待現場工控機執行（30 秒內有效）…` },
    executed: { title: "已開閘", text: `${laneName}：工控機已執行開閘，車輛通過後會自動結案。` },
    failed: { title: "開閘失敗", text: `${laneName}：工控機回報無法開閘${detail ? `（${detail}）` : ""}。請改用現場人員處理。` },
    expired: { title: "工控機沒有回應", text: `${laneName}：30 秒內沒有執行，指令已作廢，不會延遲開閘。請確認工控機是否連線。` },
    mock: { title: "指令已送出（示意）", text: `${laneName}：雲端資料庫尚未設定，此為示意，未連接實際設備。` },
  };

  return (
    <>
      <button type="button" className={variant === "primary" ? "pd-btn pd-btn--primary" : "pd-btn"} onClick={open}>
        遠端開閘
      </button>
      <dialog ref={ref} className="pd-dialog" aria-labelledby={`dlg-${laneName}`}>
        {phase === "form" || phase === "sending" ? (
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div>
              <h2 id={`dlg-${laneName}`} className="pd-serif" style={{ margin: 0, fontSize: 22 }}>遠端開閘・{laneName}</h2>
              <p className="pd-label" style={{ margin: "8px 0 0" }}>
                {plate ? <>最近車牌 <span className="pd-plate">{plate}</span>・</> : null}指令 30 秒內有效，執行後會記入稽核紀錄。
              </p>
            </div>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>開閘原因</legend>
              <div className="pd-choice-grid">
                {GATE_REASONS.map((r) => (
                  <button key={r.code} type="button" className="pd-choice" aria-pressed={reason === r.code} onClick={() => setReason(r.code)}>
                    {r.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="pd-field">
              <label htmlFor={`note-${laneName}`}>補充說明{reason === "other" ? "（必填）" : ""}</label>
              <textarea id={`note-${laneName}`} className="pd-textarea" rows={3} value={note}
                onChange={(e) => { setNote(e.target.value); setError(""); }}
                placeholder="例：車主對講表示付款畫面卡住" aria-invalid={error ? true : undefined}
                aria-describedby={error ? `err-${laneName}` : undefined} />
              {error && <p id={`err-${laneName}`} role="alert" style={{ margin: 0, fontSize: 13, color: "var(--pd-danger)" }}>{error}</p>}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button type="button" className="pd-btn" onClick={close}>取消</button>
              <button type="submit" className="pd-btn pd-btn--primary" disabled={phase === "sending"}>{phase === "sending" ? "送出中…" : "確認開閘"}</button>
            </div>
          </form>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }} aria-live="polite">
            <h2 className="pd-serif" style={{ margin: 0, fontSize: 22 }}>{RESULT[phase].title}</h2>
            <p style={{ margin: 0, color: "var(--pd-ink-2)", lineHeight: 1.7 }}>{RESULT[phase].text}</p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" className="pd-btn pd-btn--primary" onClick={close}>完成</button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
