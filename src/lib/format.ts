const TZ = "Asia/Taipei";

export function formatMoney(n: number): string {
  return n.toLocaleString("zh-TW");
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("zh-TW", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("zh-TW", { timeZone: TZ, month: "2-digit", day: "2-digit" }).format(d);
  const time = new Intl.DateTimeFormat("zh-TW", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${date} ${time}`;
}

export function formatDuration(fromIso: string, toIso: string): string {
  const mins = Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h} 時 ${m} 分` : `${m} 分`;
}

export function formatMinutes(mins: number): string {
  return `${Math.floor(mins / 60)} 時 ${mins % 60} 分`;
}

export function signedPct(n: number): string {
  return `${n >= 0 ? "▲" : "▼"} ${Math.abs(n)}%`;
}
