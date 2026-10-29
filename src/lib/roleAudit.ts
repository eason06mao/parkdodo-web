import { PERMISSION_LABELS, type Permission } from "./permissions";

/** 稽核紀錄用的權限差異文字 */
export function permissionDiff(before: Permission[], after: Permission[]): string {
  const b = new Set(before), a = new Set(after);
  const added = after.filter((p) => !b.has(p)).map((p) => PERMISSION_LABELS[p]);
  const removed = before.filter((p) => !a.has(p)).map((p) => PERMISSION_LABELS[p]);
  const parts = [];
  if (added.length) parts.push(`新增 ${added.join("、")}`);
  if (removed.length) parts.push(`移除 ${removed.join("、")}`);
  return parts.join("；") || "權限未變更";
}
