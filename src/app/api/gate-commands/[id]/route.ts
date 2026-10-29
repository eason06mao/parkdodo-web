import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { dbConfigured, pool } from "@/lib/db";
import { siteRecords } from "@/lib/mock/tenancy";
import { can } from "@/lib/permissions";

// GET：查詢遠端開閘指令狀態（requested → dispatched → executed／failed／expired）
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!dbConfigured() || !/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await getCurrentUser();
  const r = await pool().query(
    "SELECT g.status, g.edge_result, g.executed_at, s.code FROM gate_commands g JOIN sites s ON s.id = g.site_id WHERE g.id = $1", [id]);
  const row = r.rows[0];
  const site = row && siteRecords.find((x) => x.code === row.code);
  if (!row || !site || !can(user, "gate.remote_open", { orgId: site.orgId, siteId: site.id })) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ status: row.status, result: row.edge_result, executedAt: row.executed_at }, { headers: { "cache-control": "no-store" } });
}
