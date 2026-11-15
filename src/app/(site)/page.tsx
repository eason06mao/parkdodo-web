import Link from "next/link";
import { Icon } from "@/components/Icon";
import { METHOD_LABELS, parkingMethods } from "@/lib/payments/payuni/client";
import { COMPANY, MONTHLY, RATE, REFUND, SITES } from "@/lib/siteContent";
import { LaneArt } from "./LaneArt";
import { orTodo, Todo } from "./Todo";

// 付款方式依正式站設定（PAYUNI_METHODS）即時顯示
export const dynamic = "force-dynamic";

export default function HomePage() {
  const methods = parkingMethods(process.env).map((m) => METHOD_LABELS[m]);
  const firstUnit = `${RATE.freeMinutes + 1}–${RATE.unitMinutes} 分鐘`;
  return (
    <>
      <section className="site-hero-band">
        <div className="site-wrap site-hero">
          <div>
            <p className="eyebrow">SMART PARKING・SEAMLESS EXIT</p>
            <h1>智慧停車，<br />車到，柵欄就開。</h1>
            <p>
              {`${COMPANY.brand} 以 AI 車牌辨識與雲端管理，打造 24 小時無人自助停車場。不用取票、不用找零，手機掃碼就能付款，付完開到出口自動放行。`}
            </p>
            <div className="cta">
              <Link href="/#sites" className="pd-btn pd-btn--primary pd-btn--lg">找停車場</Link>
              <Link href="/#how" className="pd-btn pd-btn--lg ghost">怎麼付款</Link>
            </div>
          </div>
          <LaneArt />
        </div>
        <div className="site-wrap">
          <div className="site-stats">
            <div><b>24H</b><span>無人自助營運</span></div>
            <div><b>0 張</b><span>停車票卡，車牌就是通行證</span></div>
            <div><b>3 步</b><span>掃碼、輸入車牌、付款</span></div>
            <div><b>{methods.length} 種</b><span>線上付款方式</span></div>
          </div>
        </div>
      </section>

      <section id="features" className="site-wrap site-sec">
        <h2>為什麼停 ParkDodo</h2>
        <div className="site-features">
          <article>
            <div className="ic" aria-hidden="true"><Icon name="camera" /></div>
            <h3>AI 車牌辨識</h3>
            <p>入口自動記錄進場時間，出口辨識後放行。不用取票，也不怕票卡遺失。</p>
          </article>
          <article>
            <div className="ic" aria-hidden="true"><Icon name="phone" /></div>
            <h3>掃碼即付，免下載 App</h3>
            <p>手機相機掃描場內 QR Code 就能繳費，支援信用卡與多種行動支付，電子發票自動開立。</p>
          </article>
          <article>
            <div className="ic" aria-hidden="true"><Icon name="cloud" /></div>
            <h3>雲端即時管理</h3>
            <p>每個場站的車道、付款與設備狀態即時回報雲端，異常時主動通知值班人員，遠端就能協助開閘。</p>
          </article>
          <article>
            <div className="ic" aria-hidden="true"><Icon name="shield" /></div>
            <h3>斷網也不停擺</h3>
            <p>場站主機保存當下資料，網路短暫中斷時車道照常運作，恢復後自動補傳，不漏任何一筆紀錄。</p>
          </article>
        </div>
      </section>

      <section id="sites" className="site-wrap site-sec">
        <h2>停車場</h2>
        <div className="site-grid">
          {SITES.map((s) => (
            <article key={s.code} className="pd-card">
              <h3 style={{ margin: 0, fontSize: 19 }}>{s.name}</h3>
              <dl className="site-dl">
                <dt>地址</dt><dd>{orTodo(s.address)}</dd>
                <dt>營業時間</dt><dd>{orTodo(s.hours)}</dd>
                <dt>車位</dt><dd>{s.spaces ? `約 ${s.spaces} 格` : <Todo />}</dd>
                <dt>發票開立</dt><dd>{COMPANY.name}（統編 {s.taxId}）</dd>
              </dl>
              {s.address && (
                <p style={{ margin: "12px 0 0" }}>
                  <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}`} target="_blank" rel="noreferrer">在 Google 地圖開啟</a>
                </p>
              )}
            </article>
          ))}
        </div>
      </section>

      <section id="rates" className="site-wrap site-sec">
        <h2>收費標準</h2>
        <p className="lead">各停車場相同。超過免費時間後，從進場時間開始計費，未滿一個計費單位以一個單位計。</p>
        <div style={{ overflowX: "auto" }}>
          <table className="rate-table">
            <tbody>
              <tr><th>{RATE.freeMinutes} 分鐘內</th><td>免費（接送、臨時停靠）</td></tr>
              <tr><th>{firstUnit}</th><td>NT$ {RATE.unitPrice}</td></tr>
              <tr><th>之後每 {RATE.unitMinutes} 分鐘</th><td>NT$ {RATE.unitPrice}</td></tr>
              <tr><th>當日上限</th><td>{RATE.dailyCap ? `NT$ ${RATE.dailyCap}` : "不設上限"}</td></tr>
              <tr><th>付款後離場時間</th><td>{RATE.graceMinutes} 分鐘內出場；超過需補繳超時費用</td></tr>
            </tbody>
          </table>
        </div>
        {MONTHLY.show && (
          <p style={{ margin: "16px 0 0", lineHeight: 1.8 }}>
            <b>月租：</b>{MONTHLY.howTo}
            {MONTHLY.lineUrl && <> 也可以<a href={MONTHLY.lineUrl} target="_blank" rel="noreferrer">加入 LINE 官方帳號</a>詢問。</>}
          </p>
        )}
      </section>

      <section id="how" className="site-wrap site-sec">
        <h2>怎麼付款</h2>
        <ol className="site-steps">
          <li><b>掃描 QR Code</b><span>場內柱子、繳費告示上都有，用手機相機掃描即可，不用下載 App。</span></li>
          <li><b>輸入車牌</b><span>可以不打「-」；記不清楚英文，只打車牌上的 4 個數字也能找到。</span></li>
          <li><b>線上付款</b><span>付款完成後 {RATE.graceMinutes} 分鐘內開到出口，車牌辨識後柵欄自動開啟。</span></li>
        </ol>
        <p style={{ margin: "18px 0 0", lineHeight: 1.8 }}>
          <b>付款方式：</b>{methods.join("、")}。付款由統一金流 PAYUNi 處理，本公司不會取得或保存你的信用卡卡號。
        </p>
        <p style={{ margin: "6px 0 0", lineHeight: 1.8 }}>
          <b>電子發票：</b>可存入會員載具、手機條碼載具、捐贈，或開立公司統編發票寄到 Email。
        </p>
      </section>

      <section id="faq" className="site-wrap site-sec site-faq">
        <h2>常見問題</h2>
        <details><summary>查不到我的車牌怎麼辦？</summary><p>請確認車牌是否輸入正確，或改輸入車牌上的 4 個數字。仍然查不到，請按出口的對講機，我們會協助處理。</p></details>
        <details><summary>付款失敗會扣款嗎？</summary><p>付款失敗不會扣款。可以換一張信用卡或改用其他付款方式重新付款；一直無法付款，請按出口對講機。</p></details>
        <details><summary>付款後來不及在時間內出場？</summary><p>超過付款後 {RATE.graceMinutes} 分鐘才出場，出口會顯示需要補繳的金額，掃碼補繳後即可離場。</p></details>
        <details><summary>重複付款或金額有問題？</summary><p>請寄信到 {COMPANY.email}，附上車牌、停車場與付款時間。處理方式請見<Link href="/refund">退款與申訴</Link>。</p></details>
        <details><summary>發票在哪裡？</summary><p>依你付款時選擇的方式：存入載具的可在財政部電子發票 App 查詢；公司統編發票會寄到你填寫的 Email。</p></details>
      </section>

      <section className="site-wrap site-sec">
        <div className="site-partner">
          <div>
            <h2>你的停車場，也可以無人化</h2>
            <p>從車牌辨識、柵欄、場站主機到雲端管理與線上收款，ParkDodo 提供一套完整的無人停車系統。土地或停車場業者歡迎來信洽談合作。</p>
          </div>
          <a className="pd-btn pd-btn--primary pd-btn--lg" href={`mailto:${COMPANY.email}?subject=${encodeURIComponent("停車場合作洽詢")}`}>來信洽談</a>
        </div>
      </section>

      <section id="contact" className="site-wrap site-sec">
        <h2>聯絡我們</h2>
        <dl className="site-dl">
          <dt>公司名稱</dt><dd>{COMPANY.name}</dd>
          <dt>統一編號</dt><dd>{COMPANY.taxId}</dd>
          <dt>公司地址</dt><dd>{COMPANY.address}</dd>
          <dt>客服信箱</dt><dd>{COMPANY.email}</dd>
          {COMPANY.phone && <><dt>客服電話</dt><dd>{COMPANY.phone}</dd></>}
          <dt>現場求助</dt><dd>各停車場出口設有對講機</dd>
        </dl>
        {!REFUND.confirmed && <p style={{ margin: "16px 0 0" }}><Todo label="退款規則待公司確認" /></p>}
      </section>
    </>
  );
}
