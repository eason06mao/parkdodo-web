"use client";

import { useEffect, useState } from "react";
import { isTaxId } from "./invoice";

export type TaxNameState = { status: "idle" | "loading" | "not_found" | "error" } | { status: "found"; name: string };

/** 統編輸入滿 8 碼且檢查碼正確時，查詢營業人名稱（稍等 250ms 再查，避免每打一個字就查） */
export function useTaxName(taxId: string): TaxNameState {
  const [state, setState] = useState<TaxNameState>({ status: "idle" });
  useEffect(() => {
    if (!isTaxId(taxId)) { setState({ status: "idle" }); return; }
    let alive = true;
    setState({ status: "loading" });
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/tax-id/${taxId}`);
        const b = await r.json();
        if (!alive) return;
        setState(b.status === "found" ? { status: "found", name: b.name } : b.status === "not_found" ? { status: "not_found" } : { status: "error" });
      } catch { if (alive) setState({ status: "error" }); }
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [taxId]);
  return state;
}
