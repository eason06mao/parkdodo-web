import Link from "next/link";
import { Icon } from "./Icon";

export function Forbidden({ title, message }: { title: string; message: string }) {
  return (
    <main className="pd-main">
      <section className="pd-card" style={{ maxWidth: 560, margin: "48px auto", textAlign: "center", padding: "40px 32px" }}>
        <div style={{ color: "var(--pd-muted)", display: "flex", justifyContent: "center" }}><Icon name="lock" size={32} /></div>
        <h1 className="pd-serif" style={{ fontSize: 24, margin: "16px 0 8px" }}>{title}</h1>
        <p style={{ margin: 0, color: "var(--pd-muted)", lineHeight: 1.8 }}>{message}</p>
        <Link href="/console" className="pd-btn" style={{ marginTop: 24 }}>回營運總覽</Link>
      </section>
    </main>
  );
}
