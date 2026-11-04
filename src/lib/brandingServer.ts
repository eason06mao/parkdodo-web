// 組織品牌的後端。有雲端資料庫時存在 org_branding（Logo 存成 BYTEA，最大 512 KB，Cloud Run 多台機器共用）；沒有時存在記憶體。
import { createHash } from "node:crypto";
import { dbConfigured, pool, tx } from "./db";
import { DEFAULT_BRAND, LOGO_MAX_BYTES, sniffImage, validateBrand, type Brand, type BrandErrors, type BrandInput, type LogoType } from "./branding";
import { auditEntries, organizations, siteRecords } from "./mock/tenancy";
import { can, type Principal } from "./permissions";

export class BrandError extends Error {
  constructor(message: string, public status = 422, public errors?: BrandErrors) { super(message); }
}

interface Stored extends BrandInput { logo: Buffer | null; logoType: LogoType | null; logoHash: string | null }
const g = globalThis as unknown as { __pdBranding?: Map<string, Stored> };
g.__pdBranding ??= new Map();
const mem = g.__pdBranding;

const logoUrl = (orgId: string, hash: string | null) => (hash ? `/api/brand/${encodeURIComponent(orgId)}/logo?v=${hash.slice(0, 12)}` : null);
/** 還沒設定時：總部用 ParkDodo，其他組織用組織名稱 */
function fallback(orgId: string): Brand {
  const org = organizations.find((o) => o.id === orgId);
  return { orgId, ...DEFAULT_BRAND, displayName: org && org.type !== "hq" ? org.name.slice(0, 20) : DEFAULT_BRAND.displayName };
}

export async function getBrand(orgId: string): Promise<Brand> {
  if (!dbConfigured()) {
    const s = mem.get(orgId);
    return s ? { orgId, displayName: s.displayName, subtitle: s.subtitle, accentColor: s.accentColor, logoUrl: logoUrl(orgId, s.logoHash) } : fallback(orgId);
  }
  try {
    const r = (await pool().query(
      `SELECT b.display_name, b.subtitle, b.accent_color, b.logo_hash FROM org_branding b JOIN organizations o ON o.id = b.org_id WHERE o.code = $1`, [orgId])).rows[0];
    return r ? { orgId, displayName: r.display_name, subtitle: r.subtitle, accentColor: r.accent_color, logoUrl: logoUrl(orgId, r.logo_hash) } : fallback(orgId);
  } catch (e) {
    console.error("[brand get]", e);   // 品牌讀不到時不能讓整個後台壞掉
    return fallback(orgId);
  }
}

/** 登入者的後台品牌：用他第一個綁定的組織（總部帳號＝ParkDodo） */
export async function brandForUser(user: Principal): Promise<Brand> {
  return getBrand(user.bindings[0]?.orgId ?? "org-hq");
}
/** 車主頁面（繳費、會員）：用站點所屬組織的品牌 */
export async function brandForSite(siteCode: string | null | undefined): Promise<Brand> {
  const site = siteRecords.find((s) => s.code === siteCode);
  return getBrand(site?.orgId ?? "org-hq");
}

/** 可以改這個組織品牌的人：平台管理員，或在該組織有 brand.manage 的全組織綁定 */
export function canEditBrand(user: Principal, orgId: string) {
  if (can(user, "platform.admin")) return true;
  return user.bindings.some((b) => b.orgId === orgId && !b.siteId) && can(user, "brand.manage", { orgId });
}
export function editableOrgs(user: Principal) {
  return organizations.filter((o) => canEditBrand(user, o.id));
}

function check(user: Principal, orgId: string) {
  const org = organizations.find((o) => o.id === orgId);
  if (!org) throw new BrandError("找不到這個組織。", 404);
  if (!canEditBrand(user, orgId)) throw new BrandError("你沒有修改這個組織品牌的權限。", 403);
  return org;
}

