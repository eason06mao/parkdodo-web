"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Mock 專用：切換預覽身分，確認不同角色看到的畫面與按鈕。正式版移除。 */
export function PersonaSwitcher({ current, options }: { current: string; options: { id: string; label: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const change = async (id: string) => {
    setBusy(true);
    await fetch("/api/mock-persona", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    setBusy(false);
    router.refresh();
  };
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 10 }}>
      <span>預覽身分</span>
      <select value={current} disabled={busy} onChange={(e) => change(e.target.value)}
        style={{ font: "inherit", fontSize: 12, color: "inherit", background: "transparent", border: "1px solid var(--pd-warn-line)", borderRadius: 6, padding: "2px 6px", minHeight: 28 }}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  );
}
