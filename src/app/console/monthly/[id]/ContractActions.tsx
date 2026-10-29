"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { endsOn, addDays, formatPlate, MAX_PLATES, PAYMENT_METHOD_LABELS, TERM_OPTIONS, todayTaipei, type PaymentMethod, type PaymentStatus, type VehicleInput } from "@/lib/monthly";

type Kind = "pay" | "renew" | "suspend" | "vehicles";

export function ContractActions(props: {
  id: string; paymentStatus: PaymentStatus; suspended: boolean; cancelled: boolean; endsOn: string; monthlyFee: number;
  due: number; vehicles: VehicleInput[]; canManage: boolean;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<Kind>("pay");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [payRef, setPayRef] = useState("");
  const [months, setMonths] = useState(1);
  const [paid, setPaid] = useState<PaymentStatus>("paid");
  const [reason, setReason] = useState("");
  const [vehicles, setVehicles] = useState<VehicleInput[]>(props.vehicles);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!props.canManage || props.cancelled) return null;

  const open = (k: Kind) => { setKind(k); setError(""); setVehicles(props.vehicles); setPayRef(""); setReason(""); ref.current?.showModal(); };
  const send = async (body: object) => {
    setBusy(true); setError("");
    const res = await fetch(`/api/monthly/${props.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const b = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res?.ok) { setError(b?.message ?? "儲存失敗。"); return; }
    ref.current?.close();
    router.refresh();
  };
  const from = props.endsOn >= todayTaipei() ? addDays(props.endsOn, 1) : todayTaipei();
  const methods = (Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).filter((m) => m !== "online");
  const needRef = method === "transfer" || method === "card";

  const payFields = (
    <>
      <div className="pd-choice-grid" role="group" aria-label="付款方式">
        {methods.map((m) => <button key={m} type="button" className="pd-choice" aria-pressed={method === m} onClick={() => setMethod(m)}>{PAYMENT_METHOD_LABELS[m]}</button>)}
      </div>
      {needRef && <div className="pd-field"><label htmlFor="aref">{method === "transfer" ? "轉帳帳號末五碼" : "刷卡授權碼"}</label><input id="aref" className="pd-input pd-mono" value={payRef} onChange={(e) => setPayRef(e.target.value)} /></div>}
    </>
  );

  return (
    <>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {props.paymentStatus === "unpaid" && <button type="button" className="pd-btn pd-btn--primary" onClick={() => open("pay")}>確認收款</button>}
        <button type="button" className={props.paymentStatus === "unpaid" ? "pd-btn" : "pd-btn pd-btn--primary"} onClick={() => open("renew")}>續約</button>
        <button type="button" className="pd-btn" onClick={() => open("vehicles")}>變更車牌</button>
        {props.suspended
          ? <button type="button" className="pd-btn" onClick={() => send({ action: "resume" })} disabled={busy}>恢復合約</button>
          : <button type="button" className="pd-btn" onClick={() => open("suspend")}>停用</button>}
      </div>
      {error && !ref.current?.open && <p role="alert" style={{ margin: "8px 0 0", color: "var(--pd-danger)" }}>{error}</p>}

      <dialog ref={ref} className="pd-dialog" aria-labelledby="act-h">
        <form method="dialog" onSubmit={(e) => {
          e.preventDefault();
          if (kind === "pay") send({ action: "confirm_payment", method, ref: payRef });
          if (kind === "renew") send({ action: "renew", months, paymentStatus: paid, method, ref: payRef });
          if (kind === "suspend") send({ action: "suspend", reason });
          if (kind === "vehicles") send({ action: "update_vehicles", vehicles });
        }} style={{ display: "grid", gap: 16 }}>
          <h2 id="act-h" className="pd-serif" style={{ margin: 0, fontSize: 20 }}>{{ pay: "確認收款", renew: "續約", suspend: "停用合約", vehicles: "變更車牌" }[kind]}</h2>

          {kind === "pay" && <><p style={{ margin: 0 }}>應收 <strong className="pd-mono">NT${props.due.toLocaleString()}</strong>。確認後，啟用日一到車牌就會開通。</p>{payFields}</>}

          {kind === "renew" && (
            <>
              <div className="pd-choice-grid" role="group" aria-label="續約期數">
                {TERM_OPTIONS.map((m) => <button key={m} type="button" className="pd-choice" aria-pressed={months === m} onClick={() => setMonths(m)}>{m} 個月</button>)}
              </div>
              <p style={{ margin: 0, lineHeight: 1.8 }}>新期間 <span className="pd-mono">{from} 至 {endsOn(from, months)}</span>・應收 <strong className="pd-mono">NT${(props.monthlyFee * months).toLocaleString()}</strong></p>
              <div className="pd-segmented" role="group" aria-label="付款狀態" style={{ justifySelf: "start" }}>
                <button type="button" aria-pressed={paid === "paid"} onClick={() => setPaid("paid")}>已收款</button>
                <button type="button" aria-pressed={paid === "unpaid"} onClick={() => setPaid("unpaid")}>待付款</button>
              </div>
              {paid === "paid" && payFields}
            </>
          )}

          {kind === "suspend" && (
            <div className="pd-field"><label htmlFor="areason">停用原因</label>
              <input id="areason" className="pd-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例：車主暫停使用、欠費" />
              <span className="pd-label">停用後車牌立即不能以月租進出，可以隨時恢復。</span></div>
          )}

          {kind === "vehicles" && (
            <div style={{ display: "grid", gap: 10 }}>
              {vehicles.map((x, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "end" }}>
                  <div className="pd-field" style={{ flex: 1 }}><label htmlFor={`av${i}`}>車牌 {i + 1}</label>
                    <input id={`av${i}`} className="pd-input pd-input--plate" value={x.plate} onChange={(e) => setVehicles(vehicles.map((y, j) => j === i ? { ...y, plate: formatPlate(e.target.value) } : y))} /></div>
                  <button type="button" className="pd-btn" disabled={vehicles.length === 1} onClick={() => setVehicles(vehicles.filter((_, j) => j !== i))}>移除</button>
                </div>
              ))}
              {vehicles.length < MAX_PLATES && <button type="button" className="pd-btn" style={{ justifySelf: "start" }} onClick={() => setVehicles([...vehicles, { plate: "", kind: "car", brand: "", color: "" }])}>＋ 再加一台</button>}
              <span className="pd-label">儲存後立即同步到現場工控機。</span>
            </div>
          )}

          {error && <p role="alert" style={{ margin: 0, color: "var(--pd-danger)" }}>{error}</p>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button type="button" className="pd-btn" onClick={() => ref.current?.close()}>取消</button>
            <button type="submit" className={kind === "suspend" ? "pd-btn pd-btn--danger" : "pd-btn pd-btn--primary"} disabled={busy}>{busy ? "儲存中…" : "確定"}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
