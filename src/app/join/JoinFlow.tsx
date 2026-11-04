"use client";

import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { accentVars, type Brand } from "@/lib/branding";
import { formatPhone, MAX_MEMBER_PLATES, normalizePhone, PROVIDER_LABELS, type ProfileErrors, type Provider } from "@/lib/members";

export interface JoinSite { code: string; name: string; plans: { id: string; name: string; price: number }[] }
type Step = "loading" | "phone" | "code" | "profile" | "done";
interface Member { id: string; phone: string | null; email: string | null; name: string; plates: string[]; providers: Provider[] }
export interface JoinNotice { login?: string; linked?: boolean; isNew?: boolean; error?: string }

const ERRORS: Record<string, string> = {
  expired: "登入逾時，請再按一次。", cancelled: "已取消登入。", failed: "登入失敗，請再試一次或改用其他方式。",
  unavailable: "這個登入方式暫時無法使用，請改用其他方式。",
  conflict: "你的會員已經綁定另一個同類型的帳號，無法再綁定。",
};

async function call<T>(url: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T & { message?: string; errors?: ProfileErrors; waitSec?: number } }> {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}

export function JoinFlow({ brand, sites, siteCode, next, mock, notice }: { brand: Brand; sites: JoinSite[]; siteCode: string | null; next: string | null; mock: boolean; notice: JoinNotice }) {
  const [step, setStep] = useState<Step>("loading");
  const [binding, setBinding] = useState(false); // 已登入，正在綁定手機
  const [banner, setBanner] = useState(notice.login ? `${notice.linked ? "已綁定" : "已用"} ${PROVIDER_LABELS[notice.login as Provider] ?? notice.login} ${notice.linked ? "" : "登入"}`.trim() : "");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [wait, setWait] = useState(0);
  const [member, setMember] = useState<Member | null>(null);
  const [isNew, setIsNew] = useState(true);
  const [name, setName] = useState("");
  const [plates, setPlates] = useState<string[]>([""]);
  const [wantMonthly, setWantMonthly] = useState(false);
  const [leadSite, setLeadSite] = useState(siteCode ?? sites[0]?.code ?? "");
  const [leadPlan, setLeadPlan] = useState<string | null>(null);
  const [leadNote, setLeadNote] = useState("");
  const [leadSent, setLeadSent] = useState(false);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [error, setError] = useState(notice.error ? ERRORS[notice.error] ?? ERRORS.failed : "");
  const [leadPhone, setLeadPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  const fill = (m: Member) => { setMember(m); setName(m.name); setPlates(m.plates.length ? m.plates : [""]); setLeadPhone((p) => p || (m.phone ? formatPhone(m.phone) : "")); };

  useEffect(() => {
    call<{ member: Member | null }>("/api/members/me", "GET").then(({ data }) => {
      if (data.member) { fill(data.member); setIsNew(!!notice.isNew); setStep("profile"); } else setStep("phone");
    }).catch(() => setStep("phone"));
    // 網址上的登入結果只顯示一次
    if (notice.login || notice.error) {
      const u = new URL(location.href); ["login", "linked", "new", "error", "p"].forEach((k) => u.searchParams.delete(k)); history.replaceState(null, "", u);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const oauthHref = (p: "line" | "google") => {
    const q = new URLSearchParams(); if (siteCode) q.set("site", siteCode); if (next) q.set("next", next);
    return `/api/members/oauth/${p}/start${q.size ? `?${q}` : ""}`;
  };
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  useEffect(() => { if (step === "code") codeRef.current?.focus(); }, [step]);

  const sendCode = async () => {
    setError("");
    if (!normalizePhone(phone)) { setError("請輸入 09 開頭的 10 碼手機號碼。"); return; }
    setBusy(true);
    const r = await call<{ devCode?: string; resendSec: number }>("/api/members/otp", "POST", { phone });
    setBusy(false);
    if (!r.ok) { setError(r.data.message ?? "寄送失敗，請再試一次。"); if (r.data.waitSec && r.status === 429) setWait(r.data.waitSec); return; }
    setDevCode(r.data.devCode ?? ""); setWait(r.data.resendSec); setCode(""); setStep("code");
  };

  const verify = async (v = code) => {
    setError("");
    if (v.length !== 6) { setError("請輸入 6 位數驗證碼。"); return; }
    setBusy(true);
    const r = await call<{ member: Member; isNew: boolean }>("/api/members/verify", "POST", { phone, code: v, site: siteCode, agree: true });
    setBusy(false);
    if (!r.ok) { setError(r.data.message ?? "驗證失敗，請再試一次。"); return; }
    fill(r.data.member); setIsNew(r.data.isNew && !binding);
    if (binding) setBanner("已綁定手機");
    setBinding(false); setStep("profile");
  };

  const save = async () => {
    setError(""); setErrors({});
    const lead = wantMonthly ? { siteCode: leadSite, planId: leadPlan, name, phone: leadPhone, note: leadNote } : null;
    setBusy(true);
    const r = await call<{ member: Member }>("/api/members/me", "PUT", { name, plates, lead });
    setBusy(false);
    if (r.status === 401) { setStep("phone"); setError("登入已過期，請重新驗證手機。"); return; }
    if (!r.ok) { setErrors(r.data.errors ?? {}); setError(r.data.message ?? "儲存失敗，請再試一次。"); return; }
    fill(r.data.member); setLeadSent(!!lead); setStep("done");
  };

  const logout = async () => { await call("/api/members/me", "DELETE"); setMember(null); setPhone(""); setCode(""); setBanner(""); setStep("phone"); };

  const site = sites.find((s) => s.code === leadSite);

  return (
    <div style={{ minHeight: "100vh", maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", background: "var(--pd-ground)", ...(accentVars(brand.accentColor) as React.CSSProperties) }}>
      {mock && <div className="pd-mock-banner" role="note">模擬環境・不會寄出簡訊，LINE／Google 為模擬登入</div>}
      <header style={{ padding: "22px 20px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}><BrandMark brand={brand} size={32} /><span style={{ fontWeight: 700 }}>{brand.displayName} 停車會員</span></div>
        <h1 className="pd-serif" style={{ margin: "2px 0 0", fontSize: 24 }}>{step === "profile" && !isNew ? "我的會員資料" : "加入會員"}</h1>
      </header>

      <main style={{ padding: "12px 20px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
        {step === "loading" && <p className="pd-label" aria-live="polite">載入中…</p>}

        {step === "phone" && (
          <>
            {!binding && (
              <>
                <ul className="pd-card" style={{ margin: 0, padding: "16px 20px 16px 36px", display: "grid", gap: 6 }}>
                  <li>發票自動存會員載具，中獎會通知你</li>
                  <li>登記車牌，之後繳費更快</li>
                  <li>想租月租可以直接線上登記</li>
                </ul>
                <a href={oauthHref("line")} className="pd-btn pd-btn--block pd-btn--lg" style={{ background: "#06C755", borderColor: "#06C755", color: "#fff", fontWeight: 600 }}>用 LINE 登入</a>
                <a href={oauthHref("google")} className="pd-btn pd-btn--block pd-btn--lg" style={{ fontWeight: 600 }}>用 Google 登入</a>
                <div role="separator" style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--pd-muted)", fontSize: 13 }}>
                  <span style={{ flex: 1, height: 1, background: "var(--pd-line)" }} />或用手機簡訊驗證<span style={{ flex: 1, height: 1, background: "var(--pd-line)" }} />
                </div>
              </>
            )}
            {binding && <p style={{ margin: 0 }}>綁定手機後，客服可以直接用這支電話聯絡你，之後也能用簡訊登入。</p>}
            <div className="pd-field">
              <label htmlFor="phone">手機號碼</label>
              <input id="phone" className="pd-input pd-mono" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="0912-345-678"
                style={{ fontSize: 18, minHeight: 52 }} value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendCode()} />
            </div>
            {error && <p role="alert" style={{ margin: 0, color: "var(--pd-danger)" }}>{error}</p>}
            <button type="button" className={`pd-btn pd-btn--block pd-btn--lg${binding ? " pd-btn--primary" : ""}`} onClick={sendCode} disabled={busy || wait > 0}>
              {busy ? "寄送中…" : wait > 0 ? `${wait} 秒後可重寄` : "取得簡訊驗證碼"}
            </button>
            {binding && <button type="button" className="pd-btn" onClick={() => { setBinding(false); setError(""); setStep("profile"); }}>返回</button>}
            <details className="pd-label" style={{ lineHeight: 1.8 }}>
              <summary style={{ cursor: "pointer", minHeight: 28 }}>登入即表示你已閱讀並同意《個人資料告知事項》</summary>
              <p style={{ margin: "6px 0" }}>{brand.displayName} 停車場營運方依個人資料保護法告知：</p>
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                <li>蒐集目的：會員管理、電子發票會員載具與中獎通知、停車繳費、月租洽詢與客服聯絡。</li>
                <li>蒐集項目：手機號碼、Email、LINE／Google 帳號識別碼與顯示名稱、稱呼、車牌號碼、月租登記內容，以及停車進出與繳費紀錄。</li>
                <li>利用期間與地區：會員存續期間及法令規定的保存期間，於中華民國境內利用。</li>
                <li>你可以隨時要求查詢、更正、停止利用或刪除你的資料，請洽場內客服電話。</li>
                <li>不加入會員不影響一般停車與繳費。</li>
              </ol>
            </details>
          </>
        )}

        {step === "code" && (
          <>
            <p style={{ margin: 0 }}>驗證碼已傳到 <span className="pd-mono">{formatPhone(normalizePhone(phone) ?? phone)}</span>，5 分鐘內有效。</p>
            {devCode && <p className="pd-card pd-card--warn" style={{ margin: 0, padding: "12px 16px" }}>模擬模式驗證碼：<span className="pd-mono" style={{ fontWeight: 600, fontSize: 18 }}>{devCode}</span></p>}
            <div className="pd-field">
              <label htmlFor="code">6 位數驗證碼</label>
              <input id="code" ref={codeRef} className="pd-input pd-mono" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                style={{ fontSize: 24, letterSpacing: "0.3em", minHeight: 56, textAlign: "center" }} value={code}
                onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 6); setCode(v); if (v.length === 6) verify(v); }} />
            </div>
            {error && <p role="alert" style={{ margin: 0, color: "var(--pd-danger)" }}>{error}</p>}
            <button type="button" className="pd-btn pd-btn--primary pd-btn--block pd-btn--lg" onClick={() => verify()} disabled={busy}>{busy ? "驗證中…" : "驗證"}</button>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <button type="button" className="pd-btn" onClick={() => { setStep("phone"); setError(""); }}>{binding ? "返回" : "改手機號碼"}</button>
              <button type="button" className="pd-btn" onClick={sendCode} disabled={busy || wait > 0}>{wait > 0 ? `${wait} 秒後重寄` : "重寄驗證碼"}</button>
            </div>
          </>
        )}

        {step === "profile" && member && (
          <>
            <section className="pd-card pd-card--selected" style={{ padding: "12px 16px", display: "grid", gap: 8 }}>
              <div>✓ {banner || (isNew ? "已加入會員" : "已登入")}{isNew && banner ? "，已加入會員" : ""}</div>
              <div className="pd-label">
                登入方式：{member.providers.map((p) => PROVIDER_LABELS[p]).join("、")}
                {member.phone && <>　手機 <span className="pd-mono">{formatPhone(member.phone)}</span></>}
                {member.email && <>　{member.email}</>}
              </div>
              {member.providers.length < 3 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <span className="pd-label" style={{ alignSelf: "center" }}>再綁定：</span>
                  {!member.providers.includes("line") && <a className="pd-btn" style={{ minHeight: 36 }} href={oauthHref("line")}>LINE</a>}
                  {!member.providers.includes("google") && <a className="pd-btn" style={{ minHeight: 36 }} href={oauthHref("google")}>Google</a>}
                  {!member.providers.includes("phone") && <button type="button" className="pd-btn" style={{ minHeight: 36 }} onClick={() => { setBinding(true); setError(""); setPhone(""); setStep("phone"); }}>手機</button>}
                </div>
              )}
            </section>
            <p className="pd-label" style={{ margin: 0 }}>以下都可以不填，直接按「完成」。</p>
            <div className="pd-field">
              <label htmlFor="name">稱呼（選填）</label>
              <input id="name" className="pd-input" placeholder="例：王先生" autoComplete="name" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} />
              {errors.name && <span role="alert" style={{ color: "var(--pd-danger)", fontSize: 13 }}>{errors.name}</span>}
            </div>
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
              <legend className="pd-label" style={{ marginBottom: 6 }}>車牌（選填，最多 {MAX_MEMBER_PLATES} 台）</legend>
              {plates.map((p, i) => (
                <div key={i}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input aria-label={`車牌 ${i + 1}`} className="pd-input pd-input--plate" placeholder="ABC-1234" autoCapitalize="characters" autoComplete="off" maxLength={9}
                      value={p} onChange={(e) => setPlates(plates.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)))} />
                    {plates.length > 1 && <button type="button" className="pd-btn" aria-label={`刪除車牌 ${i + 1}`} onClick={() => setPlates(plates.filter((_, j) => j !== i))}>刪除</button>}
                  </div>
                  {errors.plates?.[i] && <span role="alert" style={{ color: "var(--pd-danger)", fontSize: 13 }}>{errors.plates[i]}</span>}
                </div>
              ))}
              {plates.length < MAX_MEMBER_PLATES && <button type="button" className="pd-btn" style={{ justifySelf: "start" }} onClick={() => setPlates([...plates, ""])}>＋ 再加一台</button>}
            </fieldset>

            {sites.length > 0 && (
              <section className={`pd-card${wantMonthly ? " pd-card--selected" : ""}`} style={{ padding: "14px 16px", display: "grid", gap: 12 }}>
                <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                  <input type="checkbox" checked={wantMonthly} onChange={(e) => setWantMonthly(e.target.checked)} style={{ width: 18, height: 18, marginTop: 4, flex: "none" }} />
                  <span><span style={{ fontWeight: 500, display: "block" }}>我想租月租</span><span className="pd-label">先登記，客服會打電話跟你確認方案和簽約</span></span>
                </label>
                {wantMonthly && (
                  <>
                    {sites.length > 1 && (
                      <div className="pd-field"><label htmlFor="lsite">停車場</label>
                        <select id="lsite" className="pd-select" value={leadSite} onChange={(e) => { setLeadSite(e.target.value); setLeadPlan(null); }}>
                          {sites.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                        </select></div>
                    )}
                    {sites.length === 1 && <p className="pd-label" style={{ margin: 0 }}>停車場：{sites[0].name}</p>}
                    <div role="radiogroup" aria-label="想租的方案" style={{ display: "grid", gap: 8 }}>
                      {[...(site?.plans ?? []), { id: "", name: "還不確定，請客服介紹", price: 0 }].map((p) => {
                        const on = (leadPlan ?? "") === p.id;
                        return (
                          <label key={p.id || "none"} className={`pd-card${on ? " pd-card--selected" : ""}`} style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 14px", cursor: "pointer" }}>
                            <input type="radio" name="plan" checked={on} onChange={() => setLeadPlan(p.id || null)} style={{ width: 18, height: 18 }} />
                            <span style={{ flex: 1 }}>{p.name}</span>
                            {p.price > 0 && <span className="pd-mono">NT${p.price.toLocaleString()}/月</span>}
                          </label>
                        );
                      })}
                    </div>
                    {!name.trim() && (
                      <p style={{ margin: 0, color: errors.leadName ? "var(--pd-danger)" : "var(--pd-muted)", fontSize: 13 }} role={errors.leadName ? "alert" : undefined}>
                        登記月租請在上方留個稱呼，客服才知道怎麼稱呼你。
                      </p>
                    )}
                    <div className="pd-field"><label htmlFor="lphone">聯絡手機</label>
                      <input id="lphone" className="pd-input pd-mono" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="0912-345-678" value={leadPhone} onChange={(e) => setLeadPhone(e.target.value)} />
                      {errors.leadPhone && <span role="alert" style={{ color: "var(--pd-danger)", fontSize: 13 }}>{errors.leadPhone}</span>}</div>
                    <div className="pd-field"><label htmlFor="lnote">想說的話（選填）</label>
                      <textarea id="lnote" className="pd-textarea" rows={2} maxLength={200} placeholder="例：想從 12 月開始、晚上 6 點後方便接電話" value={leadNote} onChange={(e) => setLeadNote(e.target.value)} /></div>
                    {errors.lead && <span role="alert" style={{ color: "var(--pd-danger)", fontSize: 13 }}>{errors.lead}</span>}
                  </>
                )}
              </section>
            )}
            {error && <p role="alert" style={{ margin: 0, color: "var(--pd-danger)" }}>{error}</p>}
            <button type="button" className="pd-btn pd-btn--primary pd-btn--block pd-btn--lg" onClick={save} disabled={busy}>{busy ? "儲存中…" : wantMonthly ? "完成並送出月租登記" : "完成"}</button>
            <button type="button" className="pd-btn" style={{ alignSelf: "center" }} onClick={logout}>不是我，換一支手機</button>
          </>
        )}

        {step === "done" && member && (
          <section className="pd-card" style={{ textAlign: "center", padding: "28px 22px", display: "grid", gap: 10 }} aria-live="polite">
            <div style={{ fontSize: 40, color: "var(--pd-accent)" }} aria-hidden>✓</div>
            <h2 className="pd-serif" style={{ margin: 0, fontSize: 20 }}>{isNew ? "加入完成" : "資料已更新"}</h2>
            <p style={{ margin: 0 }}>之後繳費選「存入會員載具」，發票會存到你的會員帳號，中獎會通知你。</p>
            {member.plates.length > 0 && <p className="pd-label" style={{ margin: 0 }}>登記車牌：<span className="pd-mono">{member.plates.join("、")}</span></p>}
            {leadSent && <p className="pd-card pd-card--selected" style={{ margin: 0, padding: "10px 14px" }}>月租登記已送出，客服會打 <span className="pd-mono">{leadPhone}</span> 和你聯絡。</p>}
            {next && <a className="pd-btn pd-btn--primary pd-btn--block pd-btn--lg" href={next}>回到繳費</a>}
            <button type="button" className="pd-btn" onClick={() => { setStep("profile"); setWantMonthly(false); setLeadNote(""); setLeadPlan(null); }}>修改資料</button>
          </section>
        )}
      </main>
    </div>
  );
}
