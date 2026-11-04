import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSiteRecords } from "@/lib/data";
import { LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/members";
import { MemberError, setLeadStatus } from "@/lib/membersServer";
import { can } from "@/lib/permissions";

// PATCH { status }：客服更新月租登記單狀態（需要該站的 monthly.manage）
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const b = (await req.json().catch(() => null)) as { status?: LeadStatus } | null;
  if (!b?.status || !(b.status in LEAD_STATUS_LABELS)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const codes = (await getSiteRecords(user)).filter((s) => can(user, "monthly.manage", { orgId: s.orgId, siteId: s.id })).map((s) => s.code);
  try {
    return NextResponse.json({ lead: await setLeadStatus(id, b.status, user.name, codes) });
  } catch (e) {
    if (e instanceof MemberError) return NextResponse.json({ error: "invalid", message: e.message }, { status: e.status });
    console.error("[lead status]", e);
    return NextResponse.json({ error: "server_error", message: "儲存失敗，請再試一次。" }, { status: 500 });
  }
}
