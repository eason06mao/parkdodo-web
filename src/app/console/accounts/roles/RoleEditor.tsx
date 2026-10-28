"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  HQ_ONLY, PERMISSION_GROUPS, PERMISSION_LABELS, SENSITIVE, visiblePermissions, type OrgType, type Permission,
} from "@/lib/permissions";

export type EditorOrg = { id: string; name: string; type: OrgType; typeLabel: string; allowed: Permission[] };

const MFA: Permission[] = ["gate.remote_open", "gate.hold_open", "refund.approve"];

export function RoleEditor(props: {
  orgs: EditorOrg[];
  mode: "new" | "edit";
  code?: string;
  initial?: { orgId: string; name: string; description: string; permissions: Permission[] };
  inUse?: number;
}) {
  const { orgs, mode, code, inUse = 0 } = props;
  const router = useRouter();
  const [orgId, setOrgId] = useState(props.initial?.orgId ?? orgs[0].id);
  const [name, setName] = useState(props.initial?.name ?? "");
  const [description, setDescription] = useState(props.initial?.description ?? "");
  const [perms, setPerms] = useState<Set<Permission>>(new Set(props.initial?.permissions ?? []));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const org = orgs.find((o) => o.id === orgId)!;
  const allowed = useMemo(() => new Set(org.allowed), [org]);
  const initialPerms = useMemo(() => new Set(props.initial?.permissions ?? []), [props.initial]);
  const visible = useMemo(() => new Set(visiblePermissions(org.type)), [org]);

  // 自己有的權限可以勾選；角色原本就有、但自己沒有的權限只能取消，不能再加回來
  const editable = (p: Permission) => allowed.has(p) || (initialPerms.has(p) && perms.has(p));

  const toggle = (p: Permission) => {
    if (!editable(p)) return;
    const next = new Set(perms);
    if (next.has(p)) next.delete(p); else next.add(p);
    setPerms(next); setError("");
  };

  const changeOrg = (id: string) => {
    const nextOrg = orgs.find((o) => o.id === id)!;
    const ok = new Set(nextOrg.allowed);
    setOrgId(id);
    setPerms(new Set([...perms].filter((p) => ok.has(p))));
  };

  const added = [...perms].filter((p) => !initialPerms.has(p));
  const removed = [...initialPerms].filter((p) => !perms.has(p));
  const sensitiveOn = [...perms].filter((p) => SENSITIVE.includes(p));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError("請填寫角色名稱。"); return; }
    if (perms.size === 0) { setError("請至少勾選一項權限。"); return; }
    setBusy(true); setError("");
    const body = JSON.stringify({ orgId, name, description, permissions: [...perms] });
    const res = mode === "new"
      ? await fetch("/api/roles", { method: "POST", headers: { "content-type": "application/json" }, body })
      : await fetch(`/api/roles/${code}`, { method: "PUT", headers: { "content-type": "application/json" }, body });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(data.message ?? "儲存失敗。"); return; }
    router.push("/console/accounts/roles");
    router.refresh();
  };

  const archive = async () => {
    setBusy(true); setError("");
    const res = await fetch(`/api/roles/${code}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(data.message ?? "封存失敗。"); setConfirmArchive(false); return; }
    router.push("/console/accounts/roles");
    router.refresh();
  };

  return (
    <div className="pd-split">
      <form onSubmit={submit} className="pd-card" style={{ flex: "999 1 560px", minWidth: 0, display: "grid", gap: 18 }} noValidate>
        {mode === "new" && orgs.length > 1 ? (
          <div className="pd-field"><label htmlFor="rorg">組織</label>
            <select id="rorg" className="pd-select" value={orgId} onChange={(e) => changeOrg(e.target.value)}>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}（{o.typeLabel}）</option>)}
            </select>
            <span className="pd-label">自訂角色只能指派給這個組織的帳號。</span></div>
        ) : (
          <p className="pd-label" style={{ margin: 0 }}>組織：{org.name}（{org.typeLabel}）</p>
        )}
        <div className="pd-field"><label htmlFor="rname">角色名稱</label>
          <input id="rname" className="pd-input" maxLength={20} value={name} onChange={(e) => { setName(e.target.value); setError(""); }} placeholder="例：夜班值班、會計、站務主管" /></div>
        <div className="pd-field"><label htmlFor="rdesc">說明（選填）</label>
          <input id="rdesc" className="pd-input" maxLength={60} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="這個角色負責什麼" /></div>

        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 14 }}>
          <legend className="pd-serif" style={{ fontSize: 18, marginBottom: 4 }}>開放的功能</legend>
          <p className="pd-label" style={{ margin: 0, lineHeight: 1.8 }}>
            只能勾選你自己有的權限。可以管理哪些站點，在「邀請帳號」指派角色時設定。
          </p>
          {PERMISSION_GROUPS.map((g) => {
            const items = g.permissions.filter((p) => visible.has(p));
            if (!items.length) return null;
            return (
              <div key={g.title}>
                <h3 style={{ fontSize: 15, margin: "4px 0 8px" }}>{g.title}</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 8 }}>
                  {items.map((p) => {
                    const can = editable(p);
                    return (
                      <label key={p} title={can ? undefined : "你自己沒有這項權限，所以不能開放給別人"}
                        style={{ display: "flex", gap: 10, alignItems: "flex-start", minHeight: 44, padding: "10px 12px", border: `1px solid ${perms.has(p) ? "var(--pd-accent)" : "var(--pd-line-soft)"}`, borderRadius: "var(--pd-r-md)", cursor: can ? "pointer" : "not-allowed", opacity: can ? 1 : 0.5, background: perms.has(p) ? "var(--pd-accent-tint)" : undefined }}>
                        <input type="checkbox" checked={perms.has(p)} disabled={!can} onChange={() => toggle(p)} style={{ marginTop: 3, width: 18, height: 18 }} />
                        <span style={{ display: "grid", gap: 2 }}>
                          <span>{PERMISSION_LABELS[p]}</span>
                          <span className="pd-label" style={{ fontSize: 12 }}>
                            {[SENSITIVE.includes(p) && "敏感", MFA.includes(p) && "需要 MFA", HQ_ONLY.includes(p) && "僅總部", !can && "你沒有這項權限"].filter(Boolean).join("・")}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </fieldset>

        {error && <p role="alert" style={{ margin: 0, color: "var(--pd-danger)" }}>{error}</p>}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            {mode === "edit" && (confirmArchive ? (
              <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className="pd-label">封存後不能再指派，紀錄會保留。</span>
                <button type="button" className="pd-btn pd-btn--danger" onClick={archive} disabled={busy}>確定封存</button>
                <button type="button" className="pd-btn" onClick={() => setConfirmArchive(false)}>取消</button>
              </span>
            ) : (
              <button type="button" className="pd-btn" onClick={() => setConfirmArchive(true)} disabled={inUse > 0}
                title={inUse > 0 ? "還有帳號在用，請先改派其他角色" : undefined}>封存角色</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Link href="/console/accounts/roles" className="pd-btn">取消</Link>
            <button type="submit" className="pd-btn pd-btn--primary" disabled={busy}>{busy ? "儲存中…" : mode === "new" ? "建立角色" : "儲存變更"}</button>
          </div>
        </div>
      </form>

      <aside className="pd-card" style={{ flex: "1 1 280px", minWidth: 0, alignSelf: "flex-start" }} aria-live="polite">
        <h2 className="pd-serif" style={{ margin: "0 0 10px", fontSize: 18 }}>摘要</h2>
        <p style={{ margin: 0 }}>已開放 <strong className="pd-mono">{perms.size}</strong> 項功能</p>
        {sensitiveOn.length > 0 && (
          <p className="pd-label" style={{ margin: "8px 0 0", lineHeight: 1.7 }}>
            包含敏感功能：{sensitiveOn.map((p) => PERMISSION_LABELS[p]).join("、")}。操作都會寫入稽核紀錄。
          </p>
        )}
        {mode === "edit" && (
          <>
            <h3 style={{ fontSize: 15, margin: "16px 0 6px" }}>這次的變更</h3>
            {added.length === 0 && removed.length === 0 ? <p className="pd-label" style={{ margin: 0 }}>權限沒有變更。</p> : (
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
                {added.map((p) => <li key={p}>新增：{PERMISSION_LABELS[p]}</li>)}
                {removed.map((p) => <li key={p}>移除：{PERMISSION_LABELS[p]}</li>)}
              </ul>
            )}
            {inUse > 0 && (
              <p style={{ margin: "12px 0 0", padding: "10px 12px", borderRadius: "var(--pd-r-md)", lineHeight: 1.7, background: "var(--pd-warn-tint)", border: "1px solid var(--pd-warn-line)", color: "var(--pd-warn-ink)" }}>
                目前有 <strong>{inUse}</strong> 個帳號使用這個角色，儲存後立即生效。
              </p>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
