import type { Metadata } from "next";
import { Icon } from "@/components/Icon";
import { LoginForm } from "@/components/LoginForm";

export const metadata: Metadata = { title: "登入" };

export default function LoginPage() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexWrap: "wrap" }}>
      <section style={{ flex: "1 1 420px", background: "var(--pd-night)", color: "var(--pd-night-ink)", padding: "clamp(32px, 6vw, 72px)", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 40, position: "relative", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--pd-accent)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="logo" size={24} strokeWidth={2} />
          </div>
          <span className="pd-serif" style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>ParkDodo</span>
        </div>

        <div aria-hidden="true" style={{ position: "absolute", right: -40, top: 180, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14, width: 420, opacity: 0.55 }}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} style={{ height: 120, borderRadius: 6, border: `1px solid ${i === 2 || i === 5 ? "#0F766E" : "#3A4B55"}`, background: i === 2 || i === 5 ? "rgba(15,118,110,.18)" : "transparent" }} />
          ))}
        </div>

        <div style={{ position: "relative", maxWidth: 520 }}>
          <p className="pd-mono" style={{ margin: 0, fontSize: 13, color: "#7FC4BC" }}>PARKING, QUIETLY HANDLED</p>
          <h1 className="pd-serif" style={{ margin: "16px 0 0", fontSize: "clamp(32px, 4vw, 46px)", lineHeight: 1.35, color: "#fff" }}>讓每一次停車，<br />都安靜而準確。</h1>
          <p style={{ margin: "20px 0 0", fontSize: 16, lineHeight: 1.8, color: "#C9D1D6" }}>一個畫面看顧所有場站：車道、收費、例外與報表，總部、自營與加盟夥伴共用同一個入口。</p>
        </div>
        <div className="pd-mono" style={{ position: "relative", fontSize: 12, color: "var(--pd-night-muted)" }}>© ParkDodo・停車營運中心</div>
      </section>

      <section style={{ flex: "1 1 420px", display: "flex", alignItems: "center", justifyContent: "center", padding: "clamp(24px, 6vw, 72px)" }}>
        <LoginForm />
      </section>
    </div>
  );
}
