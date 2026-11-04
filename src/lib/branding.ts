// 組織品牌（白牌）：前後端共用的規則。
export interface Brand {
  orgId: string;
  displayName: string;   // 後台左上角、繳費頁的名稱
  subtitle: string;      // 名稱下面的小字
  accentColor: string | null; // #RRGGBB；null＝預設色
  logoUrl: string | null;
}

export const DEFAULT_ACCENT = "#0F766E";
export const DEFAULT_BRAND: Omit<Brand, "orgId"> = { displayName: "ParkDodo", subtitle: "停車營運中心", accentColor: null, logoUrl: null };
export const LOGO_MAX_BYTES = 512 * 1024;
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type LogoType = (typeof LOGO_TYPES)[number];

/** 主題色預設選項（都與白字對比 ≥ 4.5:1） */
export const ACCENT_PRESETS = ["#0F766E", "#1D4ED8", "#6D28D9", "#B42318", "#B45309", "#15803D", "#0E7490", "#334155"];

export interface BrandInput { displayName: string; subtitle: string; accentColor: string | null }
export type BrandErrors = Partial<Record<keyof BrandInput, string>>;

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** 白字在這個底色上的對比值 */
export const contrastWithWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);

export function normalizeColor(s: string | null | undefined): string | null {
  const v = (s ?? "").trim().toUpperCase();
  if (!v) return null;
  const m = /^#?([0-9A-F]{6})$/.exec(v) ?? /^#?([0-9A-F]{3})$/.exec(v);
  if (!m) return v; // 交給檢查回報錯誤
  return "#" + (m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1]);
}

export function validateBrand(v: BrandInput): BrandErrors {
  const e: BrandErrors = {};
  const n = v.displayName.trim();
  if (!n) e.displayName = "請填寫名稱。";
  else if ([...n].length > 20) e.displayName = "名稱最多 20 個字。";
  if ([...v.subtitle.trim()].length > 20) e.subtitle = "副標題最多 20 個字。";
  if (v.accentColor) {
    if (!/^#[0-9A-F]{6}$/.test(v.accentColor)) e.accentColor = "顏色格式應為 #RRGGBB，例如 #0F766E。";
    else if (contrastWithWhite(v.accentColor) < 4.5) e.accentColor = "這個顏色太淺，按鈕上的白字會看不清楚，請選深一點的顏色。";
  }
  return e;
}

/** 用檔案開頭判斷真正的格式（不信任副檔名與瀏覽器給的類型）；不接受 SVG */
export function sniffImage(b: Uint8Array): LogoType | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

/** 主題色的 CSS 變數（套在外層容器，裡面的按鈕、選取狀態都會跟著換） */
export function accentVars(color: string | null): Record<string, string> {
  if (!color) return {};
  return {
    "--pd-accent": color,
    "--pd-accent-hover": `color-mix(in srgb, ${color} 82%, black)`,
    "--pd-accent-tint": `color-mix(in srgb, ${color} 12%, white)`,
  };
}
