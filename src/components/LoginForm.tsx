"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "./Icon";

// Mock 登入：不送出帳密、不放進網址，直接進入後台。
// 正式版改為 POST /api/auth/login（伺服器端驗證 + MFA + HttpOnly Cookie）。
export function LoginForm() {
  const router = useRouter();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    router.push("/console");
  };
  return (
    <form onSubmit={onSubmit} style={{ width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", gap: 22 }}>
      <div>
        <h2 className="pd-serif" style={{ margin: 0, fontSize: 30 }}>登入營運後台</h2>
        <p style={{ margin: "10px 0 0", color: "var(--pd-muted)" }}>總部、自營商與加盟主皆由此登入，系統會依帳號帶入可管理的場站。</p>
      </div>
      <div className="pd-field">
        <label htmlFor="acc">帳號（電子郵件）</label>
        <input id="acc" name="email" className="pd-input" type="email" autoComplete="username" placeholder="name@company.com" />
      </div>
      <div className="pd-field">
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <label htmlFor="pwd">密碼</label>
          <Link href="#" style={{ fontSize: 14 }}>忘記密碼</Link>
        </div>
        <input id="pwd" name="password" className="pd-input" type="password" autoComplete="current-password" />
      </div>
      <button type="submit" className="pd-btn pd-btn--primary pd-btn--lg">登入</button>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderRadius: 12, background: "#EEF5F3", fontSize: 14, color: "var(--pd-accent-hover)" }}>
        <Icon name="lock" />
        登入後需完成雙重驗證（MFA），遠端開閘與財務功能必須驗證。
      </div>
      <p className="pd-label" style={{ margin: 0 }}>Mock 版本：不驗證帳密，按登入即進入後台。</p>
    </form>
  );
}
