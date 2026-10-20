"use client";

import { useRef, useState } from "react";

/**
 * 工控機配對（Mock）。正式版：後端產生 10 分鐘有效的一次性配對碼，
 * 現場在工控機的 Edge 程式輸入後，雙方交換裝置憑證（寫入 edge_gateways.auth_key_ref），配對碼隨即作廢。
 */
export function PairEdgeButton({ siteName, paired }: { siteName: string; paired: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [code, setCode] = useState("");
  const open = () => {
    const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
    setCode(String(n).padStart(6, "0").replace(/(\d{3})(\d{3})/, "$1 $2"));
    ref.current?.showModal();
  };
  return (
    <>
      <button type="button" className="pd-btn" onClick={open}>{paired ? "更換工控機" : "配對工控機"}</button>
      <dialog ref={ref} className="pd-dialog" aria-labelledby="pair-h">
        <h2 id="pair-h" className="pd-serif" style={{ margin: 0, fontSize: 20 }}>{paired ? "更換" : "配對"}工控機・{siteName}</h2>
        <p style={{ margin: "10px 0 0", color: "var(--pd-muted)", lineHeight: 1.8 }}>在現場工控機打開 ParkDodo Edge，輸入下列配對碼。配對碼 10 分鐘內有效，只能用一次。</p>
        <p className="pd-mono" style={{ fontSize: 36, fontWeight: 600, letterSpacing: 4, textAlign: "center", margin: "20px 0" }} aria-label={`配對碼 ${code}`}>{code}</p>
        {paired && <p role="note" style={{ margin: "0 0 16px", color: "var(--pd-warn-ink)", fontSize: 14 }}>新工控機配對成功後，舊工控機的憑證會立即失效。</p>}
        <p className="pd-label" style={{ margin: "0 0 16px" }}>Mock：這組配對碼不會真的生效。</p>
        <button type="button" className="pd-btn pd-btn--block" onClick={() => ref.current?.close()}>關閉</button>
      </dialog>
    </>
  );
}
