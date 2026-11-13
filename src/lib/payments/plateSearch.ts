// 繳費頁的車牌搜尋規則（純函式，前後端與測試共用）
//   - 不分大小寫、可省略「-」與空白
//   - 只輸入 3～4 位數字：找車牌含這串數字的車（例：2234 → ES-2234、2234-AB）
//   - 輸入完整車牌但找不到：容許辨識常見混淆（8↔B、0↔D/O/Q、1↔I/L、5↔S、2↔Z、6↔G）及差一個字
//   - 候選車給車主看時遮住部分英文字（A**-2234），避免輸入數字就能看到別人的完整車牌

export const MAX_CANDIDATES = 5;

export const normalizeQuery = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

const CONFUSE: Record<string, string> = { O: "0", D: "0", Q: "0", I: "1", L: "1", B: "8", S: "5", Z: "2", G: "6" };
/** 把容易看錯的字元換成同一個代表字 */
export const canon = (p: string) => [...p].map((c) => CONFUSE[c] ?? c).join("");

/** 編輯距離是否 ≤ 1（替換、少一字、多一字） */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export type SearchMode = "exact" | "digits" | "fuzzy";
export interface PlateMatch { mode: SearchMode; plates: string[] }

/**
 * plates：這個場站目前在場的車牌（已正規化，例 ES2234）。
 * 回傳 exact＝完全吻合（只會有一台）；digits／fuzzy＝要讓車主從候選中選。
 * 輸入太短回傳 null。
 */
export function matchPlates(input: string, plates: string[]): PlateMatch | null {
  const q = normalizeQuery(input);
  if (q.length < 3) return null;
  if (plates.includes(q)) return { mode: "exact", plates: [q] };
  if (/^\d{3,4}$/.test(q)) return { mode: "digits", plates: plates.filter((p) => p.includes(q)).sort() };
  if (q.length < 5) return { mode: "fuzzy", plates: [] };
  const cq = canon(q);
  const scored = plates
    .map((p) => {
      const cp = canon(p);
      const score = cp === cq ? 0 : withinOneEdit(cp, cq) ? 1 : -1;
      return { p, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score || a.p.localeCompare(b.p));
  return { mode: "fuzzy", plates: scored.map((x) => x.p) };
}

/** 顯示用：英數之間補「-」（ES2234 → ES-2234） */
export function displayPlate(p: string): string {
  const m = /^([A-Z]+)(\d+)$/.exec(p) ?? /^(\d+)([A-Z]+)$/.exec(p);
  return m ? `${m[1]}-${m[2]}` : p;
}

/** 候選清單用：每段英文字只露第一個字，數字保留（ABC-1234 → A**-1234、1234-AB → 1234-A*） */
export function maskPlate(p: string): string {
  return displayPlate(p).replace(/[A-Z]+/g, (s) => s[0] + "*".repeat(s.length - 1));
}
