import type { Brand } from "@/lib/branding";
import { Icon } from "./Icon";

/** 品牌標誌：有 Logo 放在白底圓角方塊（深色、透明底的 Logo 都看得清楚）；沒有就用主題色方塊＋預設圖示 */
export function BrandMark({ brand, size = 40 }: { brand: Pick<Brand, "logoUrl" | "displayName">; size?: number }) {
  if (brand.logoUrl) {
    return (
      <span style={{ width: size, height: size, borderRadius: size * 0.3, background: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 3, flex: "none", overflow: "hidden" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.logoUrl} alt={`${brand.displayName} Logo`} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
      </span>
    );
  }
  return (
    <span aria-hidden style={{ width: size, height: size, borderRadius: size * 0.3, background: "var(--pd-accent)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
      <Icon name="logo" size={Math.round(size * 0.55)} strokeWidth={2} />
    </span>
  );
}
