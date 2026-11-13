"use client";

import { useEffect, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { accentVars, type Brand } from "@/lib/branding";
import { INVOICE_LABELS, validateInvoice, type InvoiceChoice } from "@/lib/invoice";
import { useTaxName } from "@/lib/useTaxName";
import { TaxHint } from "@/components/TaxHint";

type Step = "plate" | "choose" | "confirm" | "redirect" | "done";
type Kind = InvoiceChoice["kind"];
interface Quote { quoteId: string; plate: string; entryAt: Date; minutes: number; amount: number; expiresAt: Date; overstay: boolean; mock: boolean; photo: string | null }
/** 只打數字或車牌有誤差時的候選車（車牌部分遮蔽） */
interface Candidate { ref: string; plate: string; entryAt: string; minutes: number; photo: string | null }
/** 不用付款的情況：月租車、免費時間內、已付款 */
interface NoPay { kind: "monthly" | "free" | "paid"; plate: string; minutes: number; validUntil?: string; photo?: string | null }

const PREF_KEY = "pd_invoice_pref"; // 車主勾選「記住」時，只存在這支手機的瀏覽器，不會上傳

/** 把統一金流的付款表單送出（整頁跳轉到 PAYUNi 付款頁） */
function submitForm(action: string, fields: Record<string, string>) {
  const f = document.createElement("form");
  f.method = "POST"; f.action = action;
  for (const [k, v] of Object.entries(fields)) {
    const i = document.createElement("input");
    i.type = "hidden"; i.name = k; i.value = String(v);
    f.appendChild(i);
  }
  document.body.appendChild(f);
  f.submit();
}

const fmtTime = (d: Date) => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
const normalizePlate = (s: string) => s.toUpperCase().replace(/\s/g, "");

export function PayFlow({ siteCode, siteName, paperEnabled, brand, banner }: { siteCode: string; siteName: string; paperEnabled: boolean; brand: Brand; banner: string | null }) {
  const [step, setStep] = useState<Step>("plate");
  const [plate, setPlate] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [noPay, setNoPay] = useState<NoPay | null>(null);
  const [candidates, setCandidates] = useState<{ mode: "digits" | "fuzzy"; list: Candidate[] } | null>(null);
  // 從候選中選的車：之後畫面一律顯示遮蔽的車牌（避免只打數字就看到別人的完整車牌）
  const [shownPlate, setShownPlate] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("member");
  const [barcode, setBarcode] = useState("");
  const [loveCode, setLoveCode] = useState("");
  const [taxId, setTaxId] = useState("");
  const [title, setTitle] = useState("");
  const [autoTitle, setAutoTitle] = useState("");
  const taxName = useTaxName(kind === "company" ? taxId : "");
  // 查到公司名稱時自動填入抬頭（客戶自己改過就不覆蓋）
  useEffect(() => {
    if (taxName.status !== "found") return;
    setTitle((t) => (t === "" || t === autoTitle ? taxName.name : t));
    setAutoTitle(taxName.name);
  }, [taxName]); // eslint-disable-line react-hooks/exhaustive-deps
  const [email, setEmail] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [orderNo, setOrderNo] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [member, setMember] = useState<{ name: string; providers: string[] } | null | undefined>(undefined); // undefined＝讀取中

  // 從付款失敗頁「重新付款」或出口顯示的 QR 進來時，網址帶 plate=：自動帶入並查詢
  useEffect(() => {
    let p = "";
    try { p = new URLSearchParams(window.location.search).get("plate") ?? ""; } catch { /* 略過 */ }
    p = p.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (p.length >= 4 && p.length <= 8) { setPlate(p); void fetchQuote(p); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch("/api/members/me").then((r) => r.json()).then((b) => setMember(b.member ?? null)).catch(() => setMember(null));
  }, []);

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

  /** 向雲端查詢應付金額 */
  const fetchQuote = async (p: string, ref?: string): Promise<boolean> => {
    setBusy(true);
    const res = await fetch("/api/pay/quote", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(ref ? { site: siteCode, ref } : { site: siteCode, plate: p }) }).catch(() => null);
    const b = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res?.ok) { setError(b?.message ?? "查詢失敗，請再試一次。"); return false; }
    if (b.kind === "choose") {
      setQuote(null); setNoPay(null);
      setCandidates({ mode: b.mode, list: b.candidates });
      setStep("choose");
    } else if (b.kind === "pay") {
      setNoPay(null);
      setQuote({ quoteId: b.quoteId, plate: b.plate, entryAt: new Date(b.entryAt), minutes: b.minutes, amount: b.amount, expiresAt: new Date(b.expiresAt), overstay: !!b.overstay, mock: !!b.mock, photo: b.photo ?? null });
      setStep("confirm");
    } else {
      setQuote(null);
      setNoPay({ kind: b.kind, plate: b.plate, minutes: b.minutes, validUntil: b.validUntil, photo: b.photo ?? null });
      setStep("plate");
    }
    return true;
  };

  const lookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = normalizePlate(plate);
    const q = p.replace(/[^A-Z0-9]/g, "");
    if (!/^\d{3,4}$/.test(q) && !/^[A-Z0-9]{4,8}$/.test(q)) { setError("請輸入完整車牌（例如 ABC-1234），或車牌上的 4 個數字。"); return; }
    setError(""); setShownPlate(null);
    await fetchQuote(p);
  };

  const pay = async () => {
    if (!quote) return;
    const c = choice();
    const problem = validateInvoice(c, { paperEnabled });
    if (problem) { setError(problem); return; }
    if (c.kind === "member" && !member) { setError("存入會員載具需要先加入會員，或改選其他發票方式。"); return; }
    if (quote.expiresAt.getTime() < Date.now()) { await fetchQuote(quote.plate); setError("金額已重新計算，請確認後再付款。"); return; }
    setError(""); setBusy(true);
    try { if (remember) localStorage.setItem(PREF_KEY, JSON.stringify(c)); else localStorage.removeItem(PREF_KEY); } catch { /* 略過 */ }
    const res = await fetch("/api/pay/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quoteId: quote.quoteId, invoice: c }) }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    if (!res?.ok) {
      setBusy(false);
      if (body?.error === "quote_expired") { await fetchQuote(quote.plate); setError("金額已重新計算，請確認後再付款。"); return; }
      if (body?.error === "already_paid") { await fetchQuote(quote.plate); return; }
      setError(body?.message ?? "目前無法付款，請稍後再試。"); return;
    }
    setOrderNo(body.orderNo);
    if (body.mock) { setBusy(false); setStep("redirect"); return; }
    setStep("redirect");
    submitForm(body.form.action, body.form.fields);   // 跳轉到統一金流付款頁；付款後回到 /pay/result
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
    <div style={{ minHeight: "100vh", maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", background: "var(--pd-ground)", ...(accentVars(brand.accentColor) as React.CSSProperties) }}>
      {banner && <div className="pd-mock-banner" role="note">{banner}</div>}
      <header style={{ padding: "22px 20px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <BrandMark brand={brand} size={32} />
          <span style={{ fontWeight: 700 }}>{brand.displayName}</span>
          <span className="pd-label pd-mono" style={{ marginLeft: "auto" }}>{siteCode}</span>
        </div>
        <h1 className="pd-serif" style={{ margin: "2px 0 0", fontSize: 24 }}>{siteName}・停車繳費</h1>
      </header>

      <main style={{ flex: 1, padding: "12px 20px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
        {step === "plate" && (
          <form onSubmit={lookup} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ margin: 0, color: "var(--pd-muted)", lineHeight: 1.8 }}>輸入車牌查詢停車費，不用打「-」；記不清楚英文也可以只打 4 個數字。付款後 15 分鐘內出場，柵欄會自動開啟。</p>
            <div className="pd-field">
              <label htmlFor="plate">車牌號碼</label>
              <input id="plate" className="pd-input pd-input--plate" inputMode="text" autoCapitalize="characters" autoComplete="off"
                placeholder="ABC-1234 或 1234" value={plate} onChange={(e) => setPlate(e.target.value)} style={{ fontSize: 24, minHeight: 56, textAlign: "center", letterSpacing: 2 }} />
            </div>
            {noPay && (
              <section className="pd-card pd-card--selected" style={{ padding: "16px 18px" }} aria-live="polite">
                {noPay.photo && <div style={{ marginBottom: 10 }}><CarPhoto src={noPay.photo} width="100%" /></div>}
                <div className="pd-plate" style={{ fontSize: 20 }}>{shownPlate ?? noPay.plate}</div>
                <p style={{ margin: "8px 0 0", fontSize: 20, fontWeight: 600, color: "var(--pd-accent)" }}>
                  {noPay.kind === "monthly" ? "月租車，不用繳費" : noPay.kind === "free" ? "免費時間內，不用繳費" : "已完成繳費"}
                </p>
                <p style={{ margin: "6px 0 0", fontWeight: 500, lineHeight: 1.7 }}>
                  {noPay.kind === "monthly" ? "請直接開到出口，柵欄會自動開啟。"
                    : noPay.kind === "free"
                      ? `已停車 ${noPay.minutes} 分鐘。請盡速離場${noPay.validUntil ? `，${fmtTime(new Date(noPay.validUntil))} 前出場免費` : ""}，超過將從入場時間開始計費。`
                      : `請在 ${noPay.validUntil ? fmtTime(new Date(noPay.validUntil)) : "期限"} 前出場，柵欄會自動開啟。`}
                </p>
              </section>
            )}
            {error && <p role="alert" style={{ margin: 0, color: "var(--pd-danger)" }}>{error}</p>}
            <button type="submit" className="pd-btn pd-btn--primary pd-btn--block pd-btn--lg" disabled={busy}>{busy ? "查詢中…" : "查詢停車費"}</button>
          </form>
        )}

        {step === "choose" && candidates && (
          <section style={{ display: "flex", flexDirection: "column", gap: 12 }} aria-label="選擇你的車">
            <h2 className="pd-serif" style={{ fontSize: 20, margin: 0 }}>哪一台是你的車？</h2>
            <p style={{ margin: 0, color: "var(--pd-muted)", lineHeight: 1.7 }}>
              {candidates.mode === "digits" ? `車牌有「${normalizePlate(plate).replace(/[^A-Z0-9]/g, "")}」的車有 ${candidates.list.length} 台，請看照片點選。` : "找不到完全一樣的車牌，下面是相近的車，請看照片點選。"}
            </p>
            {candidates.list.map((c) => (
              <button key={c.ref} type="button" className="pd-card" disabled={busy} onClick={() => { setError(""); setShownPlate(c.plate); void fetchQuote("", c.ref); }}
                style={{ display: "flex", gap: 14, alignItems: "center", textAlign: "left", padding: 12, cursor: "pointer", font: "inherit", color: "inherit" }}>
                <CarPhoto src={c.photo} width={132} />
                <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="pd-plate" style={{ fontSize: 20 }}>{c.plate}</span>
                  <span className="pd-label">進場 {fmtTime(new Date(c.entryAt))}・已停 {Math.floor(c.minutes / 60)} 時 {c.minutes % 60} 分</span>
                </span>
              </button>
            ))}
            {error && <p role="alert" style={{ margin: 0, color: "var(--pd-danger)" }}>{error}</p>}
            <button type="button" className="pd-btn pd-btn--block" onClick={() => { setStep("plate"); setCandidates(null); setError(""); }}>都不是，重新輸入完整車牌</button>
          </section>
        )}

        {step === "confirm" && quote && (
          <>
            {quote.photo && (
              <figure style={{ margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                <CarPhoto src={quote.photo} width="100%" />
                <figcaption className="pd-label">入場時拍的照片，請確認是你的車</figcaption>
              </figure>
            )}
            <section className="pd-card" aria-label="停車費">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                <span className="pd-plate" style={{ fontSize: 20 }}>{shownPlate ?? quote.plate}</span>
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
              {option("member", member ? "發票存到你的會員帳號，中獎會通知你" : "LINE、Google 或手機一鍵加入會員，中獎會通知你")}
              {kind === "member" && member === null && (
                <p className="pd-card" style={{ margin: 0, padding: "12px 16px", display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                  <span>還不是會員？30 秒加入，不用填資料</span>
                  <a className="pd-btn pd-btn--primary" style={{ minHeight: 40 }} href={`/join?site=${encodeURIComponent(siteCode)}&next=${encodeURIComponent(`/pay?site=${siteCode}`)}`}>加入會員</a>
                </p>
              )}
              {kind === "member" && member && <p className="pd-label" style={{ margin: "0 0 0 8px" }}>✓ 已登入會員{member.name ? `：${member.name}` : ""}</p>}
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
                    <input id="tax" className="pd-input pd-mono" inputMode="numeric" maxLength={8} placeholder="8 位數字" value={taxId} onChange={(e) => setTaxId(e.target.value.replace(/\D/g, ""))} aria-describedby="tax-hint" />
                    <TaxHint id="tax-hint" taxId={taxId} state={taxName} /></div>
                  <div className="pd-field"><label htmlFor="title">公司抬頭（選填，沒填就以統編代替）</label>
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
            <h2 className="pd-serif" style={{ margin: 0, fontSize: 20 }}>正在前往統一金流付款頁…</h2>
            <p className="pd-label pd-mono">訂單 {orderNo}</p>
            {quote.mock && <>
              <p style={{ color: "var(--pd-muted)", lineHeight: 1.8 }}>本機模擬環境不會真的跳轉，請按下方按鈕假裝付款成功。</p>
              <button type="button" className="pd-btn pd-btn--primary pd-btn--block pd-btn--lg" onClick={() => setStep("done")}>模擬付款成功</button>
            </>}
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


/** 認車照片（入場時拍的車牌＋車頭）；沒有照片或載入失敗時顯示文字 */
function CarPhoto({ src, width }: { src: string | null; width: number | string }) {
  const [failed, setFailed] = useState(false);
  const box: React.CSSProperties = { width, aspectRatio: "16 / 9", borderRadius: 10, flexShrink: 0, background: "var(--pd-accent-tint)", objectFit: "cover" };
  if (!src || failed) {
    return <span className="pd-label" style={{ ...box, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 6 }}>沒有照片</span>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="入場時拍的車牌與車頭" style={box} onError={() => setFailed(true)} />;
}
