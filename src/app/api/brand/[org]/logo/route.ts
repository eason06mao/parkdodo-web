import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { LOGO_MAX_BYTES } from "@/lib/branding";
import { BrandError, getLogo, saveLogo } from "@/lib/brandingServer";

type Ctx = { params: Promise<{ org: string }> };

// GET：Logo 圖片（車主頁面也會用，不需要登入）。網址帶 ?v=雜湊 時可長期快取。
export async function GET(req: Request, { params }: Ctx) {
  const { org } = await params;
  const logo = await getLogo(org).catch(() => null);
  if (!logo) return new NextResponse(null, { status: 404 });
  const v = new URL(req.url).searchParams.get("v");
  return new NextResponse(new Uint8Array(logo.bytes), {
    headers: {
      "content-type": logo.type,
      "cache-control": v && logo.hash.startsWith(v) ? "public, max-age=31536000, immutable" : "public, max-age=300",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}

// POST：上傳 Logo（請求內容就是圖片本身）。只接受 PNG、JPG、WebP，最大 512 KB。
export async function POST(req: Request, { params }: Ctx) {
  const { org } = await params;
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > LOGO_MAX_BYTES) return NextResponse.json({ error: "too_large", message: "圖片太大了，請小於 512 KB。" }, { status: 413 });
  return handle(org, async () => new Uint8Array(await req.arrayBuffer()));
}

// DELETE：移除 Logo，改回文字標誌
export async function DELETE(_req: Request, { params }: Ctx) {
  const { org } = await params;
  return handle(org, async () => null);
}

async function handle(org: string, body: () => Promise<Uint8Array | null>) {
  const user = await getCurrentUser();
  try {
    const bytes = await body();
    if (bytes && bytes.length === 0) return NextResponse.json({ error: "invalid", message: "請選擇圖片。" }, { status: 422 });
    return NextResponse.json({ brand: await saveLogo(user, org, bytes) });
  } catch (e) {
    if (e instanceof BrandError) return NextResponse.json({ error: "invalid", message: e.message }, { status: e.status });
    console.error("[brand logo]", e);
    return NextResponse.json({ error: "server_error", message: "上傳失敗，請再試一次。" }, { status: 500 });
  }
}
