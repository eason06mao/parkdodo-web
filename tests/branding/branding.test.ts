// npm run test:branding — 品牌設定：顏色對比、圖片格式、權限、儲存（記憶體版；設定 DATABASE_URL 時也跑資料庫版）
import assert from "node:assert/strict";
import { test } from "node:test";
import { ACCENT_PRESETS, contrastWithWhite, normalizeColor, sniffImage, validateBrand } from "../../src/lib/branding";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);

test("顏色正規化與對比檢查", () => {
  assert.equal(normalizeColor("0f766e"), "#0F766E");
  assert.equal(normalizeColor("#abc"), "#AABBCC");
  assert.equal(normalizeColor(""), null);
  for (const c of ACCENT_PRESETS) assert.ok(contrastWithWhite(c) >= 4.5, `${c} 對比 ${contrastWithWhite(c)}`);
  assert.ok(validateBrand({ displayName: "好停車", subtitle: "", accentColor: "#FFE066" }).accentColor);  // 太淺
  assert.ok(validateBrand({ displayName: "好停車", subtitle: "", accentColor: "red" }).accentColor);
  assert.ok(validateBrand({ displayName: " ", subtitle: "", accentColor: null }).displayName);
  assert.ok(validateBrand({ displayName: "一二三四五六七八九十一二三四五六七八九十一", subtitle: "", accentColor: null }).displayName);
  assert.deepEqual(validateBrand({ displayName: "好停車", subtitle: "停車營運中心", accentColor: "#1D4ED8" }), {});
});

test("用檔案開頭判斷圖片格式，不接受 SVG", () => {
  assert.equal(sniffImage(PNG), "image/png");
  assert.equal(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0])), "image/jpeg");
  assert.equal(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
  assert.equal(sniffImage(new TextEncoder().encode("GIF89a")), null);
});

for (const withDb of [false, true]) {
  const url = process.env.DATABASE_URL;
  test(`權限與儲存（${withDb ? "資料庫" : "記憶體"}）`, { skip: withDb && !url && "未設定 DATABASE_URL" }, async () => {
    if (withDb) process.env.DATABASE_URL = url; else delete process.env.DATABASE_URL;
    const s = await import("../../src/lib/brandingServer");
    const { mockPersonas } = await import("../../src/lib/mock/tenancy");
    const { pool } = await import("../../src/lib/db");
    const p = (id: string) => mockPersonas.find((x) => x.id === id)!;
    if (!withDb) s.__resetBrandMemory();
    else await pool().query("DELETE FROM org_branding WHERE org_id IN (SELECT id FROM organizations WHERE code = 'org-lic-a')");

    // 還沒設定：系統客戶用組織名稱、總部用 ParkDodo
    assert.equal((await s.getBrand("org-lic-a")).displayName, "示範系統客戶 A");
    assert.equal((await s.brandForUser(p("u-hq-ops"))).displayName, "ParkDodo");

    // 權限：系統客戶管理員只能改自己的；現場人員不能改；總部管理員都能改
    assert.deepEqual(s.editableOrgs(p("u-lic-admin")).map((o) => o.id), ["org-lic-a"]);
    assert.deepEqual(s.editableOrgs(p("u-lic-staff")), []);
    assert.ok(s.editableOrgs(p("u-hq-admin")).length >= 3);
    await assert.rejects(() => s.saveBrand(p("u-lic-admin"), "org-hq", { displayName: "x", subtitle: "", accentColor: null }), /沒有修改/);
    await assert.rejects(() => s.saveBrand(p("u-lic-staff"), "org-lic-a", { displayName: "x", subtitle: "", accentColor: null }), /沒有修改/);

    const b = await s.saveBrand(p("u-lic-admin"), "org-lic-a", { displayName: "  好停車  ", subtitle: "停車營運中心", accentColor: "#1D4ED8" });
    assert.equal(b.displayName, "好停車");
    assert.equal(b.accentColor, "#1D4ED8");
    await assert.rejects(() => s.saveBrand(p("u-lic-admin"), "org-lic-a", { displayName: "好停車", subtitle: "", accentColor: "#FFFF00" }), /請檢查/);

    // Logo：PNG 可以、SVG 不行；網址帶版本；移除後回到文字標誌
    await assert.rejects(() => s.saveLogo(p("u-lic-admin"), "org-lic-a", new TextEncoder().encode("<svg></svg>")), /PNG、JPG 或 WebP/);
    await assert.rejects(() => s.saveLogo(p("u-lic-admin"), "org-lic-a", new Uint8Array(600 * 1024)), /512 KB/);
    const withLogo = await s.saveLogo(p("u-lic-admin"), "org-lic-a", PNG);
    assert.match(withLogo.logoUrl!, /^\/api\/brand\/org-lic-a\/logo\?v=[0-9a-f]{12}$/);
    assert.equal(withLogo.displayName, "好停車");   // 上傳 Logo 不會蓋掉名稱
    const logo = await s.getLogo("org-lic-a");
    assert.equal(logo?.type, "image/png");
    assert.deepEqual(new Uint8Array(logo!.bytes), PNG);
    assert.equal((await s.brandForSite("DEMO02")).logoUrl, withLogo.logoUrl);  // 該組織的站點
    assert.equal((await s.brandForSite("TXG001")).displayName, "ParkDodo");    // 總部的站點不受影響
    const removed = await s.saveLogo(p("u-lic-admin"), "org-lic-a", null);
    assert.equal(removed.logoUrl, null);
    assert.equal(await s.getLogo("org-lic-a"), null);
  });
}
