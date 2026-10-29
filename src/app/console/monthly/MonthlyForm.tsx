"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  addDays, amounts, contractState, EARLY_ACTIVATION_DAYS, emptyCustomer, emptyVehicle, endsOn, formatPlate, hasErrors, MAX_PLATES,
  PAYMENT_METHOD_LABELS, PLAN_TYPE_LABELS, STATE_LABELS, TERM_OPTIONS, todayTaipei, validateContract,
  type ContractErrors, type ContractInput, type InvoiceKind, type MonthlyPlan, type PaymentMethod, type VehicleInput,
} from "@/lib/monthly";

export type FormSite = { id: string; name: string; spaces: { code: string; takenUntil?: string }[] };

const INVOICE_OPTIONS: { kind: InvoiceKind; label: string }[] = [
  { kind: "paper", label: "列印紙本" },
  { kind: "mobile", label: "手機條碼" },
  { kind: "company", label: "公司統編" },
  { kind: "donate", label: "捐贈" },
];
const money = (n: number) => `NT$${n.toLocaleString("zh-TW")}`;
const zh = (d: string) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}（${d.slice(0, 4)}）` : "—");

function H({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <legend style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 4, padding: "0 0 10px", width: "100%", borderBottom: "1px solid var(--pd-line-soft)" }}>
      <span className="pd-serif" style={{ fontSize: 18 }}><span className="pd-mono pd-label" style={{ marginRight: 8 }}>{n}</span>{title}</span>
      {hint && <span className="pd-label" style={{ lineHeight: 1.7 }}>{hint}</span>}
    </legend>
  );
}

export function MonthlyForm({ sites, plans, operator }: { sites: FormSite[]; plans: MonthlyPlan[]; operator: string }) {
  const router = useRouter();
  const today = todayTaipei();
  const firstOfNext = (() => { const [y, m] = today.split("-").map(Number); return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`; })();

  const [v, setV] = useState<ContractInput>(() => {
    const plan = plans.find((p) => p.siteId === sites[0].id)!;
    return {
      siteId: sites[0].id, planId: plan.id, space: "", customer: emptyCustomer(), vehicles: [emptyVehicle()],
      startsOn: firstOfNext, activatesOn: firstOfNext, months: 1, monthlyFee: plan.monthlyPrice, discount: 0, discountReason: "", deposit: 0,
      paymentMethod: "cash", paymentStatus: "paid", paymentRef: "", invoiceKind: "paper", invoiceValue: "", remindDays: 14, note: "",
    };
  });
  const [activationTouched, setActivationTouched] = useState(false);
  const [errors, setErrors] = useState<ContractErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState("");
  const [busy, setBusy] = useState(false);

  const site = sites.find((s) => s.id === v.siteId)!;
  const sitePlans = plans.filter((p) => p.siteId === v.siteId);
  const plan = sitePlans.find((p) => p.id === v.planId);
  const ends = endsOn(v.startsOn || today, v.months);
  const a = amounts(v);
  const state = contractState({ ...v, endsOn: ends });

  const set = (patch: Partial<ContractInput>) => {
    const next = { ...v, ...patch };
    if (patch.startsOn !== undefined && !activationTouched) next.activatesOn = patch.startsOn;
    setV(next);
    if (submitted) {
      const errs = validateContract(next, plans.find((p) => p.id === next.planId));
      setErrors(errs);
      if (!hasErrors(errs)) setServerError("");
    }
  };
  const setCustomer = (patch: Partial<ContractInput["customer"]>) => set({ customer: { ...v.customer, ...patch } });
  const setVehicle = (i: number, patch: Partial<VehicleInput>) => set({ vehicles: v.vehicles.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const choosePlan = (p: MonthlyPlan) => set({ planId: p.id, monthlyFee: p.monthlyPrice, space: p.type === "fixed" ? v.space : "" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true); setServerError("");
    const errs = validateContract(v, plan);
    setErrors(errs);
    if (hasErrors(errs)) { setServerError("有欄位需要修正，請看紅字說明。"); return; }
    setBusy(true);
    const res = await fetch("/api/monthly", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(v) }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res?.ok) { setServerError(body?.message ?? "儲存失敗，請再試一次。"); if (body?.errors) setErrors(body.errors); return; }
    router.push(`/console/monthly/${body.id}?created=1`);
    router.refresh();
  };

  const err = (k: keyof ContractErrors) => {
    const m = errors[k];
    return typeof m === "string" ? <span role="alert" style={{ color: "var(--pd-danger)", fontSize: 13 }}>{m}</span> : null;
  };
  const fs: React.CSSProperties = { border: 0, padding: 0, margin: 0, display: "grid", gap: 14, minWidth: 0 };
  const row: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 };

  return (
    <div className="pd-split">
      <form onSubmit={submit} className="pd-card" style={{ flex: "999 1 620px", minWidth: 0, display: "grid", gap: 30 }} noValidate>
        {/* 1 方案 */}
        <fieldset style={fs}>
          <H n={1} title="方案與車位" />
          {sites.length > 1 && (
            <div className="pd-field"><label htmlFor="msite">站點</label>
              <select id="msite" className="pd-select" value={v.siteId} onChange={(e) => {
                const p = plans.find((x) => x.siteId === e.target.value)!;
                set({ siteId: e.target.value, planId: p.id, monthlyFee: p.monthlyPrice, space: "" });
              }}>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          )}
          <div role="radiogroup" aria-label="方案" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
            {sitePlans.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={v.planId === p.id} onClick={() => choosePlan(p)}
                className={`pd-card${v.planId === p.id ? " pd-card--selected" : ""}`} style={{ textAlign: "left", cursor: "pointer", padding: 14, display: "grid", gap: 4 }}>
                <span style={{ fontWeight: 500 }}>{p.name}</span>
                <span className="pd-label">{PLAN_TYPE_LABELS[p.type]}{p.maxContracts ? `・上限 ${p.maxContracts} 份` : ""}</span>
                <span className="pd-mono" style={{ fontSize: 18 }}>{money(p.monthlyPrice)}<span className="pd-label"> / 月</span></span>
              </button>
            ))}
          </div>
          {err("planId")}
          {plan?.type === "fixed" && (
            <div className="pd-field"><label htmlFor="mspace">車位</label>
              <select id="mspace" className="pd-select" value={v.space} onChange={(e) => set({ space: e.target.value })} style={{ maxWidth: 280 }}>
                <option value="">請選擇車位</option>
                {site.spaces.map((s) => <option key={s.code} value={s.code} disabled={!!s.takenUntil}>{s.code}{s.takenUntil ? `（出租中，到 ${s.takenUntil}）` : ""}</option>)}
              </select>{err("space")}</div>
          )}
          {plan?.type === "shared" && <p className="pd-label" style={{ margin: 0 }}>共用月租先到先停、不保證車位；共用區滿位時需等待。</p>}
        </fieldset>

        {/* 2 客戶 */}
        <fieldset style={fs}>
          <H n={2} title="客戶資料" hint="電話用來通知到期與付款；公司戶可開統編發票。" />
          <div className="pd-segmented" role="group" aria-label="客戶類型" style={{ justifySelf: "start", alignSelf: "flex-start" }}>
            {(["person", "company"] as const).map((t) => (
              <button key={t} type="button" aria-pressed={v.customer.type === t}
                onClick={() => setCustomer({ type: t })}>{t === "person" ? "個人" : "公司"}</button>
            ))}
          </div>
          {v.customer.type === "company" && (
            <div style={row}>
              <div className="pd-field"><label htmlFor="mco">公司名稱</label><input id="mco" className="pd-input" value={v.customer.companyName} onChange={(e) => setCustomer({ companyName: e.target.value })} />{err("companyName")}</div>
              <div className="pd-field"><label htmlFor="mtax">統一編號</label><input id="mtax" className="pd-input pd-mono" inputMode="numeric" maxLength={8} value={v.customer.taxId} onChange={(e) => setCustomer({ taxId: e.target.value.replace(/\D/g, "") })} />{err("taxId")}</div>
            </div>
          )}
          <div style={row}>
            <div className="pd-field"><label htmlFor="mname">{v.customer.type === "company" ? "聯絡人" : "姓名"}</label><input id="mname" className="pd-input" autoComplete="off" value={v.customer.name} onChange={(e) => setCustomer({ name: e.target.value })} />{err("name")}</div>
            <div className="pd-field"><label htmlFor="mphone">電話</label><input id="mphone" className="pd-input pd-mono" type="tel" placeholder="0912-345-678" value={v.customer.phone} onChange={(e) => setCustomer({ phone: e.target.value })} />{err("phone")}</div>
            <div className="pd-field"><label htmlFor="memail">Email（選填）</label><input id="memail" className="pd-input" type="email" value={v.customer.email} onChange={(e) => setCustomer({ email: e.target.value })} />{err("email")}</div>
          </div>
          <div className="pd-field"><label htmlFor="maddr">地址（選填）</label><input id="maddr" className="pd-input" value={v.customer.address} onChange={(e) => setCustomer({ address: e.target.value })} /></div>
        </fieldset>

        {/* 3 車輛 */}
        <fieldset style={fs}>
          <H n={3} title="車輛" hint={`最多 ${MAX_PLATES} 台；同一時間只能一台以月租進場，第二台以臨停計費。`} />
          {v.vehicles.map((x, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, alignItems: "end", paddingBottom: 10, borderBottom: "1px dashed var(--pd-line-soft)" }}>
              <div className="pd-field"><label htmlFor={`mplate${i}`}>車牌{v.vehicles.length > 1 ? ` ${i + 1}` : ""}</label>
                <input id={`mplate${i}`} className="pd-input pd-input--plate" autoComplete="off" placeholder="ABC-1234" value={x.plate} onChange={(e) => setVehicle(i, { plate: formatPlate(e.target.value) })} /></div>
              <div className="pd-field"><label htmlFor={`mkind${i}`}>車種</label>
                <select id={`mkind${i}`} className="pd-select" value={x.kind} onChange={(e) => setVehicle(i, { kind: e.target.value as VehicleInput["kind"] })}><option value="car">汽車</option><option value="motorcycle">機車</option></select></div>
              <div className="pd-field"><label htmlFor={`mbrand${i}`}>廠牌（選填）</label><input id={`mbrand${i}`} className="pd-input" value={x.brand} onChange={(e) => setVehicle(i, { brand: e.target.value })} /></div>
              <div className="pd-field"><label htmlFor={`mcolor${i}`}>顏色（選填）</label><input id={`mcolor${i}`} className="pd-input" value={x.color} onChange={(e) => setVehicle(i, { color: e.target.value })} /></div>
              <button type="button" className="pd-btn" style={{ justifySelf: "start" }} aria-label={`移除車牌 ${i + 1}`} disabled={v.vehicles.length === 1} onClick={() => set({ vehicles: v.vehicles.filter((_, j) => j !== i) })}>移除</button>
              {errors.plates?.[i] && <span role="alert" style={{ color: "var(--pd-danger)", fontSize: 13, gridColumn: "1 / -1" }}>{errors.plates[i]}</span>}
            </div>
          ))}
          {err("vehicles")}
          {v.vehicles.length < MAX_PLATES && <button type="button" className="pd-btn" style={{ justifySelf: "start" }} onClick={() => set({ vehicles: [...v.vehicles, emptyVehicle()] })}>＋ 再加一台</button>}
        </fieldset>

        {/* 4 期間 */}
        <fieldset style={fs}>
          <H n={4} title="合約期間" hint={`生效日＝月租費起算日。啟用日＝車牌開通、可以進出的日期，預設同生效日，最多可提早 ${EARLY_ACTIVATION_DAYS} 天。`} />
          <div style={row}>
            <div className="pd-field"><label htmlFor="mstart">生效日</label><input id="mstart" type="date" className="pd-input" value={v.startsOn} onChange={(e) => set({ startsOn: e.target.value })} />{err("startsOn")}</div>
            <div className="pd-field"><span className="pd-label" id="mterm-l" style={{ fontSize: 14 }}>期數</span>
              <div className="pd-choice-grid" role="group" aria-labelledby="mterm-l" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
                {TERM_OPTIONS.map((m) => <button key={m} type="button" className="pd-choice" aria-pressed={v.months === m} onClick={() => set({ months: m })}>{m} 個月</button>)}
              </div>{err("months")}</div>
          </div>
          <div style={row}>
            <div className="pd-field"><label htmlFor="mact">啟用日（車牌開通）</label>
              <input id="mact" type="date" className="pd-input" value={v.activatesOn} min={v.startsOn ? addDays(v.startsOn, -EARLY_ACTIVATION_DAYS) : undefined} max={ends}
                onChange={(e) => { setActivationTouched(true); set({ activatesOn: e.target.value }); }} />{err("activatesOn")}
              {activationTouched && v.activatesOn !== v.startsOn && <button type="button" className="pd-label" style={{ background: "none", border: 0, padding: 0, textAlign: "left", textDecoration: "underline", cursor: "pointer" }} onClick={() => { setActivationTouched(false); set({ activatesOn: v.startsOn }); }}>改回與生效日相同</button>}
            </div>
            <div className="pd-field"><span className="pd-label" style={{ fontSize: 14 }}>到期日</span>
              <div className="pd-input pd-mono" aria-live="polite" style={{ display: "flex", alignItems: "center", background: "var(--pd-surface-sunk)" }}>{v.startsOn ? ends : "—"}</div>
              <span className="pd-label">依生效日與期數自動計算</span></div>
          </div>
        </fieldset>

        {/* 5 費用 */}
        <fieldset style={fs}>
          <H n={5} title="費用與付款" />
          <div style={row}>
            <div className="pd-field"><label htmlFor="mfee">月費（NT$）</label><input id="mfee" className="pd-input pd-mono" inputMode="numeric" value={v.monthlyFee} onChange={(e) => set({ monthlyFee: Number(e.target.value.replace(/\D/g, "") || 0) })} />
              {plan && v.monthlyFee !== plan.monthlyPrice && <span className="pd-label">方案價 {money(plan.monthlyPrice)}</span>}{err("monthlyFee")}</div>
            <div className="pd-field"><label htmlFor="mdisc">折扣（NT$）</label><input id="mdisc" className="pd-input pd-mono" inputMode="numeric" value={v.discount} onChange={(e) => set({ discount: Number(e.target.value.replace(/\D/g, "") || 0) })} />{err("discount")}</div>
            <div className="pd-field"><label htmlFor="mdep">押金（NT$，選填）</label><input id="mdep" className="pd-input pd-mono" inputMode="numeric" value={v.deposit} onChange={(e) => set({ deposit: Number(e.target.value.replace(/\D/g, "") || 0) })} /><span className="pd-label">例：遙控器、磁扣</span>{err("deposit")}</div>
          </div>
          {v.discount > 0 && <div className="pd-field"><label htmlFor="mdr">折扣原因</label><input id="mdr" className="pd-input" placeholder="例：預繳半年 9 折" value={v.discountReason} onChange={(e) => set({ discountReason: e.target.value })} /></div>}
          <div className="pd-field"><span className="pd-label" id="mpay-l" style={{ fontSize: 14 }}>付款方式</span>
            <div className="pd-choice-grid" role="group" aria-labelledby="mpay-l">
              {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                <button key={m} type="button" className="pd-choice" aria-pressed={v.paymentMethod === m}
                  onClick={() => set({ paymentMethod: m, paymentStatus: m === "online" ? "unpaid" : v.paymentStatus })}>{PAYMENT_METHOD_LABELS[m]}</button>
              ))}
            </div></div>
          <div style={row}>
            <div className="pd-field"><span className="pd-label" style={{ fontSize: 14 }} id="mps-l">付款狀態</span>
              <div className="pd-segmented" role="group" aria-labelledby="mps-l" style={{ alignSelf: "flex-start" }}>
                <button type="button" aria-pressed={v.paymentStatus === "paid"} disabled={v.paymentMethod === "online"} onClick={() => set({ paymentStatus: "paid" })}>已收款</button>
                <button type="button" aria-pressed={v.paymentStatus === "unpaid"} onClick={() => set({ paymentStatus: "unpaid" })}>待付款</button>
              </div>
              {v.paymentStatus === "unpaid" && <span className="pd-label">付款確認前合約為「待開通」，車牌不能進出。</span>}</div>
            {v.paymentStatus === "paid" && (v.paymentMethod === "transfer" || v.paymentMethod === "card") && (
              <div className="pd-field"><label htmlFor="mref">{v.paymentMethod === "transfer" ? "轉帳帳號末五碼" : "刷卡授權碼"}</label>
                <input id="mref" className="pd-input pd-mono" value={v.paymentRef} onChange={(e) => set({ paymentRef: e.target.value })} /></div>
            )}
          </div>
          {err("paymentRef")}
        </fieldset>

        {/* 6 發票與提醒 */}
        <fieldset style={fs}>
          <H n={6} title="發票與到期提醒" />
          <div className="pd-choice-grid" role="group" aria-label="發票">
            {INVOICE_OPTIONS.map((o) => (
              <button key={o.kind} type="button" className="pd-choice" aria-pressed={v.invoiceKind === o.kind}
                onClick={() => set({ invoiceKind: o.kind, invoiceValue: "" })}>{o.label}</button>
            ))}
          </div>
          {(v.invoiceKind === "mobile" || v.invoiceKind === "donate") && (
            <div className="pd-field" style={{ maxWidth: 280 }}><label htmlFor="minv">{v.invoiceKind === "mobile" ? "手機條碼" : "愛心碼"}</label>
              <input id="minv" className="pd-input pd-mono" placeholder={v.invoiceKind === "mobile" ? "/ABC1234" : "例：168"} value={v.invoiceValue}
                onChange={(e) => set({ invoiceValue: v.invoiceKind === "mobile" ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, "") })} /></div>
          )}
          {v.invoiceKind === "company" && <p className="pd-label" style={{ margin: 0 }}>{v.customer.type === "company" && v.customer.taxId ? `開立統編 ${v.customer.taxId}・${v.customer.companyName || "（公司名稱）"}` : "請在客戶資料選「公司」並填寫統編。"}</p>}
          {err("invoiceValue")}
          <div style={row}>
            <div className="pd-field"><label htmlFor="mrem">到期前幾天提醒續約</label><input id="mrem" className="pd-input pd-mono" inputMode="numeric" value={v.remindDays} onChange={(e) => set({ remindDays: Number(e.target.value.replace(/\D/g, "") || 0) })} />{err("remindDays")}</div>
          </div>
          <div className="pd-field"><label htmlFor="mnote">備註（選填）</label><textarea id="mnote" className="pd-textarea" rows={2} value={v.note} onChange={(e) => set({ note: e.target.value })} placeholder="例：車主指定停靠位置、遙控器編號" /></div>
        </fieldset>

        {serverError && <p role="alert" style={{ margin: 0, color: "var(--pd-danger)" }}>{serverError}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Link href="/console/monthly" className="pd-btn">取消</Link>
          <button type="submit" className="pd-btn pd-btn--primary" disabled={busy}>{busy ? "建立中…" : "建立合約"}</button>
        </div>
      </form>

      <aside className="pd-card" style={{ flex: "1 1 280px", minWidth: 0, alignSelf: "flex-start", position: "sticky", top: 16, display: "grid", gap: 12 }} aria-live="polite">
        <h2 className="pd-serif" style={{ margin: 0, fontSize: 18 }}>合約摘要</h2>
        <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "8px 14px", margin: 0, fontSize: 14 }}>
          <dt className="pd-label">方案</dt><dd style={{ margin: 0 }}>{plan?.name ?? "—"}{plan?.type === "fixed" && v.space ? `・${v.space}` : ""}</dd>
          <dt className="pd-label">車牌</dt><dd style={{ margin: 0 }}>{v.vehicles.filter((x) => x.plate).map((x) => <span key={x.plate} className="pd-plate" style={{ marginRight: 6 }}>{x.plate}</span>)}{!v.vehicles.some((x) => x.plate) && "—"}</dd>
          <dt className="pd-label">生效</dt><dd className="pd-mono" style={{ margin: 0 }}>{zh(v.startsOn)} 起 {v.months} 個月</dd>
          <dt className="pd-label">到期</dt><dd className="pd-mono" style={{ margin: 0 }}>{zh(ends)}</dd>
          <dt className="pd-label">開通</dt><dd className="pd-mono" style={{ margin: 0 }}>{zh(v.activatesOn)}</dd>
        </dl>
        <div style={{ borderTop: "1px solid var(--pd-line-soft)", paddingTop: 12, display: "grid", gap: 6, fontSize: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>租金 {money(v.monthlyFee)} × {v.months}</span><span className="pd-mono">{money(a.rent)}</span></div>
          {v.discount > 0 && <div style={{ display: "flex", justifyContent: "space-between" }}><span>折扣</span><span className="pd-mono">−{money(v.discount)}</span></div>}
          {v.deposit > 0 && <div style={{ display: "flex", justifyContent: "space-between" }}><span>押金</span><span className="pd-mono">{money(v.deposit)}</span></div>}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 4 }}><strong style={{ fontWeight: 500 }}>應收</strong><span className="pd-mono" style={{ fontSize: 24, fontWeight: 600 }}>{money(a.due)}</span></div>
          <span className="pd-label">{v.paymentStatus === "paid" ? `已收款・${PAYMENT_METHOD_LABELS[v.paymentMethod]}` : "待付款"}</span>
        </div>
        <p className="pd-label" style={{ margin: 0, lineHeight: 1.7 }}>建立後狀態：<strong style={{ color: "var(--pd-ink)", fontWeight: 500 }}>{STATE_LABELS[state]}</strong>。車牌會自動同步到現場工控機。經辦：{operator}</p>
      </aside>
    </div>
  );
}
