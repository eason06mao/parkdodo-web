"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { quote, validatePlan, type CapWindow, type OverstayMode, type Precision, type PromoMode, type Promotion, type RatePlan, type RateSchedule } from "@/lib/billing/fee";

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
  return p.replace(" ", "T");
};
const fromLocalInput = (v: string) => `${v}:00+08:00`;
const nowLocal = () => toLocalInput(new Date().toISOString());

export function RatesEditor({ siteId, initial, canEdit }: { siteId: string; initial: RateSchedule; canEdit: boolean }) {
  const router = useRouter();
  const [plan, setPlan] = useState<RatePlan>(initial.base);
  const [promos, setPromos] = useState<Promotion[]>(initial.promotions);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // 試算
  const [entry, setEntry] = useState(() => toLocalInput(new Date(Date.now() - 135 * 60_000).toISOString()));
  const [exit, setExit] = useState(nowLocal);
  const [exitSec, setExitSec] = useState(0);

  const set = <K extends keyof RatePlan>(k: K, v: RatePlan[K]) => { setPlan((p) => ({ ...p, [k]: v })); setMsg(null); };
  const num = (k: "freeMinutes" | "unitMinutes" | "unitPrice" | "exitGraceMinutes") => (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value === "" ? Number.NaN : Number(e.target.value));

  const planError = validatePlan(plan);
  const trial = useMemo(() => {
    if (planError) return null;
    try {
      const exitIso = new Date(Date.parse(fromLocalInput(exit)) + exitSec * 1000).toISOString();
      return quote({ base: plan, promotions: promos }, fromLocalInput(entry), exitIso);
    } catch { return null; }
  }, [plan, promos, entry, exit, exitSec, planError]);

  const examples = useMemo(() => {
    if (planError) return [];
    const t0 = "2026-11-02T10:00:00+08:00"; // 固定基準時間（不受促銷影響時看基本費率）
    return [5, 10, 11, 30, 31, 60, 61, 120, 600].map((min) => ({
      min, amount: quote({ base: plan, promotions: [] }, t0, new Date(Date.parse(t0) + min * 60_000).toISOString()).amount,
    }));
  }, [plan, planError]);

  const addPromo = () => {
    const start = new Date(Date.now() + 86400_000); start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 7 * 86400_000);
    setPromos((p) => [...p, { id: `p-${Date.now()}`, name: "新檔期", startsAt: start.toISOString(), endsAt: end.toISOString(), overrides: { unitPrice: Math.max(0, plan.unitPrice - 10) } }]);
  };
  const updPromo = (i: number, patch: Partial<Promotion>) => setPromos((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = async () => {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/sites/${siteId}/rates`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ base: plan, promotions: promos, reason }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: body.message ?? "儲存失敗。" }); return; }
    setMsg({ ok: true, text: `已儲存第 ${body.version} 版，正在下發到場站工控機。進行中的車輛仍以入場時的費率計算。` });
    setReason("");
    router.refresh();
  };


  return (
    <div className="pd-split">
      <div style={{ flex: "999 1 560px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <section className="pd-card" aria-labelledby="base-h">
          <h2 id="base-h" className="pd-serif" style={{ margin: "0 0 14px", fontSize: 18 }}>基本費率</h2>
          <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
            <div className="pd-field"><label htmlFor="free">免費短停（分鐘）</label>
              <input id="free" type="number" min={0} className="pd-input pd-mono" value={Number.isNaN(plan.freeMinutes) ? "" : plan.freeMinutes} onChange={num("freeMinutes")} />
              <span className="pd-label">超過就從入場時間起算，不扣免費時間</span></div>
            <div className="pd-field"><label htmlFor="unit">計費單位（分鐘）</label>
              <input id="unit" type="number" min={1} className="pd-input pd-mono" value={Number.isNaN(plan.unitMinutes) ? "" : plan.unitMinutes} onChange={num("unitMinutes")} />
              <span className="pd-label">未滿一單位以一單位計</span></div>
            <div className="pd-field"><label htmlFor="price">每單位單價（元）</label>
              <input id="price" type="number" min={0} className="pd-input pd-mono" value={Number.isNaN(plan.unitPrice) ? "" : plan.unitPrice} onChange={num("unitPrice")} /></div>
            <div className="pd-field"><label htmlFor="grace">付款後離場時間（分鐘）</label>
              <input id="grace" type="number" min={5} className="pd-input pd-mono" value={Number.isNaN(plan.exitGraceMinutes) ? "" : plan.exitGraceMinutes} onChange={num("exitGraceMinutes")} />
              <span className="pd-label">超時以實際離場時間重算，補收差額</span></div>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="pd-label" style={{ marginBottom: 6 }}>計時精度</legend>
              <div className="pd-segmented" role="group" aria-label="計時精度">
                {(["minute", "second"] as Precision[]).map((p) => (
                  <button key={p} type="button" aria-pressed={plan.precision === p} onClick={() => set("precision", p)}>{p === "minute" ? "分鐘" : "秒"}</button>
                ))}
              </div>
              <span className="pd-label" style={{ display: "block", marginTop: 6 }}>{plan.precision === "minute" ? "不足 1 分鐘的秒數不計（10 分 59 秒算 10 分）" : "多 1 秒就進位（10 分 1 秒算超過免費時間）"}</span>
            </fieldset>
            <div className="pd-field"><label htmlFor="cap">當日上限（元）</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <label style={{ display: "flex", gap: 6, alignItems: "center", minHeight: 44, whiteSpace: "nowrap" }}>
                  <input type="checkbox" checked={plan.dailyCap !== null} onChange={(e) => set("dailyCap", e.target.checked ? Math.max(plan.unitPrice * 6, 100) : null)} />設定
                </label>
                <input id="cap" type="number" className="pd-input pd-mono" disabled={plan.dailyCap === null} value={plan.dailyCap ?? ""} onChange={(e) => set("dailyCap", e.target.value === "" ? Number.NaN : Number(e.target.value))} />
              </div>
              {plan.dailyCap !== null && (
                <select className="pd-select" aria-label="上限期間" value={plan.capWindow} onChange={(e) => set("capWindow", e.target.value as CapWindow)} style={{ marginTop: 8 }}>
                  <option value="calendar_day">每個日曆日（00:00 起算）</option>
                  <option value="rolling_24h">入場起每 24 小時</option>
                </select>
              )}
              <span className="pd-label">{plan.dailyCap === null ? "未設定：不封頂" : "跨日的計費單位歸屬於它開始的那一天，不會多收"}</span></div>
          </fieldset>
          {planError && <p role="alert" style={{ margin: "12px 0 0", color: "var(--pd-danger)" }}>{planError}</p>}
        </section>

        <section className="pd-card" aria-labelledby="adv-h">
          <h2 id="adv-h" className="pd-serif" style={{ margin: "0 0 14px", fontSize: 18 }}>進階規則</h2>
          <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 18 }}>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ fontWeight: 500, marginBottom: 8 }}>跨促銷檔期怎麼計價</legend>
              {([
                ["entry_time", "整趟用入場時的費率（預設）", "入場時在檔期內，整趟都是促銷價；入場時不在檔期內，整趟原價"],
                ["segmented", "依時段分段計價", "每個計費單位用它開始時的單價，檔期內的時段才用促銷價"],
              ] as [PromoMode, string, string][]).map(([v, t, d]) => (
                <label key={v} style={{ display: "flex", gap: 10, alignItems: "flex-start", minHeight: 44, marginBottom: 6 }}>
                  <input type="radio" name="promoMode" checked={plan.promoMode === v} onChange={() => set("promoMode", v)} style={{ marginTop: 4 }} />
                  <span><span style={{ display: "block" }}>{t}</span><span className="pd-label">{d}</span></span>
                </label>
              ))}
            </fieldset>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ fontWeight: 500, marginBottom: 8 }}>付款後超時離場怎麼補收</legend>
              {([
                ["recalc_from_entry", "從入場重算、補收差額（預設）", "例：已付 30 元、實際停 101 分（4 單位 120 元）→ 補 90 元"],
                ["from_grace_end", "從寬限期結束起另計", "寬限期結束後的時間另算，不再給免費時間"],
              ] as [OverstayMode, string, string][]).map(([v, t, d]) => (
                <label key={v} style={{ display: "flex", gap: 10, alignItems: "flex-start", minHeight: 44, marginBottom: 6 }}>
                  <input type="radio" name="overstayMode" checked={plan.overstayMode === v} onChange={() => set("overstayMode", v)} style={{ marginTop: 4 }} />
                  <span><span style={{ display: "block" }}>{t}</span><span className="pd-label">{d}</span></span>
                </label>
              ))}
            </fieldset>
          </fieldset>
        </section>

        <section className="pd-card" aria-labelledby="promo-h">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
            <div>
              <h2 id="promo-h" className="pd-serif" style={{ margin: 0, fontSize: 18 }}>促銷檔期</h2>
              <p className="pd-label" style={{ margin: "4px 0 0" }}>到期自動切回基本費率。入場時在檔期內的車輛，整趟都用促銷價。</p>
            </div>
            {canEdit && <button type="button" className="pd-btn" onClick={addPromo}>新增檔期</button>}
          </div>
          {promos.length === 0 && <p className="pd-label" style={{ margin: 0 }}>目前沒有排定的促銷。</p>}
          {promos.map((p, i) => (
            <fieldset key={p.id} disabled={!canEdit} style={{ border: "1px solid var(--pd-line-soft)", borderRadius: 12, padding: 14, margin: "0 0 10px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <div className="pd-field"><label htmlFor={`pn-${i}`}>名稱</label><input id={`pn-${i}`} className="pd-input" value={p.name} onChange={(e) => updPromo(i, { name: e.target.value })} /></div>
              <div className="pd-field"><label htmlFor={`ps-${i}`}>開始</label><input id={`ps-${i}`} type="datetime-local" className="pd-input" value={toLocalInput(p.startsAt)} onChange={(e) => updPromo(i, { startsAt: fromLocalInput(e.target.value) })} /></div>
              <div className="pd-field"><label htmlFor={`pe-${i}`}>結束</label><input id={`pe-${i}`} type="datetime-local" className="pd-input" value={toLocalInput(p.endsAt)} onChange={(e) => updPromo(i, { endsAt: fromLocalInput(e.target.value) })} /></div>
              <div className="pd-field"><label htmlFor={`pp-${i}`}>促銷單價（元）</label><input id={`pp-${i}`} type="number" className="pd-input pd-mono" value={p.overrides.unitPrice ?? ""} onChange={(e) => updPromo(i, { overrides: { ...p.overrides, unitPrice: e.target.value === "" ? undefined : Number(e.target.value) } })} /></div>
              {canEdit && <div style={{ display: "flex", alignItems: "flex-end" }}><button type="button" className="pd-btn" onClick={() => setPromos((x) => x.filter((_, j) => j !== i))}>移除</button></div>}
            </fieldset>
          ))}
        </section>

        {canEdit ? (
          <section className="pd-card" aria-label="儲存">
            <div className="pd-field"><label htmlFor="reason">修改原因（寫入稽核紀錄）</label>
              <input id="reason" className="pd-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例：配合周邊行情調整" /></div>
            {msg && <p role={msg.ok ? "status" : "alert"} style={{ margin: "12px 0 0", color: msg.ok ? "var(--pd-accent)" : "var(--pd-danger)" }}>{msg.text}</p>}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <button type="button" className="pd-btn pd-btn--primary" disabled={busy || !!planError} onClick={save}>{busy ? "儲存中…" : "儲存並下發到場站"}</button>
            </div>
          </section>
        ) : <p className="pd-label">你的帳號只能檢視費率；修改需要「發布費率」權限。</p>}
      </div>

      <aside style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <section className="pd-card" aria-labelledby="trial-h">
          <h2 id="trial-h" className="pd-serif" style={{ margin: "0 0 12px", fontSize: 18 }}>試算</h2>
          <div style={{ display: "grid", gap: 12 }}>
            <div className="pd-field"><label htmlFor="te">入場時間</label><input id="te" type="datetime-local" className="pd-input" value={entry} onChange={(e) => setEntry(e.target.value)} /></div>
            <div className="pd-field"><label htmlFor="tx">離場時間</label><input id="tx" type="datetime-local" className="pd-input" value={exit} onChange={(e) => setExit(e.target.value)} /></div>
            <div className="pd-field"><label htmlFor="ts">離場再加幾秒</label><input id="ts" type="number" min={0} max={59} className="pd-input pd-mono" value={exitSec} onChange={(e) => setExitSec(Math.min(59, Math.max(0, Number(e.target.value) || 0)))} /></div>
          </div>
          {trial && (
            <div aria-live="polite" style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span className="pd-label">應付 NT$</span><span className="pd-mono" style={{ fontSize: 32, fontWeight: 600 }}>{trial.amount}</span>
              </div>
              <p className="pd-label" style={{ margin: "4px 0 0" }}>
                停 <span className="pd-mono">{Math.floor(trial.duration.minutes / 60)} 時 {trial.duration.minutes % 60} 分</span>
                {plan.precision === "second" && <> <span className="pd-mono">{trial.duration.seconds % 60}</span> 秒</>}
                ・{trial.free ? "免費短停" : `${trial.billableUnits} 個單位`}
                {trial.capped && "・已達當日上限"}{trial.promotion && `・適用「${trial.promotion.name}」`}
              </p>
            </div>
          )}
        </section>
        <section className="pd-card" aria-labelledby="ex-h">
          <h2 id="ex-h" className="pd-serif" style={{ margin: "0 0 10px", fontSize: 18 }}>對照表（基本費率）</h2>
          <table className="pd-table">
            <thead><tr><th>停車</th><th className="pd-num">金額</th></tr></thead>
            <tbody>{examples.map((e) => <tr key={e.min}><td className="pd-mono">{e.min >= 60 ? `${Math.floor(e.min / 60)} 時${e.min % 60 ? ` ${e.min % 60} 分` : ""}` : `${e.min} 分`}</td><td className="pd-num">{e.amount}</td></tr>)}</tbody>
          </table>
        </section>
      </aside>
    </div>
  );
}
