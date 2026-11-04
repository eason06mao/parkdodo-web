"use client";

import { useState } from "react";

export function MockLogin({ provider, state }: { provider: "line" | "google"; state: string }) {
  const label = provider === "line" ? "LINE" : "Google";
  const [name, setName] = useState("示範使用者");
  const [email, setEmail] = useState("demo@example.com");
  const go = (cancel = false) => {
    const q = new URLSearchParams({ state });
    if (cancel) q.set("error", "access_denied");
    else q.set("code", "mock_" + btoa(unescape(encodeURIComponent(JSON.stringify({ sub: email.trim().toLowerCase() || name, name, email })))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
    location.href = `/api/members/oauth/${provider}/callback?${q}`;
  };
  return (
    <div style={{ minHeight: "100vh", maxWidth: 420, margin: "0 auto", padding: "0 0 32px", background: "var(--pd-ground)" }}>
      <div className="pd-mock-banner" role="note">模擬環境・這不是真的 {label}，申請好 {label} 登入金鑰後會換成官方登入頁</div>
      <main style={{ padding: "24px 20px", display: "grid", gap: 14 }}>
        <h1 className="pd-serif" style={{ margin: 0, fontSize: 22 }}>模擬 {label} 登入</h1>
        <p className="pd-label" style={{ margin: 0 }}>用同一個 Email 再登入一次，會回到同一位會員。</p>
        <div className="pd-field"><label htmlFor="mn">{label} 顯示名稱</label><input id="mn" className="pd-input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="pd-field"><label htmlFor="me">Email</label><input id="me" type="email" className="pd-input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <button type="button" className="pd-btn pd-btn--primary pd-btn--block pd-btn--lg" onClick={() => go()}>同意並登入</button>
        <button type="button" className="pd-btn pd-btn--block" onClick={() => go(true)}>取消</button>
      </main>
    </div>
  );
}
