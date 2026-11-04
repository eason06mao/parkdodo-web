import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { oauthMode, type OAuthProvider } from "@/lib/memberOAuth";
import { MockLogin } from "./MockLogin";

export const metadata: Metadata = { title: "模擬登入", robots: { index: false } };
export const dynamic = "force-dynamic";

// 還沒申請 LINE／Google 金鑰前，測試站用這頁模擬第三方登入。正式站不會出現。
export default async function MockLoginPage({ searchParams }: { searchParams: Promise<{ p?: string; state?: string }> }) {
  const { p, state } = await searchParams;
  if ((p !== "line" && p !== "google") || !state || oauthMode(p as OAuthProvider) !== "mock") notFound();
  return <MockLogin provider={p} state={state} />;
}
