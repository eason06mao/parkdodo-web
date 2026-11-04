"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { ACCENT_PRESETS, accentVars, contrastWithWhite, DEFAULT_ACCENT, LOGO_MAX_BYTES, normalizeColor, validateBrand, type Brand, type BrandErrors } from "@/lib/branding";

export function BrandForm({ orgId, orgName, initial }: { orgId: string; orgName: string; initial: Brand }) {
  const router = useRouter();
  const [name, setName] = useState(initial.displayName);
  const [subtitle, setSubtitle] = useState(initial.subtitle);
  const [color, setColor] = useState(initial.accentColor ?? "");
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl);
  const [errors, setErrors] = useState<BrandErrors>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const accent = normalizeColor(color);
  const validAccent = accent && /^#[0-9A-F]{6}$/.test(accent) ? accent : null;
  const preview: Brand = { orgId, displayName: name.trim() || "（名稱）", subtitle: subtitle.trim(), accentColor: validAccent, logoUrl };
  const contrast = validAccent ? contrastWithWhite(validAccent) : null;

  const save = async () => {
    setMsg(null);
    const input = { displayName: name, subtitle, accentColor: accent };
    const e = validateBrand(input);
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const r = await fetch(`/api/brand/${encodeURIComponent(orgId)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }).catch(() => null);
    const b = await r?.json().catch(() => ({}));
    setBusy(false);
    if (!r?.ok) { setErrors(b?.errors ?? {}); setMsg({ ok: false, text: b?.message ?? "儲存失敗，請再試一次。" }); return; }
    setMsg({ ok: true, text: "已儲存，左上角與車主頁面都已更新。" });
    router.refresh();
  };

  const upload = async (f: File | undefined) => {
    setMsg(null);
    if (!f) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) { setMsg({ ok: false, text: "只接受 PNG、JPG 或 WebP 圖片（不接受 SVG）。" }); return; }
    if (f.size > LOGO_MAX_BYTES) { setMsg({ ok: false, text: `圖片 ${Math.round(f.size / 1024)} KB，請小於 512 KB。` }); return; }
    setBusy(true);
    const r = await fetch(`/api/brand/${encodeURIComponent(orgId)}/logo`, { method: "POST", headers: { "content-type": f.type }, body: f }).catch(() => null);
    const b = await r?.json().catch(() => ({}));
    setBusy(false);
    if (file.current) file.current.value = "";
    if (!r?.ok) { setMsg({ ok: false, text: b?.message ?? "上傳失敗，請再試一次。" }); return; }
    setLogoUrl(b.brand.logoUrl);
    setMsg({ ok: true, text: "Logo 已更新。" });
    router.refresh();
  };

  const removeLogo = async () => {
    setBusy(true);
    const r = await fetch(`/api/brand/${encodeURIComponent(orgId)}/logo`, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!r?.ok) { setMsg({ ok: false, text: "移除失敗，請再試一次。" }); return; }
    setLogoUrl(null); setMsg({ ok: true, text: "已移除 Logo，改用文字標誌。" });
    router.refresh();
  };

  const err = (k: keyof BrandErrors) => errors[k] && <span role="alert" style={{ color: "var(--pd-danger)", fontSize: 13 }}>{errors[k]}</span>;

  return (
    <div className="pd-split">
      <section className="pd-card" aria-labelledby="bf-h" style={{ flex: "1 1 380px", display: "grid", gap: 18 }}>
        <h2 id="bf-h" className="pd-section-title">{orgName}</h2>

        <div className="pd-field">
          <label htmlFor="bname">名稱（顯示在左上角與繳費頁）</label>
          <input id="bname" className="pd-input" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} placeholder="例：好停車" />
          {err("displayName") ?? <span className="pd-label">最多 20 個字，建議 8 個字以內。</span>}
        </div>
        <div className="pd-field">
          <label htmlFor="bsub">副標題（選填）</label>
          <input id="bsub" className="pd-input" maxLength={20} value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="例：停車營運中心" />
          {err("subtitle")}
        </div>

        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 10 }}>
          <legend className="pd-label" style={{ marginBottom: 8 }}>Logo</legend>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ background: "var(--pd-night)", padding: 10, borderRadius: 12, display: "inline-flex" }}><BrandMark brand={preview} size={56} /></span>
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <label className="pd-btn" style={{ cursor: busy ? "not-allowed" : "pointer" }}>
                  {logoUrl ? "更換圖片" : "上傳圖片"}
                  <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="pd-sr-only" disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
                </label>
                {logoUrl && <button type="button" className="pd-btn" disabled={busy} onClick={removeLogo}>移除</button>}
              </div>
              <span className="pd-label">PNG、JPG 或 WebP，小於 512 KB。建議正方形、至少 256×256，透明背景最好看。</span>
            </div>
          </div>
        </fieldset>

        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 10 }}>
          <legend className="pd-label" style={{ marginBottom: 8 }}>主題色（按鈕、選取狀態）</legend>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="radiogroup" aria-label="主題色">
            <button type="button" role="radio" aria-checked={!accent} onClick={() => setColor("")} className="pd-choice" style={!accent ? { background: "var(--pd-accent)", borderColor: "var(--pd-accent)", color: "#fff" } : undefined}>預設</button>
            {ACCENT_PRESETS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={accent === c} aria-label={`顏色 ${c}`} onClick={() => setColor(c)}
                style={{ width: 40, height: 40, borderRadius: 10, background: c, border: accent === c ? "3px solid var(--pd-ink)" : "1px solid var(--pd-line-input)", cursor: "pointer" }} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label htmlFor="bcolor" className="pd-label">自訂</label>
            <input type="color" aria-label="選擇顏色" value={validAccent ?? DEFAULT_ACCENT} onChange={(e) => setColor(e.target.value.toUpperCase())} style={{ width: 44, height: 40, border: 0, background: "transparent", padding: 0 }} />
            <input id="bcolor" className="pd-input pd-mono" style={{ width: 130 }} placeholder="#0F766E" maxLength={7} value={color} onChange={(e) => setColor(e.target.value)} />
            {contrast !== null && <span className="pd-label">白字對比 {contrast.toFixed(1)}:1{contrast < 4.5 ? "（太淺）" : ""}</span>}
          </div>
          {err("accentColor")}
        </fieldset>

        {msg && <p role={msg.ok ? "status" : "alert"} style={{ margin: 0, color: msg.ok ? "var(--pd-accent-hover)" : "var(--pd-danger)" }}>{msg.text}</p>}
        <div><button type="button" className="pd-btn pd-btn--primary" onClick={save} disabled={busy}>{busy ? "處理中…" : "儲存名稱與主題色"}</button></div>
      </section>

      <section aria-labelledby="bp-h" style={{ flex: "1 1 320px", display: "grid", gap: 14, alignContent: "start", ...(accentVars(validAccent) as React.CSSProperties) }}>
        <h2 id="bp-h" className="pd-section-title">預覽</h2>
        <div className="pd-label">後台左上角</div>
        <div style={{ background: "var(--pd-night)", borderRadius: 14, padding: "18px 16px", display: "flex", alignItems: "center", gap: 12 }}>
          <BrandMark brand={preview} />
          <div style={{ minWidth: 0 }}>
            <div className="pd-serif" style={{ fontSize: 18, fontWeight: 700, color: "#fff", overflowWrap: "anywhere" }}>{preview.displayName}</div>
            {preview.subtitle && <div style={{ fontSize: 12, color: "var(--pd-night-muted)" }}>{preview.subtitle}</div>}
          </div>
        </div>
        <div className="pd-label">車主手機繳費頁</div>
        <div className="pd-card" style={{ padding: 16, display: "grid", gap: 12, maxWidth: 360 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <BrandMark brand={preview} size={32} />
            <div><div style={{ fontWeight: 700 }}>{preview.displayName}</div><div className="pd-label">中航站・停車繳費</div></div>
          </div>
          <div className="pd-card pd-card--selected" style={{ padding: "10px 14px" }}>存入會員載具</div>
          <button type="button" className="pd-btn pd-btn--primary pd-btn--block" tabIndex={-1}>前往付款 NT$150</button>
        </div>
      </section>
    </div>
  );
}
