/**
 * 首頁主視覺：智慧車道示意（俯視）。攝影機掃描 → 雲端確認 → 柵欄抬起，車輛通行。
 * 不出現任何車牌號碼。純 SVG＋CSS 動畫，尊重「減少動態效果」設定。
 */
export function LaneArt() {
  return (
    <svg className="lane-art" viewBox="0 0 520 360" role="img" aria-label="智慧車道示意：攝影機辨識車輛、雲端確認付款、柵欄自動開啟">
      <defs>
        <linearGradient id="la-beam" x1="0" x2="1">
          <stop offset="0" stopColor="#5EEAD4" stopOpacity=".55" />
          <stop offset="1" stopColor="#5EEAD4" stopOpacity="0" />
        </linearGradient>
        <pattern id="la-grid" width="26" height="26" patternUnits="userSpaceOnUse">
          <path d="M26 0H0V26" fill="none" stroke="#2A3B45" strokeWidth="1" />
        </pattern>
      </defs>

      <rect width="520" height="360" rx="22" fill="#121C22" />
      <rect width="520" height="360" rx="22" fill="url(#la-grid)" opacity=".7" />

      {/* 車道與停車格 */}
      <rect x="40" y="140" width="440" height="96" rx="8" fill="#1B2830" />
      <path d="M40 188H480" stroke="#3A4B55" strokeWidth="2" strokeDasharray="14 12" />
      {[60, 130, 200, 270, 340, 410].map((x) => (
        <rect key={x} x={x} y="40" width="58" height="84" rx="6" fill="none" stroke="#2F414B" strokeWidth="2" />
      ))}
      {[60, 130, 200, 270, 340, 410].map((x, i) => (
        <rect key={`b${x}`} x={x} y="252" width="58" height="84" rx="6" fill={i === 2 ? "rgba(94,234,212,.10)" : "none"} stroke={i === 2 ? "#5EEAD4" : "#2F414B"} strokeWidth="2" />
      ))}

      {/* 雲端節點 */}
      <g className="la-cloud">
        <circle cx="432" cy="82" r="26" fill="#0F766E" />
        <path d="M420 86a8 8 0 0 1 2-15 11 11 0 0 1 21 3 7 7 0 0 1-1 12z" fill="#E6F2F0" />
        <path d="M432 108V140" stroke="#5EEAD4" strokeWidth="2" strokeDasharray="4 5" className="la-link" />
      </g>

      {/* 攝影機與掃描光束 */}
      <g>
        <rect x="318" y="118" width="22" height="14" rx="3" fill="#E8E4DA" />
        <circle cx="336" cy="125" r="3" fill="#0F766E" />
        <path d="M336 132 L250 168 L250 206 Z" fill="url(#la-beam)" className="la-beam" />
      </g>

      {/* 柵欄：俯視時橫跨車道，開啟時轉到車道旁 */}
      <g>
        <g className="la-arm">
          <rect x="369" y="144" width="7" height="96" rx="3.5" fill="#E8E4DA" />
          {[154, 178, 202].map((y) => <rect key={y} x="369" y={y} width="7" height="10" fill="#0F766E" />)}
        </g>
        <rect x="364" y="236" width="17" height="17" rx="4" fill="#E8E4DA" />
      </g>

      {/* 車輛（俯視，沒有車牌） */}
      <g className="la-car">
        <rect x="160" y="164" width="86" height="48" rx="14" fill="#F6F4EF" />
        <rect x="190" y="170" width="30" height="36" rx="8" fill="#9FB0BA" />
        <rect x="236" y="170" width="6" height="10" rx="2" fill="#FDE68A" />
        <rect x="236" y="196" width="6" height="10" rx="2" fill="#FDE68A" />
      </g>

      {/* 步驟標籤 */}
      <g fontFamily="var(--pd-font-sans)" fontSize="13" fill="#C9D1D6">
        <text x="236" y="128">① 車牌辨識</text>
        <text x="318" y="87">② 雲端確認</text>
        <text x="388" y="270">③ 柵欄開啟</text>
      </g>
    </svg>
  );
}
