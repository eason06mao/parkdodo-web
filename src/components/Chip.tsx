import type { ChipTone } from "@/lib/types";

export function Chip({ tone = "neutral", dot = false, children }: { tone?: ChipTone; dot?: boolean; children: React.ReactNode }) {
  const cls = tone === "neutral" ? "pd-chip" : `pd-chip pd-chip--${tone}`;
  return (
    <span className={cls}>
      {dot && <span className="pd-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
