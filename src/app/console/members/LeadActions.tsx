"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { LeadStatus } from "@/lib/members";

export function LeadActions({ id, status }: { id: string; status: LeadStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = async (s: LeadStatus) => {
    setBusy(true); setError("");
    const r = await fetch(`/api/member-leads/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: s }) }).catch(() => null);
    setBusy(false);
    if (!r?.ok) { setError((await r?.json().catch(() => null))?.message ?? "更新失敗"); return; }
    router.refresh();
  };
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {(status === "new" || status === "contacted") && <Link href={`/console/monthly/new?lead=${id}`} className="pd-btn pd-btn--primary" style={{ minHeight: 36 }}>建立合約</Link>}
      {status === "new" && <button type="button" className="pd-btn" style={{ minHeight: 36 }} disabled={busy} onClick={() => set("contacted")}>標為已聯絡</button>}
      {(status === "new" || status === "contacted") && <button type="button" className="pd-btn" style={{ minHeight: 36 }} disabled={busy} onClick={() => set("closed")}>不租了</button>}
      {status === "closed" && <button type="button" className="pd-btn" style={{ minHeight: 36 }} disabled={busy} onClick={() => set("new")}>重新開啟</button>}
      {error && <span role="alert" style={{ color: "var(--pd-danger)", fontSize: 13 }}>{error}</span>}
    </div>
  );
}
