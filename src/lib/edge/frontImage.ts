// 入場照片的整張與車牌特寫都上傳後，自動產生「車牌＋車頭」照，給繳費頁認車用。
import { createHash } from "node:crypto";
import type { Db } from "./service";
import { makeFrontCrop } from "./frontCrop";
import { readImage, saveImage } from "./storage";

export async function buildFrontImage(db: Db, siteCode: string, eventUid: string): Promise<boolean> {
  const rows = (await db.query("SELECT kind, storage_path FROM event_images WHERE event_uid = $1", [eventUid])).rows as { kind: string; storage_path: string }[];
  const path = (k: string) => rows.find((r) => r.kind === k)?.storage_path;
  if (path("front") || !path("full") || !path("plate")) return false;
  const [full, plate] = await Promise.all([readImage(path("full")!), readImage(path("plate")!)]);
  if (!full || !plate) return false;
  const front = await makeFrontCrop(full, plate);
  if (!front) return false;
  const name = `${siteCode}/${new Date().toISOString().slice(0, 10)}/${eventUid}-front.jpg`;
  const stored = await saveImage(name, front);
  await db.query(
    `INSERT INTO event_images (event_uid, kind, storage_path, bytes, sha256) VALUES ($1, 'front', $2, $3, $4)
     ON CONFLICT (event_uid, kind) DO NOTHING`, [eventUid, stored, front.length, createHash("sha256").update(front).digest("hex")]);
  return true;
}
