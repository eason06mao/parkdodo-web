"use client";

import { useEffect, useState } from "react";
import { INVOICE_LABELS, validateInvoice, type InvoiceChoice } from "@/lib/invoice";

type Step = "plate" | "confirm" | "redirect" | "done";
type Kind = InvoiceChoice["kind"];
interface Quote { plate: string; entryAt: Date; minutes: number; amount: number; expiresAt: Date }

const PREF_KEY = "pd_invoice_pref"; // 車主勾選「記住」時，只存在這支手機的瀏覽器，不會上傳

// Mock 報價：進場 2 小時 15 分、每 30 分鐘 30 元。正式版由後端計費。
function mockQuote(plate: string): Quote {
  const now = new Date();
  const minutes = 135;
  return { plate, entryAt: new Date(now.getTime() - minutes * 60_000), minutes, amount: Math.ceil(minutes / 30) * 30, expiresAt: new Date(now.getTime() + 10 * 60_000) };
}

const fmtTime = (d: Date) => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
const normalizePlate = (s: string) => s.toUpperCase().replace(/\s/g, "");

export function PayFlow({ siteCode, siteName, paperEnabled }: { siteCode: string; siteName: string; paperEnabled: boolean }) {
  const [step, setStep] = useState<Step>("plate");
  const [plate, setPlate] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [kind, setKind] = useState<Kind>("member");
  const [barcode, setBarcode] = useState("");
  const [loveCode, setLoveCode] = useState("");
  const [taxId, setTaxId] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [orderNo, setOrderNo] = useState("");
  const [now, setNow] = useState(() => Date.now());

  // 讀回這支手機上次的選擇
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PREF_KEY) ?? "null") as Partial<InvoiceChoice> & { kind?: Kind } | null;
      if (!saved?.kind || saved.kind === "paper") return;
      setKind(saved.kind);
      if (saved.kind === "mobile") setBarcode((saved as { barcode?: string }).barcode ?? "");
      if (saved.kind === "donate") setLoveCode((saved as { loveCode?: string }).loveCode ?? "");
      if (saved.kind === "company") {
        const c = saved as { taxId?: string; title?: string; email?: string };
        setTaxId(c.taxId ?? ""); setTitle(c.title ?? ""); setEmail(c.email ?? "");
      }
    } catch { /* 無痕模式或被封鎖時略過 */ }
  }, []);

  useEffect(() => {
    if (step !== "confirm") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step]);

  const choice = (): InvoiceChoice => {
    switch (kind) {
      case "mobile": return { kind, barcode: barcode.trim().toUpperCase() };
      case "donate": return { kind, loveCode: loveCode.trim() };
      case "company": return { kind, taxId: taxId.trim(), title: title.trim(), email: email.trim() };
      default: return { kind } as InvoiceChoice;
    }
  };

  const lookup = (e: React.FormEvent) => {
    e.preventDefault();
    const p = normalizePlate(plate);
    if (!/^[A-Z0-9]{2,4}-?[A-Z0-9]{2,4}$/.test(p)) { setError("請輸入完整車牌，例如 ABC-1234。"); return; }
    setError(""); setQuote(mockQuote(p)); setStep("confirm");
  };

  const pay = async () => {
    if (!quote) return;
    const c = choice();
    const problem = validateInvoice(c, { paperEnabled });
    if (problem) { setError(problem); return; }
    if (quote.expiresAt.getTime() < Date.now()) { setError("金額已更新，請重新查詢。"); setQuote(mockQuote(quote.plate)); return; }
    setError(""); setBusy(true);
    try { if (remember) localStorage.setItem(PREF_KEY, JSON.stringify(c)); else localStorage.removeItem(PREF_KEY); } catch { /* 略過 */ }
    const res = await fetch("/api/pay/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plate: quote.plate, amount: quote.amount, invoice: c }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(body.message ?? "目前無法付款，請稍後再試。"); return; }
    setOrderNo(body.orderNo); setStep("redirect");
  };

  const left = quote ? Math.max(0, Math.floor((quote.expiresAt.getTime() - now) / 1000)) : 0;
  const invoiceSummary = () => {
    const c = choice();
    switch (c.kind) {
      case "member": return "存入會員載具，中獎會主動通知";
      case "mobile": return `存入手機條碼 ${c.barcode}`;
      case "donate": return `捐贈，愛心碼 ${c.loveCode}`;
      case "company": return `統一編號 ${c.taxId}，寄到 ${c.email}`;
      case "paper": return "列印紙本";
    }
  };

  const option = (k: Kind, desc: string, disabled = false) => (
    <label key={k} className={`pd-card${kind === k ? " pd-card--selected" : ""}${disabled ? " pd-card--reserved" : ""}`}
      style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "14px 16px", cursor: disabled ? "not-allowed" : "pointer", minHeight: 52 }}>
      <input type="radio" name="invoice" value={k} checked={kind === k} disabled={disabled} onChange={() => { setKind(k); setError(""); }} style={{ marginTop: 4, width: 18, height: 18 }} />
      <span>
        <span style={{ fontWeight: 500, display: "block" }}>{INVOICE_LABELS[k]}{disabled && <span className="pd-chip" style={{ marginLeft: 8 }}>預留・未啟用</span>}</span>
        <span className="pd-label">{desc}</span>
      </span>
    </label>
  );

  return (
    <div style={{ minHeight: "100vh", maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", background: "var(--pd-ground)" }}>
      <div className="pd-mock-banner" role="note">模擬環境・不會扣款、不會開立發票</div>
      <header style={{ padding: "22px 20px 8px" }}>
        <div className="pd-label pd-mono">{siteCode}</div>
        <h1 className="pd-serif" style={{ margin: "2px 0 0", fontSize: 24 }}>{siteName}・停車繳費</h1>
      </header>

      <main style={{ flex: 1, padding: "12px 20px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
        {step === "plate" && (
          <form onSubmit={lookup} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ margin: 0, color: "var(--pd-muted)", lineHeight: 1.8 }}>輸入車牌查詢停車費。付款後 15 分鐘內出場，柵欄會自動開啟。</p>
            <div className="pd-field">
              <label htmlFor="plate">車牌號碼</label>
              <input id="plate" className="pd-input pd-input--plate" inputMode="text" autoCapitalize="characters" autoComplete="off"
                placeholder="ABC-1234" value={plate} onChange={(e) => setPlate(e.target.value)} style={{ fontSize: 24, minHeight: 56, textAlign: "center", letterSpacing: 2 }} />
            </div>
            {error && <p role="alert" style={{ margin: 0, color: "var(--pd-danger)" }}>{error}</p>}
            <button type="submit" className="pd-btn pd-btn--primary pd-btn--block pd-btn--lg">查詢停車費</button>
          </form>
        )}

        {step === "confirm" && quote && (
          <>
            <section className="pd-card" aria-label="停車費">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                <span className="pd-plate" style={{ fontSize: 20 }}>{quote.plate}</span>
                <button type="button" className="pd-btn" style={{ minHeight: 36 }} onClick={() => { setStep("plate"); setError(""); }}>不是我的車</button>
              </div>
              <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "8px 16px", margin: "14px 0 0" }}>
                <dt className="pd-label">進場</dt><dd style={{ margin: 0 }} className="pd-mono">{fmtTime(quote.entryAt)}</dd>
                <dt className="pd-label">停車</dt><dd style={{ margin: 0 }} className="pd-mono">{Math.floor(quote.minutes / 60)} 時 {quote.minutes % 60} 分</dd>
              </dl>
              <div style={{ marginTop: 16, display: "flex", alignItems: "baseline", gap: 6 }}>
                <span className="pd-label">應付</span><span className="pd-label">NT$</span>
                <span className="pd-mono" style={{ fontSize: 36, fontWeight: 600 }}>{quote.amount}</span>
              </div>
              <p className="pd-label" style={{ margin: "6px 0 0" }} aria-live="polite">
                金額保留 <span className="pd-mono">{String(Math.floor(left / 60)).padStart(2, "0")}:{String(left % 60).padStart(2, "0")}</span>，逾時會重新計算
              </p>
            </section>

            <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              <legend className="pd-serif" style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>電子發票</legend>
              {option("member", "不用輸入任何資料，中獎時以簡訊或 Email 通知")}
              {option("mobile", "存到財政部手機條碼載具，可在發票 App 查看")}
              {kind === "mobile" && (
                <div className="pd-field" style={{ paddingLeft: 8 }}>
                  <label htmlFor="barcode">手機條碼</label>
                  <input id="barcode" className="pd-input pd-mono" placeholder="/ABC+123" autoCapitalize="characters" autoComplete="off" maxLength={8}
                    value={barcode} onChange={(e) => setBarcode(e.target.value.toUpperCase())} />
                </div>
              )}
              {option("donate", "捐給社福團體，輸入對方的愛心碼")}
              {kind === "donate" && (
                <div className="pd-field" style={{ paddingLeft: 8 }}>
                  <label htmlFor="love">愛心碼</label>
                  <input id="love" className="pd-input pd-mono" inputMode="numeric" placeholder="例：919" maxLength={7} value={loveCode} onChange={(e) => setLoveCode(e.target.value.replace(/\D/g, ""))} />
                </div>
              )}
              {option("company", "開立含統一編號的發票，電子檔寄到 Email")}
              {kind === "company" && (
                <div style={{ display: "grid", gap: 12, paddingLeft: 8 }}>
                  <div className="pd-field"><label htmlFor="tax">統一編號</label>
                    <input id="tax" className="pd-input pd-mono" inputMode="numeric" maxLength={8} placeholder="8 位數字" value={taxId} onChange={(e) => setTaxId(e.target.value.replace(/\D/g, ""))} /></div>
                  <div className="pd-field"><label htmlFor="title">公司抬頭（選填）</label>
                    <input id="title" className="pd-input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
                  <div className="pd-field"><label htmlFor="email">寄送 Email</label>
                    <input id="email" type="email" className="pd-input" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                </div>
              )}
              {option("paper", paperEnabled ? "在繳費機列印電子發票證明聯" : "此站沒有繳費機，暫不提供紙本", !paperEnabled)}
              <label style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44 }}>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ width: 18, height: 18 }} />
                <span>在這支手機記住我的發票選擇</span>
              </label>
            </fieldset>

            {error && <p role="alert" style={{ margin: 0, color: "var(--pd-danger)" }}>{error}</p>}
            <button type="button" className="pd-btn pd-btn--primary pd-btn--block pd-btn--lg" onClick={pay} disabled={busy}>
              {busy ? "處理中…" : <>前往付款 NT$<span className="pd-mono">{quote.amount}</span></>}
            </button>
            <p className="pd-label" style={{ margin: 0, textAlign: "center" }}>付款由統一金流 PAYUNi 處理，可使用信用卡、Apple Pay、Google Pay、LINE Pay。</p>
          </>
        )}

        {step === "redirect" && quote && (
          <section className="pd-card" style={{ textAlign: "center", padding: "32px 22px" }} aria-live="polite">
            <h2 className="pd-serif" style={{ margin: 0, fontSize: 20 }}>即將前往統一金流付款頁</h2>
            <p style={{ color: "var(--pd-muted)", lineHeight: 1.8 }}>正式版會在這裡自動跳轉。模擬環境請直接按下方按鈕，假裝付款成功。</p>
            <p className="pd-label pd-mono">訂單 {orderNo}</p>
            <button type="button" className="pd-btn pd-btn--primary pd-btn--block pd-btn--lg" onClick={() => setStep("done")}>模擬付款成功</button>
          </section>
        )}

        {step === "done" && quote && (
          <section className="pd-card" style={{ padding: "28px 22px" }} aria-live="polite">
            <div className="pd-chip pd-chip--ok">付款完成</div>
            <h2 className="pd-serif" style={{ margin: "12px 0 0", fontSize: 24 }}>請在 15 分鐘內出場</h2>
            <p style={{ color: "var(--pd-muted)", lineHeight: 1.8, margin: "8px 0 0" }}>開到出口時，柵欄會自動辨識車牌並開啟。</p>
            <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "8px 16px", margin: "18px 0 0" }}>
              <dt className="pd-label">車牌</dt><dd style={{ margin: 0 }} className="pd-plate">{quote.plate}</dd>
              <dt className="pd-label">金額</dt><dd style={{ margin: 0 }} className="pd-mono">NT${quote.amount}</dd>
              <dt className="pd-label">發票</dt><dd style={{ margin: 0 }}>{invoiceSummary()}</dd>
            </dl>
            <p className="pd-label" style={{ margin: "16px 0 0" }}>發票會在付款後開立；如有問題請按出口對講機。</p>
          </section>
        )}
      </main>
    </div>
  );
}
