import { NextResponse } from "next/server";
import { dbConfigured, pool } from "@/lib/db";
import { readImage } from "@/lib/edge/storage";

// GET /api/pay/photo?s=<停車紀錄 id>：繳費頁認車用照片（入場時的「車牌＋車頭」，沒有就用車牌特寫）。
// 只給還在場內的車；不提供整張照片（看得到車內與周遭），整張照只在後台看得到。
// 停車紀錄 id 只會在車主查詢後出現在候選清單，無法猜測。
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("s") ?? "";
  if (!dbConfigured() || !/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse(null, { status: 404 });
  const r = (await pool().query(
    `SELECT i.kind, i.storage_path FROM parking_sessions s JOIN event_images i ON i.event_uid = s.entry_event_uid
     WHERE s.id = $1 AND s.status IN ('open','paid','exiting','exception') AND i.kind IN ('front','plate')
     ORDER BY (i.kind = 'front') DESC LIMIT 1`, [id])).rows[0];
  const img = r ? await readImage(r.storage_path).catch(() => null) : null;
  if (!img) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(img), {
    headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=600", "x-content-type-options": "nosniff" },
  });
}
