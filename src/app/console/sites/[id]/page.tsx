import type { Metadata } from "next";
import Link from "next/link";
import { Chip } from "@/components/Chip";
import { Forbidden } from "@/components/Forbidden";
import { getCurrentUser } from "@/lib/auth";
import { getOrganizations, getSiteRecord } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { can, ORG_TYPE_LABELS } from "@/lib/permissions";
import { COLLECTION_LABELS, OPERATION_LABELS, PLAN_LABELS } from "@/lib/siteForm";
import { daysUntil, DEVICE_LABELS, EDGE_STATUS, LICENSE_STATUS, SITE_STATUS } from "@/lib/siteLabels";
import { PairEdgeButton } from "./PairEdgeButton";

export const metadata: Metadata = { title: "站點設定" };
export const dynamic = "force-dynamic";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (<><dt className="pd-label">{label}</dt><dd style={{ margin: 0 }}>{children}</dd></>);
}

const HqOnly = () => <span className="pd-label" style={{ marginLeft: 6 }}>・僅總部可變更</span>;

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const site = await getSiteRecord(user, id);
  if (!site) return <Forbidden title="找不到這個站點" message="站點不存在，或你的帳號沒有這個站點的檢視權限。" />;

  const org = (await getOrganizations(user)).find((o) => o.id === site.orgId);
  const scope = { orgId: site.orgId, siteId: site.id };
  const canEdit = can(user, "site.edit", scope);
  const isHqAdmin = can(user, "site.create");
  const st = SITE_STATUS[site.status];
  const edge = EDGE_STATUS[site.edge?.status ?? "provisioning"];
  const lic = site.license;
  const days = lic ? daysUntil(lic.endsOn) : null;

  return (
    <main className="pd-main">
      <header className="pd-page-head">
        <div>
          <nav aria-label="路徑" className="pd-label"><Link href="/console">營運總覽</Link> ／ <Link href="/console/sites">場站與設備</Link> ／ {site.name}</nav>
          <h1 className="pd-page-title" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {site.name}<Chip tone={st.tone}>{st.label}</Chip>
          </h1>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href={`/console/sites/${site.id}/rates`} className="pd-btn">費率設定</Link>
          {canEdit && <button type="button" className="pd-btn">編輯基本資料</button>}
          {isHqAdmin && <button type="button" className="pd-btn">變更營運狀態</button>}
        </div>
      </header>

      <div className="pd-grid pd-grid-2">
        <section aria-labelledby="basic-h" className="pd-card">
          <h2 id="basic-h" className="pd-serif" style={{ margin: "0 0 14px", fontSize: 18 }}>基本資料</h2>
          <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "10px 20px", margin: 0 }}>
            <Row label="站點名稱">{site.name}</Row>
            <Row label="場站代碼"><span className="pd-mono">{site.code}</span><HqOnly /></Row>
            <Row label="地址">{site.address}</Row>
            <Row label="車位數"><span className="pd-mono">{site.totalSpaces}</span> 格</Row>
            <Row label="車道">{site.lanes.map((l) => l.name).join("、")}</Row>
          </dl>
        </section>

        <section aria-labelledby="org-h" className="pd-card">
          <h2 id="org-h" className="pd-serif" style={{ margin: "0 0 14px", fontSize: 18 }}>經營與收款</h2>
          <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "10px 20px", margin: 0 }}>
            <Row label="經營組織">{org ? `${org.name}（${ORG_TYPE_LABELS[org.type]}）` : "—"}<HqOnly /></Row>
            <Row label="經營方式">{OPERATION_LABELS[site.operationType]}<HqOnly /></Row>
            <Row label="收款方式">{COLLECTION_LABELS[site.collectionMode]}<HqOnly /></Row>
          </dl>
        </section>

        <section aria-labelledby="lic-h" className={`pd-card${days !== null && days <= 30 ? " pd-card--warn" : ""}`}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 14 }}>
            <h2 id="lic-h" className="pd-serif" style={{ margin: 0, fontSize: 18 }}>軟體授權</h2>
            {lic && can(user, "license.manage") && <button type="button" className="pd-btn">續約／變更方案</button>}
          </div>
          {lic ? (
            <>
              <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "10px 20px", margin: 0 }}>
                <Row label="授權編號"><span className="pd-mono">{lic.licenseNo}</span></Row>
                <Row label="方案">{PLAN_LABELS[lic.plan]} <Chip tone={LICENSE_STATUS[lic.status].tone}>{LICENSE_STATUS[lic.status].label}</Chip></Row>
                <Row label="期間"><span className="pd-mono">{lic.startsOn} 至 {lic.endsOn}</span>{days !== null && <span className="pd-label">（{days >= 0 ? `剩 ${days} 天` : `已過 ${-days} 天`}）</span>}</Row>
                <Row label="車道">
                  <span className="pd-mono">{site.lanes.length} / {lic.maxLanes}</span> 條
                  <div className="pd-meter" style={{ marginTop: 6, maxWidth: 220 }} aria-hidden="true"><span style={{ width: `${Math.min(100, (site.lanes.length / lic.maxLanes) * 100)}%` }} /></div>
                </Row>
              </dl>
              <p className="pd-label" style={{ margin: "14px 0 0", lineHeight: 1.8 }}>到期後寬限 {lic.graceDays} 天。逾期只鎖定進階功能，辨識、付款與開閘不受影響。</p>
            </>
          ) : <p style={{ margin: 0, color: "var(--pd-muted)" }}>總部自營站，不需要軟體授權。</p>}
        </section>

        <section aria-labelledby="edge-h" className="pd-card">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 14 }}>
            <h2 id="edge-h" className="pd-serif" style={{ margin: 0, fontSize: 18 }}>工控機（Edge）</h2>
            {can(user, "edge.pair") && <PairEdgeButton siteName={site.name} paired={site.edge?.status !== "provisioning"} />}
          </div>
          <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "10px 20px", margin: 0 }}>
            <Row label="狀態"><Chip tone={edge.tone} dot={site.edge?.status === "online"}>{edge.label}</Chip></Row>
            <Row label="名稱">{site.edge?.name ?? "—"}</Row>
            <Row label="機型">{site.edge?.model ?? "—"}</Row>
            <Row label="程式版本"><span className="pd-mono">{site.edge?.agentVersion ?? "—"}</span></Row>
            <Row label="最後回報">{site.edge?.lastSeenAt ? formatDateTime(site.edge.lastSeenAt) : "—"}</Row>
          </dl>
          {!can(user, "edge.pair") && <p className="pd-label" style={{ margin: "14px 0 0" }}>工控機配對與更換由總部處理。</p>}
        </section>
      </div>

      <section aria-labelledby="dev-h" className="pd-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "18px 22px", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <h2 id="dev-h" className="pd-serif" style={{ margin: 0, fontSize: 18 }}>車道與設備</h2>
            <p className="pd-label" style={{ margin: "4px 0 0" }}>顯示語音卡的參數類指令（改地址、改密碼、恢復出廠等）不提供線上操作，需由技術人員在現場處理。</p>
          </div>
          {can(user, "device.manage", scope) && <button type="button" className="pd-btn">登錄設備</button>}
        </div>
        <div className="pd-table-wrap">
          <table className="pd-table">
            <thead><tr><th>車道</th><th>設備</th><th>廠牌／型號</th><th>連線</th><th>狀態</th></tr></thead>
            <tbody>
              {site.devices.map((d) => (
                <tr key={d.id}>
                  <td className="pd-mono">{d.laneCode ?? "—"}</td>
                  <td>{DEVICE_LABELS[d.type]}</td>
                  <td>{d.vendor ?? "—"}{d.model ? `・${d.model}` : ""}</td>
                  <td className="pd-mono">{d.ip ?? (d.rs485Address !== undefined ? `RS-485 位址 ${d.rs485Address}` : "—")}</td>
                  <td><Chip tone={d.status === "online" ? "ok" : d.status === "offline" ? "danger" : "neutral"}>{{ online: "正常", offline: "離線", unknown: "未確認" }[d.status]}</Chip></td>
                </tr>
              ))}
              {site.devices.length === 0 && (
                <tr><td colSpan={5} className="pd-label" style={{ textAlign: "center", padding: 32 }}>尚未登錄設備。工控機配對上線後，可自動帶入同網段的攝影機。</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
