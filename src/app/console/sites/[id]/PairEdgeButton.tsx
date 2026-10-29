"use client";

import { useRef, useState } from "react";

/**
 * 工控機配對：後端產生 10 分鐘有效的一次性配對碼，現場在工控機執行
 *   ParkDodo.Edge.exe pair <配對碼>
 * 雙方交換裝置金鑰後配對碼作廢；新工控機配對成功，舊的立即停用。
 * 雲端資料庫尚未設定時顯示示意配對碼。
 */
export function PairEdgeButton({ siteId, siteName, paired }: { siteId: string; siteName: string; paired: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [code, setCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [mock, setMock] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setBusy(true); setError(""); setCode("");
    const res = await fetch(`/api/sites/${siteId}/edge-pairing`, { method: "POST" }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setBusy(false);
    if (res?.status === 201) {
      setCode(String(body.code).replace(/(\d{4})(\d{4})/, "$1 $2")); setExpiresAt(body.expiresAt); setMock(false);
    } else if (res?.status === 503) {
      const n = crypto.getRandomValues(new Uint32Array(1))[0] % 100_000_000;
      setCode(String(n).padStart(8, "0").replace(/(\d{4})(\d{4})/, "$1 $2")); setExpiresAt(""); setMock(true);
    } else {
      setError(body?.message ?? "無法產生配對碼。");
    }
    ref.current?.showModal();
  };
  const until = expiresAt ? new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit" }).format(new Date(expiresAt)) : "";

  return (
    <>
      <button type="button" className="pd-btn" onClick={open} disabled={busy}>{busy ? "產生中…" : paired ? "更換工控機" : "配對工控機"}</button>
      <dialog ref={ref} className="pd-dialog" aria-labelledby="pair-h">
        <h2 id="pair-h" className="pd-serif" style={{ margin: 0, fontSize: 20 }}>{paired ? "更換" : "配對"}工控機・{siteName}</h2>
        {error ? <p role="alert" style={{ margin: "14px 0", color: "var(--pd-danger)" }}>{error}</p> : (
          <>
            <p style={{ margin: "10px 0 0", color: "var(--pd-muted)", lineHeight: 1.8 }}>
              在現場工控機開啟「命令提示字元」，進入 ParkDodo Edge 資料夾後輸入：
            </p>
            <p className="pd-mono" style={{ margin: "8px 0 0", padding: "8px 12px", background: "var(--pd-surface-sunk)", borderRadius: "var(--pd-r-sm)", fontSize: 14 }}>
              ParkDodo.Edge.exe pair {code.replace(" ", "")}
            </p>
            <p className="pd-mono" style={{ fontSize: 36, fontWeight: 600, letterSpacing: 4, textAlign: "center", margin: "20px 0 8px" }} aria-label={`配對碼 ${code}`}>{code}</p>
            <p className="pd-label" style={{ margin: "0 0 16px", textAlign: "center" }}>{until ? `${until} 前有效，只能用一次` : "10 分鐘內有效，只能用一次"}</p>
            {paired && <p role="note" style={{ margin: "0 0 16px", color: "var(--pd-warn-ink)", fontSize: 14 }}>新工控機配對成功後，舊工控機的憑證會立即失效。</p>}
            {mock && <p className="pd-label" style={{ margin: "0 0 16px" }}>雲端資料庫尚未設定：這組配對碼只是示意，不會生效。</p>}
          </>
        )}
        <button type="button" className="pd-btn pd-btn--block" onClick={() => ref.current?.close()}>關閉</button>
      </dialog>
    </>
  );
}
