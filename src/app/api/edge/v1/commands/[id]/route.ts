import { readJson, withEdge } from "@/lib/edge/http";
import { commandResult, EdgeError } from "@/lib/edge/service";

// POST /api/edge/v1/commands/{id}  { ok: true|false, detail?: "..." }：回報遠端開閘執行結果
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withEdge(req, async (c, gw) => {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new EdgeError("invalid", "指令編號錯誤。", 400);
    const b = await readJson<{ ok?: boolean; detail?: string }>(req, 10_000);
    const updated = await commandResult(c, gw, id, { ok: !!b.ok, detail: typeof b.detail === "string" ? b.detail.slice(0, 500) : undefined });
    if (!updated) throw new EdgeError("not_found", "找不到這個指令，或已經回報過。", 404);
    return { ok: true };
  });
}
