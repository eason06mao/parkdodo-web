import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { locate, makeFrontCrop } from "../../src/lib/edge/frontCrop";

// 合成一張「路面＋車」的 1920×1080 照片：低頻紋理放大，再畫上車牌（白底黑字塊）
async function scene(seed: number) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const w = 96, h = 54, raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(rnd() * 255);
  const plateRaw = Buffer.alloc(200 * 60 * 3, 240);
  for (let i = 0; i < 7; i++) for (let y = 10; y < 50; y++) for (let x = 12 + i * 26; x < 12 + i * 26 + 14; x++) {
    if ((x + y + i * seed) % 5 !== 0) plateRaw.fill(20, (y * 200 + x) * 3, (y * 200 + x) * 3 + 3);
  }
  const plate = await sharp(plateRaw, { raw: { width: 200, height: 60, channels: 3 } }).png().toBuffer();
  const full = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).resize(1920, 1080, { kernel: "cubic" })
    .composite([{ input: plate, left: 900, top: 700 }]).jpeg({ quality: 85 }).toBuffer();
  const plateJpeg = await sharp(full).extract({ left: 900, top: 700, width: 200, height: 60 }).jpeg({ quality: 80 }).toBuffer();
  return { full, plateJpeg };
}

test("在整張照片裡找到車牌位置並裁出車頭", async () => {
  const { full, plateJpeg } = await scene(7);
  const out = await makeFrontCrop(full, plateJpeg);
  assert.ok(out, "應該找得到");
  const m = await sharp(out!).metadata();
  assert.equal(m.width, 480);
  assert.ok(m.height! > 150 && m.height! < 300, `高度 ${m.height}`);
});

test("locate 回傳正確座標", async () => {
  const { full, plateJpeg } = await scene(3);
  const g = async (b: Buffer, w: number, h: number) => {
    const { data, info } = await sharp(b).resize(w, h, { fit: "fill" }).grayscale().raw().toBuffer({ resolveWithObject: true });
    return { w: info.width, h: info.height, px: new Uint8Array(data) };
  };
  const hit = locate(await g(full, 480, 270), await g(plateJpeg, 50, 15));
  assert.ok(hit && Math.abs(hit.x - 225) <= 2 && Math.abs(hit.y - 175) <= 2, JSON.stringify(hit));
});

test("特寫不屬於這張照片時回傳 null（改用車牌特寫）", async () => {
  const a = await scene(11);
  const noise = await sharp(Buffer.from(Array.from({ length: 200 * 60 * 3 }, (_, i) => (i * 7919) % 251)), { raw: { width: 200, height: 60, channels: 3 } }).jpeg().toBuffer();
  assert.equal(await makeFrontCrop(a.full, noise), null);
});
