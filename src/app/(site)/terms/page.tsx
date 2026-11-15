import type { Metadata } from "next";
import Link from "next/link";
import { COMPANY, RATE } from "@/lib/siteContent";

export const metadata: Metadata = { title: "服務條款" };

export default function TermsPage() {
  return (
    <article className="site-wrap site-doc">
      <h1>服務條款</h1>
      <p className="date">公告日期：{COMPANY.policyDate}</p>
      <p>你進入本公司經營的停車場或使用線上繳費服務，即表示同意以下條款。</p>

      <h2>一、計費</h2>
      <ul>
        <li>入場時間以入口車牌辨識紀錄為準。</li>
        <li>收費依各停車場公告的收費標準；目前為 {RATE.freeMinutes} 分鐘內免費，超過後自入場時間起每 {RATE.unitMinutes} 分鐘新台幣 {RATE.unitPrice} 元，未滿以一單位計。</li>
        <li>付款後請於 {RATE.graceMinutes} 分鐘內出場；超過需補繳超時期間的費用。</li>
      </ul>

      <h2>二、付款與發票</h2>
      <ul>
        <li>線上付款由統一金流 PAYUNi 處理。付款結果以金流服務商通知本公司的結果為準。</li>
        <li>付款完成後依你選擇的方式開立電子發票。</li>
        <li>退款依<Link href="/refund">退款與申訴</Link>辦理。</li>
      </ul>

      <h2>三、使用規範</h2>
      <ul>
        <li>請依場內標示停放，勿占用通道、出入口或他人車位。</li>
        <li>出入時請依柵欄與號誌指示通行，一次通過一輛車，勿跟車進出。</li>
        <li>本停車場僅提供車位使用，不負保管責任；請勿將貴重物品留在車內。</li>
        <li>查無入場紀錄或車牌無法辨識時，請按出口對講機，由服務人員協助處理。</li>
      </ul>

      <h2>四、個人資料</h2>
      <p>本公司依<Link href="/privacy">隱私權政策</Link>處理你的個人資料。</p>

      <h2>五、條款修訂</h2>
      <p>本條款修訂時會公告於本網站與停車場現場。</p>
    </article>
  );
}
