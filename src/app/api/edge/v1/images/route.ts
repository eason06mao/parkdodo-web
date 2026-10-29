import { createHash } from "node:crypto";
import { EdgeError, recordImage } from "@/lib/edge/service";
import { withEdge } from "@/lib/edge/http";
import { saveImage } from "@/lib/edge/storage";

// POST /api/edge/v1/images?eventUid=...&kind=plate|full   Body：JPEG（最大 2MB）
export async function POST(req: Request) {
  return withEdge(req, async (c, gw) => {
    const u = new URL(req.url);
    const eventUid = u.searchParams.get("eventUid") ?? "";
    const kind = u.searchParams.get("kind");
    if (!/^[\w.:-]{8,100}$/.test(eventUid) || (kind !== "plate" && kind !== "full")) throw new EdgeError("invalid", "eventUid 或 kind 錯誤。", 400);
    const data = Buffer.from(await req.arrayBuffer());
    if (data.length === 0 || data.length > 2_000_000) throw new EdgeError("invalid_size", "照片大小需在 2MB 以內。", 413);
    if (data[0] !== 0xff || data[1] !== 0xd8) throw new EdgeError("not_jpeg", "只接受 JPEG。", 415);
    const d = new Date();
    const name = `${gw.siteCode}/${d.toISOString().slice(0, 10)}/${eventUid}-${kind}.jpg`;
    const path = await saveImage(name, data);
    await recordImage(c, gw, { eventUid, kind, storagePath: path, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") });
    return { ok: true };
  });
}
