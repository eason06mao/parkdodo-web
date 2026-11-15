import type { Metadata } from "next";
import Link from "next/link";
import { COMPANY } from "@/lib/siteContent";
import "./site.css";

export const metadata: Metadata = {
  title: { default: "ParkDodo 車格跳動｜無人自助停車場", template: "%s｜ParkDodo 車格跳動" },
  description: "車格跳動有限公司經營的無人自助停車場：掃碼查詢停車費、線上付款、車牌辨識自動開閘。",
};

/** 公司網站（parkdodo.tw）共用的頁首與頁尾 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="site">
      <header className="site-head">
        <div className="site-wrap">
          <Link href="/" className="site-logo" aria-label="ParkDodo 首頁">
            <span className="mark" aria-hidden="true">P</span>
            <b>ParkDodo</b>
          </Link>
          <nav className="site-nav" aria-label="主選單">
            <Link href="/#sites">停車場</Link>
            <Link href="/#rates">收費標準</Link>
            <Link href="/#how">付款方式</Link>
            <Link href="/#faq">常見問題</Link>
            <Link href="/#contact">聯絡我們</Link>
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <footer className="site-foot">
        <div className="site-wrap">
          <div className="links">
            <Link href="/privacy">隱私權政策</Link>
            <Link href="/refund">退款與申訴</Link>
            <Link href="/terms">服務條款</Link>
          </div>
          <div>{COMPANY.name}・統一編號 {COMPANY.taxId}</div>
          <div>{COMPANY.address}・客服信箱 {COMPANY.email}</div>
          <div>© 2026 {COMPANY.name}</div>
        </div>
      </footer>
    </div>
  );
}
