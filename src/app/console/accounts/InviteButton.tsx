"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export interface InviteOrg {
  id: string;
  name: string;
  typeLabel: string;
  roles: { code: string; name: string; description: string }[];
  sites: { id: string; name: string }[];
  allowAllSites: boolean;
}

/** 邀請帳號：只列出登入者「可以指派」的組織、角色與站點；後端 API 與資料庫會再檢查一次。 */
export function InviteButton({ orgs }: { orgs: InviteOrg[] }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [orgId, setOrgId] = useState(orgs[0].id);
  const org = orgs.find((o) => o.id === orgId)!;
  const [role, setRole] = useState(org.roles[0]?.code ?? "");
  const [siteId, setSiteId] = useState(org.allowAllSites ? "" : org.sites[0]?.id ?? "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  const pickOrg = (id: string) => {
    const o = orgs.find((x) => x.id === id)!;
    setOrgId(id); setRole(o.roles[0]?.code ?? ""); setSiteId(o.allowAllSites ? "" : o.sites[0]?.id ?? "");
  };
  const open = () => { setError(""); setDone(""); ref.current?.showModal(); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    const res = await fetch("/api/accounts", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, orgId, role, siteId: siteId || undefined }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(body.message ?? "邀請失敗，請稍後再試。"); return; }
    setDone(email); setName(""); setEmail("");
    router.refresh();
  };

  const selectedRole = org.roles.find((r) => r.code === role);

  return (
    <>
      <button type="button" className="pd-btn pd-btn--primary" onClick={open}>邀請帳號</button>
      <dialog ref={ref} className="pd-dialog" aria-labelledby="invite-h" style={{ width: "min(520px, calc(100vw - 32px))" }}>
        {done ? (
          <div aria-live="polite">
            <h2 id="invite-h" className="pd-serif" style={{ margin: 0, fontSize: 20 }}>已送出邀請</h2>
            <p style={{ margin: "10px 0 20px", lineHeight: 1.8, color: "var(--pd-muted)" }}>
              <span className="pd-mono">{done}</span> 會收到邀請信，第一次登入時設定密碼與 MFA。（Mock：不會真的寄信）
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" className="pd-btn" onClick={() => setDone("")}>再邀請一位</button>
              <button type="button" className="pd-btn pd-btn--primary" onClick={() => ref.current?.close()}>完成</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
            <h2 id="invite-h" className="pd-serif" style={{ margin: 0, fontSize: 20 }}>邀請帳號</h2>
            <div className="pd-field"><label htmlFor="inv-name">姓名</label>
              <input id="inv-name" className="pd-input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="off" /></div>
            <div className="pd-field"><label htmlFor="inv-email">Email</label>
              <input id="inv-email" type="email" className="pd-input" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" /></div>
            {orgs.length > 1 && (
              <div className="pd-field"><label htmlFor="inv-org">組織</label>
                <select id="inv-org" className="pd-select" value={orgId} onChange={(e) => pickOrg(e.target.value)}>
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}（{o.typeLabel}）</option>)}
                </select></div>
            )}
            <div className="pd-field"><label htmlFor="inv-role">角色</label>
              <select id="inv-role" className="pd-select" value={role} onChange={(e) => setRole(e.target.value)}>
                {org.roles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
              </select>
              {selectedRole && <span className="pd-label">{selectedRole.description}</span>}</div>
            <div className="pd-field"><label htmlFor="inv-site">站點範圍</label>
              <select id="inv-site" className="pd-select" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                {org.allowAllSites && <option value="">全部站點（含日後新增）</option>}
                {org.sites.map((s) => <option key={s.id} value={s.id}>只限 {s.name}</option>)}
              </select>
              {!org.allowAllSites && <span className="pd-label">你只負責特定站點，因此只能為這些站點建立帳號。</span>}</div>
            {error && <p role="alert" style={{ margin: 0, color: "var(--pd-danger)" }}>{error}</p>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" className="pd-btn" onClick={() => ref.current?.close()}>取消</button>
              <button type="submit" className="pd-btn pd-btn--primary" disabled={busy || !role}>{busy ? "送出中…" : "送出邀請"}</button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
