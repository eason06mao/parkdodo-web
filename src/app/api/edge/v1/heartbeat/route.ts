import { clientIp, readJson, withEdge } from "@/lib/edge/http";
import { heartbeat, type HeartbeatBody } from "@/lib/edge/service";

// POST /api/edge/v1/heartbeat（建議每 15 秒）→ { serverTime, configVersion, pendingCommands }
export async function POST(req: Request) {
  return withEdge(req, async (c, gw) => heartbeat(c, gw, await readJson<HeartbeatBody>(req, 50_000), clientIp(req)));
}
