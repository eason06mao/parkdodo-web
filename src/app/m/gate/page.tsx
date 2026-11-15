import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { getLanes, getSiteRecords } from "@/lib/data";
import { dbConfigured } from "@/lib/db";
import { listLiveLanes } from "@/lib/lanesDb";
import { can } from "@/lib/permissions";
import { MobileGateFlow, type GateLane } from "./MobileGateFlow";

export const metadata: Metadata = { title: "遠端開閘" };
export const dynamic = "force-dynamic";

export default async function MobileGatePage() {
  const user = await getCurrentUser();
  if (!dbConfigured()) {
    // 本機沒有資料庫：示意畫面
    const lanes: GateLane[] = (await getLanes()).map((l) => ({
      id: l.id, siteId: l.siteId, siteName: l.siteName, code: l.code, name: l.name,
      paired: true, online: l.online, lastPlate: l.lastPlate, lastAt: l.lastAt, attention: l.attention ?? null,
    }));
    return <MobileGateFlow lanes={lanes} live={false} />;
  }
  const sites = (await getSiteRecords(user)).filter((s) => can(user, "gate.remote_open", { orgId: s.orgId, siteId: s.id }));
  const lanes: GateLane[] = (await listLiveLanes(sites.map((s) => s.code))).map((l) => ({
    id: l.id, siteId: l.siteId, siteName: l.siteName, code: l.code, name: l.name,
    paired: l.paired, online: l.online, lastPlate: l.lastPlate, lastAt: l.lastAt,
    attention: !l.paired ? "尚未配對工控機" : !l.online ? "工控機離線" : null,
  }));
  return <MobileGateFlow lanes={lanes} live />;
}
