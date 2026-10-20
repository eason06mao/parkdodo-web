"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ORG_TYPE_LABELS, type OrgType } from "@/lib/permissions";
import {
  allowedCollection, CITIES, COLLECTION_LABELS, needsLicense, OPERATION_BY_ORG, OPERATION_LABELS, PLAN_LABELS,
  validateNewSite, type FieldErrors, type NewSiteInput,
} from "@/lib/siteForm";
import type { CollectionMode, LicensePlan } from "@/lib/types";

type Org = { id: string; name: string; type: OrgType };

const STEP_FIELDS: (keyof NewSiteInput)[][] = [
  ["name", "city", "district", "address", "totalSpaces", "entryLanes", "exitLanes"],
  ["orgId", "collectionMode", "agreementNo"],
  ["plan", "maxLanes", "startsOn", "endsOn"],
  [],
];
const STEP_NAMES = ["基本資料", "經營與收款", "軟體授權", "確認"];

function oneYearLater(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y + 1, m - 1, day - 1));
  return t.toISOString().slice(0, 10);
}

export function SiteWizard({ orgs, today }: { orgs: Org[]; today: string }) {
  const [step, setStep] = useState(0);
  const [v, setV] = useState<NewSiteInput>({
    name: "", city: "台中市", district: "", address: "", totalSpaces: 30, entryLanes: 1, exitLanes: 1,
    orgId: orgs[0]?.id ?? "", collectionMode: allowedCollection(orgs[0]?.type ?? "hq")[0], agreementNo: "",
    plan: "standard", maxLanes: 2, startsOn: today, endsOn: oneYearLater(today),
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: string; code: string } | null>(null);

  const org = orgs.find((o) => o.id === v.orgId);
  const licensed = org ? needsLicense(org.type) : true;
  const steps = useMemo(() => (licensed ? [0, 1, 2, 3] : [0, 1, 3]), [licensed]);
  const pos = steps.indexOf(step);

  const set = <K extends keyof NewSiteInput>(k: K, val: NewSiteInput[K]) => setV((p) => ({ ...p, [k]: val }));
  const setOrg = (id: string) => {
    const o = orgs.find((x) => x.id === id);
    setV((p) => ({ ...p, orgId: id, collectionMode: allowedCollection(o?.type ?? "hq")[0] }));
  };
  const num = (k: "totalSpaces" | "entryLanes" | "exitLanes" | "maxLanes") => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(k, e.target.value === "" ? Number.NaN : Number(e.target.value));

  const stepErrors = (s: number) => {
    const all = validateNewSite(v, org?.type);
    return Object.fromEntries(Object.entries(all).filter(([k]) => STEP_FIELDS[s].includes(k as keyof NewSiteInput))) as FieldErrors;
  };

  const next = () => {
    const e = stepErrors(step);
    setErrors(e);
    if (Object.keys(e).length === 0) setStep(steps[pos + 1]);
  };
  const back = () => { setErrors({}); setStep(steps[pos - 1]); };

  const submit = async () => {
    const all = validateNewSite(v, org?.type);
    if (Object.keys(all).length) { setErrors(all); return; }
    setBusy(true); setServerError("");
    const res = await fetch("/api/sites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(v) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) setCreated(body);
    else { setServerError(body.message ?? "建立失敗，請檢查欄位後再試一次。"); if (body.errors) setErrors(body.errors); }
  };

  const err = (k: keyof NewSiteInput) => errors[k] && <span id={`${k}-err`} role="alert" style={{ color: "var(--pd-danger)", fontSize: 13 }}>{errors[k]}</span>;
  const aria = (k: keyof NewSiteInput) => ({ "aria-invalid": !!errors[k] || undefined, "aria-describedby": errors[k] ? `${k}-err` : undefined });

  if (created) {
    return (
      <section className="pd-card" style={{ maxWidth: 720 }} aria-live="polite">
        <h2 className="pd-serif" style={{ margin: 0, fontSize: 22 }}>站點已建立：{v.name}</h2>
        <p style={{ margin: "8px 0 0", color: "var(--pd-muted)" }}>場站代碼 <span className="pd-mono">{created.code}</span>・狀態「籌備中」。</p>
        <ol style={{ margin: "20px 0 0", paddingLeft: 20, lineHeight: 2 }}>
          <li>到站點頁面配對工控機，產生一次性配對碼。</li>
          <li>工控機上線後，登錄每條車道的攝影機、柵欄機與顯示語音卡。</li>
          <li>{org?.type === "hq" ? "設定費率與付款方式。" : `在「帳號權限」指派 ${org?.name} 的第一位管理員。`}</li>
          <li>現場測試通過後，將狀態改為「試營運」。</li>
        </ol>
        <div style={{ display: "flex", gap: 10, marginTop: 24, flexWrap: "wrap" }}>
          <Link href={`/console/sites/${created.id}`} className="pd-btn pd-btn--primary">前往站點頁</Link>
          <Link href="/console/sites" className="pd-btn">回站點清單</Link>
        </div>
      </section>
    );
  }

  return (
    <div className="pd-split">
      <section aria-label={`第 ${pos + 1} 步：${STEP_NAMES[step]}`} className="pd-card" style={{ flex: "999 1 560px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
        <ol aria-label="步驟" style={{ display: "flex", flexWrap: "wrap", gap: 8, listStyle: "none", margin: 0, padding: 0 }}>
          {steps.map((s, i) => (
            <li key={s} aria-current={s === step ? "step" : undefined} className={s === step ? "pd-chip pd-chip--ok" : "pd-chip"}>
              <span className="pd-mono">{i + 1}</span> {STEP_NAMES[s]}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
            <div className="pd-field" style={{ gridColumn: "1 / -1" }}><label htmlFor="name">站點名稱</label>
              <input id="name" className="pd-input" value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="例：沙鹿二站" maxLength={40} {...aria("name")} />{err("name")}
              <span className="pd-label">顯示在後台、繳費頁與發票上。之後客戶可以自己改名。</span></div>
            <div className="pd-field"><label htmlFor="city">縣市</label>
              <select id="city" className="pd-select" value={v.city} onChange={(e) => set("city", e.target.value)} {...aria("city")}>{CITIES.map((c) => <option key={c}>{c}</option>)}</select>{err("city")}</div>
            <div className="pd-field"><label htmlFor="district">區</label>
              <input id="district" className="pd-input" value={v.district} onChange={(e) => set("district", e.target.value)} placeholder="例：沙鹿區" /></div>
            <div className="pd-field" style={{ gridColumn: "1 / -1" }}><label htmlFor="address">地址</label>
              <input id="address" className="pd-input" value={v.address} onChange={(e) => set("address", e.target.value)} {...aria("address")} />{err("address")}</div>
            <div className="pd-field"><label htmlFor="spaces">車位數</label>
              <input id="spaces" type="number" inputMode="numeric" min={1} className="pd-input" value={Number.isNaN(v.totalSpaces) ? "" : v.totalSpaces} onChange={num("totalSpaces")} {...aria("totalSpaces")} />{err("totalSpaces")}</div>
            <div className="pd-field"><label htmlFor="entry">入口車道</label>
              <input id="entry" type="number" inputMode="numeric" min={1} max={8} className="pd-input" value={Number.isNaN(v.entryLanes) ? "" : v.entryLanes} onChange={num("entryLanes")} {...aria("entryLanes")} />{err("entryLanes")}</div>
            <div className="pd-field"><label htmlFor="exit">出口車道</label>
              <input id="exit" type="number" inputMode="numeric" min={1} max={8} className="pd-input" value={Number.isNaN(v.exitLanes) ? "" : v.exitLanes} onChange={num("exitLanes")} {...aria("exitLanes")} />{err("exitLanes")}</div>
          </div>
        )}

        {step === 1 && (
          <div style={{ display: "grid", gap: 16 }}>
            <div className="pd-field"><label htmlFor="org">經營組織</label>
              <select id="org" className="pd-select" value={v.orgId} onChange={(e) => setOrg(e.target.value)} {...aria("orgId")}>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}（{ORG_TYPE_LABELS[o.type]}）</option>)}
              </select>{err("orgId")}
              <span className="pd-label">站點建立後由這個組織經營。之後要移轉給其他組織，也只能由總部操作。</span></div>
            {org && <p style={{ margin: 0 }}>經營方式：<strong>{OPERATION_LABELS[OPERATION_BY_ORG[org.type]]}</strong></p>}
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="pd-label" style={{ marginBottom: 8 }}>收款方式</legend>
              <div style={{ display: "grid", gap: 8 }}>
                {(["hq_collect", "own_merchant"] as CollectionMode[]).map((m) => {
                  const ok = org ? allowedCollection(org.type).includes(m) : false;
                  return (
                    <label key={m} style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44, color: ok ? undefined : "var(--pd-muted)" }}>
                      <input type="radio" name="collection" checked={v.collectionMode === m} disabled={!ok} onChange={() => set("collectionMode", m)} />
                      {COLLECTION_LABELS[m]}{!ok && <span className="pd-label">（此組織類型不適用）</span>}
                    </label>
                  );
                })}
              </div>{err("collectionMode")}
              {org?.type === "licensee" && <p className="pd-label" style={{ margin: "6px 0 0" }}>系統客戶的停車費一律進他們自己的金流商店，總部不代收。</p>}
            </fieldset>
            {org?.type === "franchisee" && (
              <div className="pd-field"><label htmlFor="agreement">加盟合約編號</label>
                <input id="agreement" className="pd-input" value={v.agreementNo} onChange={(e) => set("agreementNo", e.target.value)} placeholder="例：FA-2026-001" {...aria("agreementNo")} />{err("agreementNo")}</div>
            )}
          </div>
        )}

        {step === 2 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
            <fieldset style={{ border: 0, padding: 0, margin: 0, gridColumn: "1 / -1" }}>
              <legend className="pd-label" style={{ marginBottom: 8 }}>方案</legend>
              <div className="pd-choice-grid">
                {(Object.keys(PLAN_LABELS) as LicensePlan[]).map((p) => (
                  <button key={p} type="button" className="pd-choice" aria-pressed={v.plan === p} onClick={() => set("plan", p)}>{PLAN_LABELS[p]}</button>
                ))}
              </div>{err("plan")}
            </fieldset>
            <div className="pd-field"><label htmlFor="maxLanes">授權車道數</label>
              <input id="maxLanes" type="number" inputMode="numeric" min={1} className="pd-input" value={Number.isNaN(v.maxLanes) ? "" : v.maxLanes} onChange={num("maxLanes")} {...aria("maxLanes")} />{err("maxLanes")}
              <span className="pd-label">目前規劃 {v.entryLanes + v.exitLanes} 條車道</span></div>
            <div className="pd-field"><label htmlFor="starts">開始日</label>
              <input id="starts" type="date" className="pd-input" value={v.startsOn} onChange={(e) => set("startsOn", e.target.value)} {...aria("startsOn")} />{err("startsOn")}</div>
            <div className="pd-field"><label htmlFor="ends">到期日</label>
              <input id="ends" type="date" className="pd-input" value={v.endsOn} onChange={(e) => set("endsOn", e.target.value)} {...aria("endsOn")} />{err("endsOn")}</div>
            <p className="pd-label" style={{ margin: 0, gridColumn: "1 / -1", lineHeight: 1.8 }}>
              建立後先標示為「試用」。到期後有 14 天寬限期；超過寬限期只鎖定報表匯出、新增月租、發布費率等進階功能，
              車牌辨識、付款與開閘照常運作，不會讓車子出不去。
            </p>
          </div>
        )}

        {step === 3 && (
          <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "10px 20px", margin: 0 }}>
            <dt className="pd-label">站點名稱</dt><dd style={{ margin: 0 }}>{v.name}</dd>
            <dt className="pd-label">地址</dt><dd style={{ margin: 0 }}>{v.city}{v.district} {v.address}</dd>
            <dt className="pd-label">車位／車道</dt><dd style={{ margin: 0 }} className="pd-mono">{v.totalSpaces} 格・入口 {v.entryLanes}・出口 {v.exitLanes}</dd>
            <dt className="pd-label">經營組織</dt><dd style={{ margin: 0 }}>{org?.name}（{org && OPERATION_LABELS[OPERATION_BY_ORG[org.type]]}）</dd>
            <dt className="pd-label">收款方式</dt><dd style={{ margin: 0 }}>{COLLECTION_LABELS[v.collectionMode]}</dd>
            {org?.type === "franchisee" && <><dt className="pd-label">加盟合約</dt><dd style={{ margin: 0 }} className="pd-mono">{v.agreementNo}</dd></>}
            {licensed
              ? <><dt className="pd-label">軟體授權</dt><dd style={{ margin: 0 }}>{PLAN_LABELS[v.plan]}・{v.maxLanes} 條車道・<span className="pd-mono">{v.startsOn} 至 {v.endsOn}</span></dd></>
              : <><dt className="pd-label">軟體授權</dt><dd style={{ margin: 0 }}>總部自營，不需授權</dd></>}
          </dl>
        )}

        {serverError && <p role="alert" style={{ margin: 0, color: "var(--pd-danger)" }}>{serverError}</p>}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "space-between" }}>
          {pos > 0 ? <button type="button" className="pd-btn" onClick={back}>上一步</button> : <Link href="/console/sites" className="pd-btn">取消</Link>}
          {step === 3
            ? <button type="button" className="pd-btn pd-btn--primary" onClick={submit} disabled={busy}>{busy ? "建立中…" : "建立站點"}</button>
            : <button type="button" className="pd-btn pd-btn--primary" onClick={next}>下一步</button>}
        </div>
      </section>

      <aside className="pd-card" style={{ flex: "1 1 280px", display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 className="pd-serif" style={{ margin: 0, fontSize: 18 }}>建站之後</h2>
        <p style={{ margin: 0, lineHeight: 1.8, color: "var(--pd-muted)", fontSize: 14 }}>
          站點建立後是「籌備中」，不會對外收費。接著配對工控機、登錄設備、設定費率，現場測試通過再改為試營運。
        </p>
        <p style={{ margin: 0, lineHeight: 1.8, color: "var(--pd-muted)", fontSize: 14 }}>
          客戶可以自己修改站名、費率與帳號；經營組織、收款方式、場站代碼與營運狀態只有總部能改。
        </p>
      </aside>
    </div>
  );
}
