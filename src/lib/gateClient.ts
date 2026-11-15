// 瀏覽器端：送出遠端開閘指令，並每秒查詢工控機執行結果（後台與手機版共用）。
import type { GateReason } from "./types";

export type GateOutcome =
  | { kind: "executed" }
  | { kind: "failed"; detail: string }
  | { kind: "expired" }
  | { kind: "mock" };

export interface GateRequest { siteId: string; laneCode: string; plate?: string; reasonCode: GateReason; reasonNote: string }

/** 送出指令；失敗時丟出帶中文訊息的 Error。成功回傳指令 id 與到期時間（mock 時 id 為 null）。 */
export async function sendGateCommand(r: GateRequest): Promise<{ id: string | null; expiresAt: number }> {
  const res = await fetch("/api/gate-commands", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...r, idempotencyKey: crypto.randomUUID() }),
  }).catch(() => null);
  const body = await res?.json().catch(() => ({}));
  if (!res?.ok) throw new Error(body?.message ?? (res ? "送出失敗，請再試一次。" : "網路連不上，請確認手機網路後再試一次。"));
  return { id: body.mock ? null : body.id, expiresAt: Date.parse(body.expiresAt) };
}

/** 等到工控機回報結果或指令過期。回傳停止輪詢的函式。 */
export function watchGateCommand(id: string, expiresAt: number, done: (o: GateOutcome) => void): () => void {
  const until = expiresAt + 3000;
  let stopped = false;
  const timer = setInterval(async () => {
    const r = await fetch(`/api/gate-commands/${id}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
    if (stopped) return;
    const st = r?.status as string | undefined;
    if (st === "executed") finish({ kind: "executed" });
    else if (st === "failed") finish({ kind: "failed", detail: r?.result?.detail ?? "" });
    else if (st === "expired" || Date.now() > until) finish({ kind: "expired" });
  }, 1000);
  function finish(o: GateOutcome) { stop(); done(o); }
  function stop() { stopped = true; clearInterval(timer); }
  return stop;
}
