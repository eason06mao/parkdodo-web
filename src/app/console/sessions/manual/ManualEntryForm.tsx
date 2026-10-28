"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { quote, type RateSchedule } from "@/lib/billing/fee";
import { MANUAL_REASONS, MAX_BACKFILL_DAYS, normalizePlate, validateManualEntry, type ManualEntryInput, type ManualReason } from "@/lib/manualEntry";

type Site = { id: string; name: string; schedule: RateSchedule };

const localNow = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date()).replace(" ", "T");
const toIso = (local: string) => (local ? `${local}:00+08:00` : "");

export function ManualEntryForm({ sites, operator }: { sites: Site[]; operator: string }) {
  const [siteId, setSiteId] = useState(sites[0].id);
  const [plate, setPlate] = useState("");
  const [entry, setEntry] = useState("");
  const [reason, setReason] = useState<ManualReason>("no_entry_record");
  const [note, setNote] = useState("");
  const [evidence, setEvidence] = useState("");
  const [errors, setErrors] = useState<Partial<Record<keyof ManualEntryInput, string>>>({});
  const [serverError, setServerError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ plate: string; amount: number } | null>(null);

  const site = sites.find((s) => s.id === siteId)!;
  const input: ManualEntryInput = { siteId, plate, entryAt: toIso(entry), reason, note, evidence };
  const preview = useMemo(() => {
    if (!entry || Number.isNaN(Date.parse(toIso(entry))) || Date.parse(toIso(entry)) > Date.now()) return null;
    return quote(site.schedule, toIso(entry), new Date().toISOString());
  }, [entry, site]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateManualEntry(input);
    setErrors(errs); setServerError("");
    if (Object.keys(errs).length) return;
    setBusy(true);
    const res = await fetch("/api/sessions/manual", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setServerError(body.message ?? "補登失敗。"); if (body.errors) setErrors(body.errors); return; }
    setDone({ plate: body.plate, amount: body.amount });
  };

  const err = (k: keyof ManualEntryInput) => errors[k] && <span role="alert" style={{ color: "var(--pd-danger)", fontSize: 13 }}>{errors[k]}</span>;

  if (done) {
    return (
      <section className="pd-card" style={{ maxWidth: 640 }} aria-live="polite">
        <div className="pd-chip pd-chip--ok">已補登</div>
        <h2 className="pd-serif" style={{ margin: "12px 0 0", fontSize: 22 }}>{site.name}・<span className="pd-plate">{done.plate}</span></h2>
        <p style={{ margin: "8px 0 0", lineHeight: 1.8 }}>應付 <strong className="pd-mono">NT${done.amount}</strong>。請車主用手機掃碼繳費或到繳費機付款，付款後出口會自動放行。</p>
        <p className="pd-label" style={{ margin: "8px 0 0" }}>已記錄操作人（{operator}）、時間、原因與依據到稽核紀錄。</p>
        <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
          <button type="button" className="pd-btn" onClick={() => { setDone(null); setPlate(""); setEntry(""); setNote(""); setEvidence(""); }}>再補登一筆</button>
          <Link href="/console/sessions" className="pd-btn pd-btn--primary">回進出紀錄</Link>
        </div>
      </section>
    );
  }

  return (
    <div className="pd-split">
      <form onSubmit={submit} className="pd-card" style={{ flex: "999 1 520px", minWidth: 0, display: "grid", gap: 16 }} noValidate>
        {sites.length > 1 && (
          <div className="pd-field"><label htmlFor="site">站點</label>
            <select id="site" className="pd-select" value={siteId} onChange={(e) => setSiteId(e.target.value)}>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        )}
        <div className="pd-field"><label htmlFor="mplate">車牌</label>
          <input id="mplate" className="pd-input pd-input--plate" autoComplete="off" placeholder="ABC-1234" value={plate} onChange={(e) => { setPlate(normalizePlate(e.target.value)); setServerError(""); }} />{err("plate")}</div>
        <div className="pd-field"><label htmlFor="mentry">入場時間</label>
          <input id="mentry" type="datetime-local" className="pd-input" max={localNow()} value={entry} onChange={(e) => setEntry(e.target.value)} />{err("entryAt")}
          <span className="pd-label">最多補登 {MAX_BACKFILL_DAYS} 天內的入場。以監視器畫面或停車券時間為準。</span></div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="pd-label" style={{ marginBottom: 8 }}>原因</legend>
          <div className="pd-choice-grid">
            {MANUAL_REASONS.map((r) => <button key={r.code} type="button" className="pd-choice" aria-pressed={reason === r.code} onClick={() => setReason(r.code)}>{r.label}</button>)}
          </div>{err("reason")}
        </fieldset>
        <div className="pd-field"><label htmlFor="mnote">補充說明{reason === "other" ? "" : "（選填）"}</label>
          <input id="mnote" className="pd-input" value={note} onChange={(e) => setNote(e.target.value)} />{err("note")}</div>
        <div className="pd-field"><label htmlFor="mevi">入場時間依據</label>
          <textarea id="mevi" className="pd-textarea" rows={2} value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="例：入口監視器 14:05 有車輛進場；車主表示約 14:00 進場" />{err("evidence")}</div>
        {serverError && <p role="alert" style={{ margin: 0, color: "var(--pd-danger)" }}>{serverError}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Link href="/console/sessions" className="pd-btn">取消</Link>
          <button type="submit" className="pd-btn pd-btn--primary" disabled={busy}>{busy ? "建立中…" : "建立補登紀錄"}</button>
        </div>
      </form>

      <aside className="pd-card" style={{ flex: "1 1 280px", minWidth: 0 }} aria-live="polite">
        <h2 className="pd-serif" style={{ margin: "0 0 10px", fontSize: 18 }}>應付金額試算</h2>
        {preview ? (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}><span className="pd-label">NT$</span><span className="pd-mono" style={{ fontSize: 36, fontWeight: 600 }}>{preview.amount}</span></div>
            <p className="pd-label" style={{ margin: "4px 0 0" }}>
              停 <span className="pd-mono">{Math.floor(preview.duration.minutes / 60)} 時 {preview.duration.minutes % 60} 分</span>・{preview.free ? "免費短停" : `${preview.billableUnits} 個單位`}{preview.capped && "・已達當日上限"}
            </p>
            <p className="pd-label" style={{ margin: "10px 0 0" }}>依{site.name}目前費率計算到此刻；車主付款時會依當下時間再算一次。</p>
          </>
        ) : <p className="pd-label" style={{ margin: 0 }}>填入入場時間後顯示。</p>}
      </aside>
    </div>
  );
}
