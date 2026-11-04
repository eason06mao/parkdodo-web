import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { normalizeColor } from "@/lib/branding";
import { BrandError, saveBrand } from "@/lib/brandingServer";

// PUT { displayName, subtitle, accentColor }：修改組織品牌（需要該組織的 brand.manage）
export async function PUT(req: Request, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const user = await getCurrentUser();
  const b = (await req.json().catch(() => null)) as { displayName?: unknown; subtitle?: unknown; accentColor?: unknown } | null;
  if (!b || typeof b.displayName !== "string") return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  try {
    const brand = await saveBrand(user, org, {
      displayName: b.displayName, subtitle: typeof b.subtitle === "string" ? b.subtitle : "",
      accentColor: normalizeColor(typeof b.accentColor === "string" ? b.accentColor : null),
    });
    return NextResponse.json({ brand });
  } catch (e) {
    if (e instanceof BrandError) return NextResponse.json({ error: "invalid", message: e.message, errors: e.errors }, { status: e.status });
    console.error("[brand save]", e);
    return NextResponse.json({ error: "server_error", message: "儲存失敗，請再試一次。" }, { status: 500 });
  }
}
