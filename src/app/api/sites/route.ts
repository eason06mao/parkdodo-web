import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { nextSiteCode } from "@/lib/data";
import { auditEntries, organizations, siteRecords } from "@/lib/mock/tenancy";
import { can } from "@/lib/permissions";
import { needsLicense, OPERATION_BY_ORG, validateNewSite, type NewSiteInput } from "@/lib/siteForm";

// Mock API：新增站點（只有總部 site.create 可以呼叫）。
// 正式版：同一個交易內寫入 sites、lanes、site_licenses、audit_logs；資料庫觸發器 guard_site_write 會再檢查一次。
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!can(user, "site.create")) {
    return NextResponse.json({ error: "forbidden", message: "新增站點只限總部管理員。" }, { status: 403 });
  }

  let v: NewSiteInput;
  try { v = (await req.json()) as NewSiteInput; } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const org = organizations.find((o) => o.id === v.orgId);
  const errors = validateNewSite(v, org?.type);
  if (Object.keys(errors).length || !org) return NextResponse.json({ error: "invalid", errors }, { status: 422 });

  const id = `site-${Date.now()}`;
  const code = nextSiteCode(v.city);
  const lanes = [
    ...Array.from({ length: v.entryLanes }, (_, i) => ({ code: `IN-${i + 1}`, name: `入口-${i + 1}`, direction: "entry" as const })),
    ...Array.from({ length: v.exitLanes }, (_, i) => ({ code: `OUT-${i + 1}`, name: `出口-${i + 1}`, direction: "exit" as const })),
  ];
  siteRecords.push({
    id, code, name: v.name.trim(), orgId: org.id, operationType: OPERATION_BY_ORG[org.type], collectionMode: v.collectionMode,
    status: "planning", city: v.city, district: v.district.trim() || undefined, address: v.address.trim(), totalSpaces: v.totalSpaces,
    lanes, edge: { name: "待配對", status: "provisioning" }, devices: [],
    license: needsLicense(org.type)
      ? { licenseNo: `LIC-${v.startsOn.slice(0, 4)}-${String(siteRecords.length + 1).padStart(4, "0")}`, plan: v.plan, maxLanes: v.maxLanes,
          startsOn: v.startsOn, endsOn: v.endsOn, graceDays: 14, status: "trial" }
      : undefined,
  });
  auditEntries.unshift({ at: new Date().toISOString(), actor: user.name, action: "新增站點", target: `${v.name.trim()}（${code}）→ ${org.name}`, orgId: org.id });

  return NextResponse.json({ id, code, mock: true }, { status: 201 });
}
