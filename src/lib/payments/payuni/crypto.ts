// 統一金流 PAYUNi 加解密。依官方 PHP SDK（github.com/payuni/PHP_SDK v1.2.4，Apache-2.0）的演算法實作：
//   EncryptInfo = hex( base64(AES-256-GCM 密文) + ":::" + base64(tag) )
//     明文 = PHP http_build_query(參數)，金鑰 = HashKey（32 字元），IV = HashIV（16 字元）
//   HashInfo    = 大寫 SHA256( HashKey + EncryptInfo + HashIV )
// 以 SDK 產生的測試向量驗證（tests/payuni/vectors.json），位元組完全一致。
// 只能在伺服器端使用：HashKey／HashIV 不可送到瀏覽器。
import { createCipheriv, createDecipheriv, createHash, timingSafeEqual } from "node:crypto";

export interface PayuniKeys { hashKey: string; hashIV: string }

export type Params = Record<string, string | number | undefined | null>;

/** PHP urlencode：英數與 -_. 不編碼，空白變 +，其餘 %XX（大寫） */
function phpUrlencode(s: string): string {
  return Array.from(Buffer.from(s, "utf8"))
    .map((b) => {
      const c = String.fromCharCode(b);
      if (/[A-Za-z0-9\-_.]/.test(c)) return c;
      if (b === 0x20) return "+";
      return "%" + b.toString(16).toUpperCase().padStart(2, "0");
    })
    .join("");
}

/** 等同 PHP http_build_query（只支援一層、字串與數字；null／undefined 略過） */
export function httpBuildQuery(params: Params): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${phpUrlencode(k)}=${phpUrlencode(String(v))}`)
    .join("&");
}

/** 解密後的資料：一般為字串；交易查詢的 Result 為陣列（PHP parse_str 的巢狀格式） */
export type PayuniValue = string | PayuniValue[] | { [k: string]: PayuniValue };
export type PayuniData = Record<string, PayuniValue>;

/** 等同 PHP parse_str：支援 a[0][b]=x 巢狀鍵；連續數字鍵 0..n-1 轉成陣列（與 PHP json_encode 一致） */
export function parseStr(qs: string): PayuniData {
  const root: Record<string, unknown> = {};
  const dec = (x: string) => decodeURIComponent(x.replace(/\+/g, " "));
  for (const part of qs.split("&")) {
    if (!part) continue;
    const i = part.indexOf("=");
    const rawKey = dec(i < 0 ? part : part.slice(0, i));
    const value = i < 0 ? "" : dec(part.slice(i + 1));
    const m = rawKey.match(/^([^[]+)((?:\[[^\]]*\])*)$/);
    const path = m ? [m[1], ...[...m[2].matchAll(/\[([^\]]*)\]/g)].map((x) => x[1])] : [rawKey];
    let node = root;
    path.forEach((k, idx) => {
      if (k === "__proto__" || k === "constructor" || k === "prototype") return;
      if (idx === path.length - 1) { node[k] = value; return; }
      if (typeof node[k] !== "object" || node[k] === null) node[k] = {};
      node = node[k] as Record<string, unknown>;
    });
  }
  const toArrays = (v: unknown): PayuniValue => {
    if (typeof v !== "object" || v === null) return v as string;
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    const isList = keys.length > 0 && keys.every((k, n) => k === String(n));
    return isList ? keys.map((k) => toArrays(o[k])) : Object.fromEntries(keys.map((k) => [k, toArrays(o[k])]));
  };
  return toArrays(root) as PayuniData;
}

/** 取字串欄位（巢狀值回傳 undefined） */
export const str = (d: PayuniData | undefined, k: string): string | undefined => (typeof d?.[k] === "string" ? (d[k] as string) : undefined);

// PHP openssl 會把不足的金鑰補 \0、過長截斷；IV 原樣使用（GCM 允許任意長度）
const keyBuf = (k: string) => { const b = Buffer.alloc(32); Buffer.from(k.trim(), "utf8").copy(b); return b; };
const ivBuf = (iv: string) => Buffer.from(iv.trim(), "utf8");

export function encrypt(params: Params, keys: PayuniKeys): string {
  const cipher = createCipheriv("aes-256-gcm", keyBuf(keys.hashKey), ivBuf(keys.hashIV));
  const ct = Buffer.concat([cipher.update(httpBuildQuery(params), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.from(`${ct.toString("base64")}:::${tag.toString("base64")}`, "utf8").toString("hex");
}

export function decrypt(encryptInfo: string, keys: PayuniKeys): PayuniData {
  if (!/^[0-9a-fA-F]+$/.test(encryptInfo) || encryptInfo.length % 2) throw new PayuniCryptoError("EncryptInfo 不是 hex 字串");
  const raw = Buffer.from(encryptInfo, "hex").toString("utf8");
  const sep = raw.indexOf(":::");
  if (sep < 0) throw new PayuniCryptoError("EncryptInfo 格式錯誤（缺少 :::）");
  const decipher = createDecipheriv("aes-256-gcm", keyBuf(keys.hashKey), ivBuf(keys.hashIV));
  decipher.setAuthTag(Buffer.from(raw.slice(sep + 3), "base64"));
  try {
    const pt = Buffer.concat([decipher.update(Buffer.from(raw.slice(0, sep), "base64")), decipher.final()]).toString("utf8");
    return parseStr(pt);
  } catch {
    throw new PayuniCryptoError("解密失敗：資料被竄改或金鑰不符");
  }
}

export function hashInfo(encryptInfo: string, keys: PayuniKeys): string {
  return createHash("sha256").update(keys.hashKey + encryptInfo + keys.hashIV, "utf8").digest("hex").toUpperCase();
}

/** 驗證 HashInfo（固定時間比較），通過才解密 */
export function verifyAndDecrypt(body: { EncryptInfo?: string; HashInfo?: string }, keys: PayuniKeys): PayuniData {
  if (!body.EncryptInfo || !body.HashInfo) throw new PayuniCryptoError("缺少 EncryptInfo 或 HashInfo");
  const expected = Buffer.from(hashInfo(body.EncryptInfo, keys));
  const got = Buffer.from(body.HashInfo.toUpperCase());
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) throw new PayuniCryptoError("HashInfo 比對失敗");
  return decrypt(body.EncryptInfo, keys);
}

export class PayuniCryptoError extends Error {}
