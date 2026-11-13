"use client";

import { useEffect, useState } from "react";

interface Order {
  orderNo: string; status: string; amount: number; plate: string; siteCode: string; siteName: string; paidAt: string | null; exitUntil: string | null; method: string | null;
  failReason?: string | null; recentFailures?: number; plateNo?: string;
}
const fmtTime = (iso: string) => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

export function PayResult({ orderNo }: { orderNo: string }) {
  const [o, setO] = useState<Order | null>(null);
  const [missing, setMissing] = useState(false);
  const [waited, setWaited] = useState(0);

  useEffect(() => {
    if (!orderNo) { setMissing(true); return; }
    let stop = false;
    let n = 0;
    const tick = async () => {
      n++;
      // 前 10 秒只讀資料庫（等 NotifyURL）；之後每 5 秒順便向統一金流查一次
      const refresh = n > 5 && n % 3 === 0;
      const r = await fetch(`/api/pay/orders/${encodeURIComponent(orderNo)}${refresh ? "?refresh=1" : ""}`, { cache: "no-store" }).catch(() => null);
      if (stop) return;
      if (r?.status === 404) { setMissing(true); return; }
      const b = r?.ok ? ((await r.json()) as Order) : null;
      if (b) setO(b);
      setWaited(n * 2);
      if (b && ["paid", "failed", "expired", "refunded"].includes(b.status)) return;
      if (n < 60) setTimeout(tick, 2000);
    };
    tick();
    return () => { stop = true; };
  }, [orderNo]);

  const card = (children: React.ReactNode) => (
    <div style={{ minHeight: "100vh", maxWidth: 480, margin: "0 auto", padding: "32px 20px", background: "var(--pd-ground)" }}>
      <section className="pd-card" style={{ padding: "28px 22px", display: "grid", gap: 12 }} aria-live="polite">{children}</section>
    </div>
  );

  if (missing) return card(<>
    <h1 className="pd-serif" style={{ margin: 0, fontSize: 22 }}>找不到這筆付款</h1>
    <p style={{ margin: 0, color: "var(--pd-muted)" }}>請回到繳費頁重新查詢車牌；如果已經扣款，請按出口對講機，我們會協助處理。</p>
  </>);
  if (!o || ["pending", "unknown", "created"].includes(o.status)) return card(<>
    <div className="pd-chip pd-chip--info">確認中</div>
    <h1 className="pd-serif" style={{ margin: 0, fontSize: 22 }}>正在確認付款結果…</h1>
    <p style={{ margin: 0, color: "var(--pd-muted)", lineHeight: 1.8 }}>
      通常幾秒內完成，請不要重複付款。{waited >= 60 && "確認時間比較久，若已扣款請按出口對講機，我們會協助開閘。"}
    </p>
    {o && <p className="pd-label pd-mono" style={{ margin: 0 }}>{o.plate}・NT${o.amount}・訂單 {o.orderNo}</p>}
  </>);
  if (o.status === "paid") return card(<>
    <div className="pd-chip pd-chip--ok">付款完成</div>
    <h1 className="pd-serif" style={{ margin: 0, fontSize: 24 }}>{o.exitUntil ? `請在 ${fmtTime(o.exitUntil)} 前出場` : "付款完成"}</h1>
    <p style={{ margin: 0, color: "var(--pd-muted)", lineHeight: 1.8 }}>開到出口時，柵欄會自動辨識車牌並開啟。</p>
    <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "8px 16px", margin: "6px 0 0" }}>
      <dt className="pd-label">停車場</dt><dd style={{ margin: 0 }}>{o.siteName}</dd>
      <dt className="pd-label">車牌</dt><dd style={{ margin: 0 }} className="pd-plate">{o.plate}</dd>
      <dt className="pd-label">金額</dt><dd style={{ margin: 0 }} className="pd-mono">NT${o.amount}</dd>
      {o.method && <><dt className="pd-label">付款方式</dt><dd style={{ margin: 0 }}>{o.method}</dd></>}
    </dl>
    <p className="pd-label" style={{ margin: 0 }}>電子發票會在付款後開立；如有問題請按出口對講機。</p>
  </>);
  // 付款失敗：說明原因、可以換卡或改用 Apple Pay／Google Pay；連續失敗就請車主按對講機
  const retry = `/pay?site=${encodeURIComponent(o.siteCode)}${o.plateNo ? `&plate=${encodeURIComponent(o.plateNo)}` : ""}`;
  const many = (o.recentFailures ?? 0) >= 3;
  return card(<>
    <div className="pd-chip pd-chip--warn">付款未完成</div>
    <h1 className="pd-serif" style={{ margin: 0, fontSize: 22 }}>這筆付款沒有成功</h1>
    <p style={{ margin: 0, color: "var(--pd-muted)", lineHeight: 1.8 }}>
      沒有扣款。{o.status === "expired" ? "付款頁停留太久，訂單已逾時。" : o.failReason ? `原因：${o.failReason}。` : ""}
    </p>
    <div className="pd-card" style={{ padding: "12px 16px", display: "grid", gap: 6 }}>
      <strong>可以這樣重新付款</strong>
      <span>・換一張信用卡</span>
      <span>・改用其他付款方式（行動支付、電子錢包）</span>
      <span className="pd-label">付款頁會列出這個停車場可以用的所有方式，再選一次就好。</span>
    </div>
    <a className="pd-btn pd-btn--primary pd-btn--block pd-btn--lg" href={retry}>換卡或改用其他方式付款</a>
    <p style={{ margin: 0, color: many ? "var(--pd-danger)" : "var(--pd-muted)", lineHeight: 1.8 }}>
      {many ? "已經失敗好幾次了，請直接按出口的對講機，我們會協助你出場。" : "一直付不成功，請按出口的對講機，我們會協助你出場。"}
    </p>
    <p className="pd-label pd-mono" style={{ margin: 0 }}>{o.plate}・NT${o.amount}・訂單 {o.orderNo}</p>
  </>);
}