/** 資料庫裡對應的組織；還沒有就建立（與月租方案相同做法） */
async function dbOrgId(orgId: string): Promise<string> {
  const org = organizations.find((o) => o.id === orgId)!;
  const hit = (await pool().query("SELECT id FROM organizations WHERE code = $1", [orgId])).rows[0];
  if (hit) return hit.id;
  return (await pool().query(
    `INSERT INTO organizations (org_type, name, tax_id, contact_name, status, code, parent_org_id)
     VALUES ($1, $2, $3, $4, $5, $6,
       CASE WHEN $1 = 'hq' THEN NULL ELSE (SELECT id FROM organizations WHERE org_type = 'hq' ORDER BY (code = 'org-hq') DESC NULLS LAST, created_at LIMIT 1) END)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [org.type, org.name, org.taxId ?? null, org.contactName ?? null, org.status, orgId])).rows[0].id;
}

function audit(user: Principal, orgId: string, action: string, detail: string) {
  auditEntries.unshift({ at: new Date().toISOString(), actor: user.name, orgId, action, target: "品牌設定", reason: detail || undefined });
}

export async function saveBrand(user: Principal, orgId: string, raw: BrandInput): Promise<Brand> {
  check(user, orgId);
  const v: BrandInput = { displayName: raw.displayName.trim(), subtitle: raw.subtitle.trim(), accentColor: raw.accentColor };
  const errors = validateBrand(v);
  if (Object.keys(errors).length) throw new BrandError("請檢查標示的欄位。", 422, errors);
  if (!dbConfigured()) {
    const cur = mem.get(orgId);
    mem.set(orgId, { ...v, logo: cur?.logo ?? null, logoType: cur?.logoType ?? null, logoHash: cur?.logoHash ?? null });
  } else {
    const id = await dbOrgId(orgId);
    await pool().query(
      `INSERT INTO org_branding (org_id, display_name, subtitle, accent_color, updated_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (org_id) DO UPDATE SET display_name = EXCLUDED.display_name, subtitle = EXCLUDED.subtitle,
         accent_color = EXCLUDED.accent_color, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [id, v.displayName, v.subtitle, v.accentColor, user.name]);
  }
  audit(user, orgId, "修改品牌", `名稱「${v.displayName}」${v.accentColor ? `、主題色 ${v.accentColor}` : "、預設主題色"}`);
  return getBrand(orgId);
}

export async function saveLogo(user: Principal, orgId: string, bytes: Uint8Array | null): Promise<Brand> {
  check(user, orgId);
  let type: LogoType | null = null;
  let hash: string | null = null;
  if (bytes) {
    if (bytes.length > LOGO_MAX_BYTES) throw new BrandError("圖片太大了，請小於 512 KB。", 413);
    type = sniffImage(bytes);
    if (!type) throw new BrandError("只接受 PNG、JPG 或 WebP 圖片。", 415);
    hash = createHash("sha256").update(bytes).digest("hex");
  }
  const buf = bytes ? Buffer.from(bytes) : null;
  if (!dbConfigured()) {
    const cur = mem.get(orgId) ?? { ...fallback(orgId), logo: null, logoType: null, logoHash: null };
    mem.set(orgId, { displayName: cur.displayName, subtitle: cur.subtitle, accentColor: cur.accentColor, logo: buf, logoType: type, logoHash: hash });
  } else {
    const fb = fallback(orgId);
    await tx(async (c) => {
      const id = await dbOrgId(orgId);
      await c.query(
        `INSERT INTO org_branding (org_id, display_name, subtitle, logo, logo_type, logo_hash, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (org_id) DO UPDATE SET logo = EXCLUDED.logo, logo_type = EXCLUDED.logo_type, logo_hash = EXCLUDED.logo_hash,
           updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [id, fb.displayName, fb.subtitle, buf, type, hash, user.name]);
    });
  }
  audit(user, orgId, bytes ? "上傳 Logo" : "移除 Logo", bytes ? `${type}，${Math.round(bytes.length / 1024)} KB` : "");
  return getBrand(orgId);
}

export async function getLogo(orgId: string): Promise<{ bytes: Buffer; type: LogoType; hash: string } | null> {
  if (!dbConfigured()) {
    const s = mem.get(orgId);
    return s?.logo && s.logoType && s.logoHash ? { bytes: s.logo, type: s.logoType, hash: s.logoHash } : null;
  }
  const r = (await pool().query(
    "SELECT b.logo, b.logo_type, b.logo_hash FROM org_branding b JOIN organizations o ON o.id = b.org_id WHERE o.code = $1 AND b.logo IS NOT NULL", [orgId])).rows[0];
  return r ? { bytes: r.logo, type: r.logo_type, hash: r.logo_hash } : null;
}

/** 只給測試用 */
export function __resetBrandMemory() { mem.clear(); }
