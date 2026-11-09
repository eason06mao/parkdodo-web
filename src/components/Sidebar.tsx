"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Brand } from "@/lib/branding";
import { BrandMark } from "./BrandMark";
import { Icon } from "./Icon";

const items = [
  { href: "/console", label: "營運總覽", icon: "dashboard" },
  { href: "/console/monitor", label: "即時監控", icon: "video" },
  { href: "/console/incidents", label: "例外處理", icon: "alert", badgeKey: "incidents" },
  { href: "/console/sessions", label: "車輛進出紀錄", icon: "list" },
  { href: "/console/monthly", label: "月租管理", icon: "calendar" },
  { href: "/console/members", label: "會員與月租登記", icon: "users" },
  { href: "/console/analytics", label: "營收與車輛戰情板", icon: "chart" },
  { href: "/console/sites", label: "場站與設備", icon: "building" },
  { href: "/console/accounts", label: "帳號權限", icon: "lock" },
  { href: "/console/brand", label: "品牌設定", icon: "palette" },
] as const;

export function Sidebar({ openIncidents, hidden = [], userName, userRole, brand }: { openIncidents: number; hidden?: string[]; userName: string; userRole: string; brand: Brand }) {
  const pathname = usePathname();
  return (
    <nav aria-label="主選單" className="pd-sidebar">
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 8px", minWidth: 0 }}>
        <BrandMark brand={brand} />
        <div style={{ minWidth: 0 }}>
          <div className="pd-serif" style={{ fontSize: 18, fontWeight: 700, color: "#fff", overflowWrap: "anywhere", lineHeight: 1.3 }}>{brand.displayName}</div>
          {brand.subtitle && <div style={{ fontSize: 12, color: "var(--pd-night-muted)" }}>{brand.subtitle}</div>}
        </div>
      </div>

      <ul className="pd-nav-list">
        {items.filter((it) => !hidden.includes(it.href)).map((it) => {
          const active = it.href === "/console" ? pathname === "/console" : pathname.startsWith(it.href);
          return (
            <li key={it.href}>
              <Link href={it.href} className="pd-nav-link" aria-current={active ? "page" : undefined}>
                <Icon name={it.icon} />
                <span>{it.label}</span>
                {"badgeKey" in it && openIncidents > 0 && (
                  <span className="pd-nav-badge" aria-label={`${openIncidents} 件待處理`}>{openIncidents}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="pd-sidebar-foot" style={{ marginTop: "auto", padding: 16, borderRadius: 12, background: "#1F2E37" }}>
        <div style={{ fontSize: 12, color: "var(--pd-night-muted)" }}>{userRole}</div>
        <div style={{ fontSize: 15, color: "#fff", marginTop: 4 }}>{userName}</div>
        <Link href="/m/gate" style={{ display: "inline-block", marginTop: 10, fontSize: 13, color: "#7FC4BC" }}>手機版遠端開閘</Link>
      </div>
    </nav>
  );
}
