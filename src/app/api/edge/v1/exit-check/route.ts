import { readJson, withEdge } from "@/lib/edge/http";
import { exitDecision } from "@/lib/edge/service";

// POST /api/edge/v1/exit-check  { laneCode, plate } → { sessionId, amount, decision }
// 車輛停在出口等待付款時使用（不寫入事件）；建議每 2 秒一次、最多 5 分鐘。
export async function POST(req: Request) {
  return withEdge(req, async (c, gw) => {
    const b = await readJson<{ laneCode?: string; plate?: string }>(req, 2_000);
    return exitDecision(c, gw, { laneCode: String(b.laneCode ?? ""), plate: String(b.plate ?? "") });
  });
}
