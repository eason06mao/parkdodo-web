import { EdgeError } from "@/lib/edge/service";
import { readJson, withEdge } from "@/lib/edge/http";
import { ingestEvents, type EdgeEvent } from "@/lib/edge/service";

// POST /api/edge/v1/events  { events: [...] }（一次最多 200 筆）→ { results: [...] }
// 每筆用 uid 去重：重送同一筆會回 duplicate 與第一次的結果，Edge 可以放心重試。
export async function POST(req: Request) {
  return withEdge(req, async (c, gw) => {
    const b = await readJson<{ events?: EdgeEvent[] }>(req);
    if (!Array.isArray(b.events) || b.events.length === 0) throw new EdgeError("invalid", "events 不能是空的。", 400);
    if (b.events.length > 200) throw new EdgeError("too_many", "一次最多 200 筆。", 413);
    return { results: await ingestEvents(c, gw, b.events) };
  });
}
