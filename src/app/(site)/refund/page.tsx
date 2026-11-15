import type { Metadata } from "next";
import { COMPANY, REFUND } from "@/lib/siteContent";
import { Todo } from "../Todo";

export const metadata: Metadata = { title: "退款與申訴" };

export default function RefundPage() {
  return (
    <article className="site-wrap site-doc">
      <h1>退款與申訴</h1>
      <p className="date">公告日期：{COMPANY.policyDate}{!REFUND.confirmed && <> <Todo label="內容待公司確認" /></>}</p>

      <h2>一、可以申請退款的情況</h2>
      <ul>
        <li>同一次停車重複付款。</li>
        <li>因系統或設備異常，造成金額計算錯誤或多收費用。</li>
        <li>已付款但因設備故障無法出場，經現場人員協助放行後確認重複收費。</li>
      </ul>
      <p>停車費依實際停車時間計算，服務完成後不接受因個人因素（例如改變行程）申請退款。</p>

      <h2>二、怎麼申請</h2>
      <p>請寄信至 {COMPANY.email}，提供以下資料，方便我們查證：</p>
      <ul>
        <li>停車場名稱與車牌號碼</li>
        <li>付款日期與時間、金額、付款方式</li>
        <li>付款完成畫面截圖或信用卡帳單（如有）</li>
        <li>聯絡方式</li>
      </ul>

      <h2>三、處理時間與方式</h2>
      <p>
        本公司收到申請後，會在 3 個工作天內回覆。查證屬實的款項，於 {REFUND.days} 個工作天內以原付款方式退回；
        實際入帳時間依發卡銀行或支付業者作業而定。已開立的電子發票會一併作廢或開立折讓。
      </p>

      <h2>四、申訴與其他問題</h2>
      <p>對收費或服務有疑問，請寄信至 {COMPANY.email}，或在停車場出口按對講機。</p>
    </article>
  );
}
