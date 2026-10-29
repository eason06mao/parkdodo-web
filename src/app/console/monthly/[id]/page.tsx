import type { Metadata } from "next";
import Link from "next/link";
import { Chip } from "@/components/Chip";
import { Forbidden } from "@/components/Forbidden";
import { getCurrentUser } from "@/lib/auth";
import { getMonthlyPlans, getMonthlyRecord, getSiteRecords } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { amounts, contractState, daysBetween, PAYMENT_METHOD_LABELS, PLAN_TYPE_LABELS, STATE_LABELS, todayTaipei, type ContractState } from "@/lib/monthly";
import { can } from "@/lib/permissions";
import type { ChipTone } from "@/lib/types";
import { ContractActions } from "./ContractActions";

export const metadata: Metadata = { title: "月租合約" };
export const dynamic = "force-dynamic";

const TONE: Record<ContractState, ChipTone> = { pending: "info", active: "ok", expiring: "warn", expired: "neutral", suspended: "danger", cancelled: "neutral" };
const INVOICE: Record<string, string> = { paper: "列印紙本", mobile: "手機條碼", company: "公司統編", donate: "捐贈", member: "會員載具" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <><dt className="pd-label">{label}</dt><dd style={{ margin: 0 }}>{children}</dd></>;
}

export default async function ContractPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const user = await getCurrentUser();
  const r = await getMonthlyRecord(user, id);
  if (!r) return <Forbidden title="找不到這份合約" message="合約不存在，或你沒有這個站點的檢視權限。" />;
  const [plans, sites] = await Promise.all([getMonthlyPlans(user), getSiteRecords(user)]);
  const plan = plans.find((p) => p.id === r.planId);
  const site = sites.find((s) => s.id === r.siteId);
  const state = contractState(r);
  const a = amounts(r);
  const today = todayTaipei();
  const canManage = !!site && can(user, "monthly.manage", { orgId: site.orgId, siteId: site.id });
  const c = r.customer;
  const dl: React.CSSProperties = { display: "grid", gridTemplateColumns: "max-content 1fr", gap: "10px 20px", margin: 0 };

  return (
    <main className="pd-main">
      <header className="pd-page-head">
        <div>
          <nav aria-label="路徑" className="pd-label"><Link href="/console">營運總覽</Link> ／ <Link href="/console/monthly">月租管理</Link> ／ {r.contractNo}</nav>
          <h1 className="pd-page-title" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            {c.type === "company" ? c.companyName : c.name}<Chip tone={TONE[state]}>{STATE_LABELS[state]}</Chip>
          </h1>
        </div>
        <ContractActions id={r.id} paymentStatus={r.paymentStatus} suspended={!!r.suspended} cancelled={!!r.cancelled} endsOn={r.endsOn}
          monthlyFee={r.monthlyFee} due={a.due} vehicles={r.vehicles} canManage={canManage}
          pendingRenewal={r.renewals.find((x) => !x.paidAt)} />
      </header>

      {sp.created && <p role="status" className="pd-card" style={{ margin: 0, borderColor: "var(--pd-accent)", background: "var(--pd-accent-tint)" }}>
        已建立合約 <strong className="pd-mono">{r.contractNo}</strong>。{state === "pending" ? (r.paymentStatus === "unpaid" ? "付款確認後車牌才會開通。" : `${r.activatesOn} 起車牌開通。`) : "車牌已開通，現場工控機會自動更新名單。"}
      </p>}

      <div className="pd-split">
        <section aria-labelledby="c-h" className="pd-card" style={{ flex: "1 1 360px", minWidth: 0 }}>
          <h2 id="c-h" className="pd-serif" style={{ margin: "0 0 14px", fontSize: 18 }}>合約</h2>
          <dl style={dl}>
            <Row label="合約編號"><span className="pd-mono">{r.contractNo}</span></Row>
            <Row label="站點">{site?.name ?? "—"}</Row>
            <Row label="方案">{plan?.name ?? "—"}<span className="pd-label">　{plan ? PLAN_TYPE_LABELS[plan.type] : ""}</span>{r.space && <span className="pd-mono">・車位 {r.space}</span>}</Row>
            <Row label="生效日"><span className="pd-mono">{r.startsOn}</span></Row>
            <Row label="啟用日"><span className="pd-mono">{r.activatesOn}</span>{r.activatesOn < r.startsOn && <span className="pd-label">（提早開通）</span>}</Row>
            <Row label="到期日"><span className="pd-mono">{r.endsOn}</span>{state !== "expired" && <span className="pd-label">（剩 {daysBetween(today, r.endsOn)} 天）</span>}</Row>
            <Row label="到期提醒">到期前 {r.remindDays} 天</Row>
            {r.note && <Row label="備註">{r.note}</Row>}
          </dl>
        </section>

        <section aria-labelledby="p-h" className="pd-card" style={{ flex: "1 1 320px", minWidth: 0 }}>
          <h2 id="p-h" className="pd-serif" style={{ margin: "0 0 14px", fontSize: 18 }}>費用與付款</h2>
          <dl style={dl}>
            <Row label="月費"><span className="pd-mono">NT${r.monthlyFee.toLocaleString()}</span>{plan && r.monthlyFee !== plan.monthlyPrice && <span className="pd-label">（方案價 NT${plan.monthlyPrice.toLocaleString()}）</span>}</Row>
            <Row label="首期">{r.months} 個月</Row>
            {r.discount > 0 && <Row label="折扣"><span className="pd-mono">−NT${r.discount.toLocaleString()}</span><span className="pd-label">　{r.discountReason}</span></Row>}
            {r.deposit > 0 && <Row label="押金"><span className="pd-mono">NT${r.deposit.toLocaleString()}</span></Row>}
            <Row label="首期應收"><strong className="pd-mono">NT${a.due.toLocaleString()}</strong></Row>
            <Row label="付款">{r.paymentStatus === "paid" ? <>已付款・{PAYMENT_METHOD_LABELS[r.paymentMethod]}{r.paymentRef && <span className="pd-mono pd-label">　{r.paymentRef}</span>}</> : <Chip tone="warn">待付款</Chip>}</Row>
            {r.paidAt && <Row label="收款時間"><span className="pd-mono">{formatDateTime(r.paidAt)}</span></Row>}
            {r.renewals.map((x, i) => (
              <Row key={i} label={`續約 ${i + 1}`}>
                <span className="pd-mono">{x.from} 至 {x.endsOn}</span>・{x.months} 個月・<span className="pd-mono">NT${x.amount.toLocaleString()}</span>
                {x.paidAt ? <span className="pd-label">　已付款</span> : <>　<Chip tone="warn">待付款</Chip></>}
              </Row>
            ))}
            <Row label="發票">{INVOICE[r.invoiceKind]}{r.invoiceValue && <span className="pd-mono">　{r.invoiceValue}</span>}{r.invoiceKind === "company" && <span className="pd-mono">　{c.taxId}</span>}</Row>
          </dl>
        </section>
      </div>

      <div className="pd-split">
        <section aria-labelledby="cu-h" className="pd-card" style={{ flex: "1 1 360px", minWidth: 0 }}>
          <h2 id="cu-h" className="pd-serif" style={{ margin: "0 0 14px", fontSize: 18 }}>客戶與車輛</h2>
          <dl style={dl}>
            {c.type === "company" && <Row label="公司">{c.companyName}<span className="pd-mono pd-label">　統編 {c.taxId}</span></Row>}
            <Row label={c.type === "company" ? "聯絡人" : "姓名"}>{c.name}</Row>
            <Row label="電話"><a href={`tel:${c.phone.replace(/[^\d]/g, "")}`} className="pd-mono">{c.phone}</a></Row>
            {c.email && <Row label="Email">{c.email}</Row>}
            {c.address && <Row label="地址">{c.address}</Row>}
            <Row label="車牌">
              {r.vehicles.map((x) => (
                <div key={x.plate} style={{ marginBottom: 4 }}><span className="pd-plate">{x.plate}</span>
                  <span className="pd-label">　{x.kind === "motorcycle" ? "機車" : "汽車"}{x.brand && `・${x.brand}`}{x.color && `・${x.color}`}</span></div>
              ))}
              {r.vehicles.length > 1 && <span className="pd-label">同時只能一台以月租進場</span>}
            </Row>
            <Row label="目前">{r.inside ? "在場" : "未進場"}</Row>
          </dl>
        </section>

        <section aria-labelledby="h-h" className="pd-card" style={{ flex: "1 1 320px", minWidth: 0 }}>
          <h2 id="h-h" className="pd-serif" style={{ margin: "0 0 12px", fontSize: 18 }}>紀錄</h2>
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {[...r.history].reverse().map((h, i) => (
              <li key={i} style={{ borderTop: i ? "1px solid var(--pd-line-soft)" : 0, padding: "10px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><strong style={{ fontWeight: 500 }}>{h.action}</strong><span className="pd-mono pd-label">{formatDateTime(h.at)}</span></div>
                {h.note && <div style={{ fontSize: 14, marginTop: 2 }}>{h.note}</div>}
                <div className="pd-label">{h.actor}</div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
