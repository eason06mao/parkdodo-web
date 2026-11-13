// 「車牌＋車頭」照片：給繳費頁讓車主認車。
// 相機會給兩張圖：整張（full）與車牌特寫（plate）。用特寫在整張裡找出車牌位置，
// 再以車牌為中心往外裁：看得到保險桿、水箱罩與車頭顏色，但不到擋風玻璃（看不到車內的人）。
// 找不到位置（相似度太低）就回傳 null，由呼叫端改用車牌特寫。
import sharp from "sharp";

export const FRONT_WIDTH = 480;
const MIN_SCORE = 0.6;            // 正規化相關係數門檻
const TARGET_PLATE_W = 32;        // 搜尋時把車牌縮到約 32px 寬，兼顧速度與準確

interface Gray { w: number; h: number; px: Uint8Array }

async function gray(img: Buffer | sharp.Sharp, w: number, h: number): Promise<Gray> {
  const s = Buffer.isBuffer(img) ? sharp(img) : img;
  const { data, info } = await s.resize(w, h, { fit: "fill" }).grayscale().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, px: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}

/** 在 full 裡找 tpl 的位置（正規化互相關，暴力搜尋；兩張圖都很小，約 0.1 秒內） */
export function locate(full: Gray, tpl: Gray): { x: number; y: number; score: number } | null {
  const n = tpl.w * tpl.h;
  if (tpl.w > full.w || tpl.h > full.h || n < 16) return null;
  let tMean = 0;
  for (let i = 0; i < n; i++) tMean += tpl.px[i];
  tMean /= n;
  const t = new Float32Array(n);
  let tVar = 0;
  for (let i = 0; i < n; i++) { t[i] = tpl.px[i] - tMean; tVar += t[i] * t[i]; }
  if (tVar === 0) return null;
  let best = { x: 0, y: 0, score: -1 };
  for (let y = 0; y + tpl.h <= full.h; y++) {
    for (let x = 0; x + tpl.w <= full.w; x++) {
      let sum = 0, sum2 = 0, cross = 0, k = 0;
      for (let ty = 0; ty < tpl.h; ty++) {
        const row = (y + ty) * full.w + x;
        for (let tx = 0; tx < tpl.w; tx++, k++) {
          const v = full.px[row + tx];
          sum += v; sum2 += v * v; cross += v * t[k];
        }
      }
      const fVar = sum2 - (sum * sum) / n;
      if (fVar <= 0) continue;
      const score = cross / Math.sqrt(fVar * tVar);
      if (score > best.score) best = { x, y, score };
    }
  }
  return best.score >= 0 ? best : null;
}

/** 回傳裁好的 JPEG；找不到車牌位置時回傳 null */
export async function makeFrontCrop(fullJpeg: Buffer, plateJpeg: Buffer): Promise<Buffer | null> {
  const [fm, pm] = await Promise.all([sharp(fullJpeg).metadata(), sharp(plateJpeg).metadata()]);
  if (!fm.width || !fm.height || !pm.width || !pm.height || pm.width >= fm.width) return null;
  const scale = Math.min(1, Math.max(320 / fm.width, Math.min(960 / fm.width, TARGET_PLATE_W / pm.width)));
  const fw = Math.round(fm.width * scale), fh = Math.round(fm.height * scale);
  const pw = Math.max(4, Math.round(pm.width * scale)), ph = Math.max(4, Math.round(pm.height * scale));
  const [full, tpl] = await Promise.all([gray(fullJpeg, fw, fh), gray(plateJpeg, pw, ph)]);
  const hit = locate(full, tpl);
  if (!hit || hit.score < MIN_SCORE) return null;

  // 換回原圖座標，往外擴：寬 3.2 倍車牌、高 4.2 倍（上方多留給水箱罩／車頭）
  const px = hit.x / scale, py = hit.y / scale, pW = pm.width, pH = pm.height;
  const cx = px + pW / 2;
  const cw = Math.min(fm.width, Math.round(pW * 3.2));
  const ch = Math.min(fm.height, Math.round(pH * 4.2));
  const left = Math.round(Math.min(Math.max(0, cx - cw / 2), fm.width - cw));
  const top = Math.round(Math.min(Math.max(0, py + pH * 0.5 - ch * 0.62), fm.height - ch));
  return sharp(fullJpeg).extract({ left, top, width: cw, height: ch }).resize({ width: FRONT_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 72, mozjpeg: true }).toBuffer();
}
