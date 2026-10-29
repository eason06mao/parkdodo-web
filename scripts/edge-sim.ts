// 工控機模擬器：不用實體設備，模擬一台 Edge 對雲端做完整流程。
//   npx tsx scripts/edge-sim.ts pair <配對碼> [--url https://測試站網址]   配對並把金鑰存到 .edge-sim.json（不要提交到 Git）
//   npx tsx scripts/edge-sim.ts run [--plate ABC-1234] [--minutes 45]       入場 → 出場報價 → 遠端開閘測試
//   npx tsx scripts/edge-sim.ts listen                                       持續心跳並執行後台送來的遠端開閘
// 用到的 API 與實體 Edge 程式完全相同（/api/edge/v1/*）。
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const STATE = ".edge-sim.json";
const args = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const state: { url: string; key?: string; site?: string } = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { url: "http://localhost:3000" };
if (flag("url")) state.url = flag("url")!.replace(/\/$/, "");

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${state.url}/api/edge/v1${path}`, {
    method, headers: { "content-type": "application/json", ...(state.key ? { authorization: `Bearer ${state.key}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${j.message ?? ""}`);
  return j as T;
}

const at = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
const uid = () => `${state.site ?? "SIM"}-${randomUUID()}`;
type Result = { status: string; sessionId?: string; decision?: { action: string; reason: string; amount?: number }; error?: string };

async function events(list: Record<string, unknown>[]) {
  return (await api<{ results: Result[] }>("POST", "/events", { events: list })).results;
}

async function main() {
  const cmd = args[0];
  if (cmd === "pair") {
    const code = args[1];
    if (!code) throw new Error("請提供配對碼");
    const r = await api<{ deviceKey: string; gatewayId: string; site: { code: string; name: string } }>("POST", "/pair",
      { code, hardware: { model: "Edge 模擬器", agentVersion: "sim-0.1.0", osVersion: process.platform } });
    state.key = r.deviceKey; state.site = r.site.code;
    writeFileSync(STATE, JSON.stringify(state, null, 2), { mode: 0o600 });
    console.log(`✅ 已配對 ${r.site.name}（${r.site.code}），工控機編號 ${r.gatewayId}。金鑰存在 ${STATE}`);
    return;
  }
  if (!state.key) throw new Error("尚未配對，請先執行 pair <配對碼>");

  const hb = await api<{ configVersion: number; pendingCommands: number }>("POST", "/heartbeat", { agentVersion: "sim-0.1.0", queueDepth: 0 });
  const cfg = await api<{ site: { name: string }; lanes: { code: string; direction: string }[]; rates: { base: { unitPrice: number } } | null }>("GET", "/config");
  console.log(`心跳 OK・設定版本 ${hb.configVersion}・${cfg.site.name}・車道 ${cfg.lanes.map((l) => l.code).join("、")}・每單位 ${cfg.rates?.base.unitPrice ?? "?"} 元`);
  const entryLane = cfg.lanes.find((l) => l.direction === "entry")!.code;
  const exitLane = cfg.lanes.find((l) => l.direction === "exit")!.code;

  if (cmd === "run") {
    const plate = flag("plate", `SIM-${String(Date.now()).slice(-4)}`)!;
    const minutes = Number(flag("minutes", "45"));
    const [inn] = await events([{ uid: uid(), type: "plate_read", laneCode: entryLane, occurredAt: at(minutes), plate, confidence: 0.97 }]);
    console.log(`入場 ${plate}（${minutes} 分鐘前）→ ${inn.status}・${JSON.stringify(inn.decision)}`);
    await events([{ uid: uid(), type: "vehicle_passed", laneCode: entryLane, occurredAt: at(minutes - 0.1), plate }]);
    const [out] = await events([{ uid: uid(), type: "plate_read", laneCode: exitLane, occurredAt: at(0), plate, confidence: 0.95 }]);
    console.log(`出口辨識 → ${JSON.stringify(out.decision)}`);
    if (out.decision?.action === "open") {
      await events([{ uid: uid(), type: "gate_opened", laneCode: exitLane, occurredAt: at(0), plate }, { uid: uid(), type: "vehicle_passed", laneCode: exitLane, occurredAt: at(0), plate, sessionId: out.sessionId }]);
      console.log("已開閘、車輛通過，紀錄結案。");
    } else {
      console.log("需要付款：請到繳費頁付款，或在後台對這個出口按「遠端開閘」，再執行 listen 看工控機執行。");
    }
    return;
  }

  if (cmd === "listen") {
    console.log("等待後台遠端開閘指令…（Ctrl+C 結束）");
    for (;;) {
      await api("POST", "/heartbeat", { agentVersion: "sim-0.1.0", queueDepth: 0 });
      const { commands } = await api<{ commands: { id: string; command: string; laneCode: string }[] }>("GET", "/commands?wait=15");
      for (const c of commands) {
        console.log(`收到 ${c.command}・${c.laneCode} → 模擬開閘`);
        await events([{ uid: uid(), type: "gate_opened", laneCode: c.laneCode, occurredAt: new Date().toISOString(), payload: { commandId: c.id, by: "remote" } }]);
        await api("POST", `/commands/${c.id}`, { ok: true, detail: "模擬器：相機繼電器 IO1" });
      }
    }
  }
  throw new Error("用法：pair <配對碼> | run | listen");
}

main().catch((e) => { console.error("❌", (e as Error).message); process.exit(1); });
