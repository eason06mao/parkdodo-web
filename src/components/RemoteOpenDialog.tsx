"use client";

import { useRef, useState } from "react";
import { GATE_REASONS, type GateReason } from "@/lib/types";

/**
 * 遠端開閘：原因必選、「其他」須填說明、送出前 MFA（此版為示意）。
 * 正式版送出 POST /api/gate-commands，後端寫入 gate_commands（有效 30 秒）並由 Edge 執行。
 */
export function RemoteOpenButton({ laneName, plate, variant = "primary" }: { laneName: string; plate?: string; variant?: "primary" | "default" }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<GateReason>("intercom_request");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const open = () => { setSent(false); setError(""); ref.current?.showModal(); };
  const close = () => ref.current?.close();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (reason === "other" && note.trim() === "") {
      setError("原因選「其他」時，請填寫補充說明。");
      return;
    }
    setError("");
    setSent(true);
  };

  return (
    <>
      <button type="button" className={variant === "primary" ? "pd-btn pd-btn--primary" : "pd-btn"} onClick={open}>
        遠端開閘
      </button>
      <dialog ref={ref} className="pd-dialog" aria-labelledby={`dlg-${laneName}`}>
        {!sent ? (
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
              <button type="submit" className="pd-btn pd-btn--primary">驗證並開閘</button>
            </div>
          </form>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 className="pd-serif" style={{ margin: 0, fontSize: 22 }}>指令已送出（示意）</h2>
            <p style={{ margin: 0, color: "var(--pd-ink-2)", lineHeight: 1.7 }}>
              {laneName}：等待現場 Edge 執行並由雷達確認車輛通過。此為 Mock 版本，未連接實際設備。
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" className="pd-btn pd-btn--primary" onClick={close}>完成</button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
