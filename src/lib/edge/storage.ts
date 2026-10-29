// 車牌照片存放：Cloud Run 上存到 Cloud Storage（EDGE_IMAGE_BUCKET），用執行身分的權杖，不需要金鑰檔。
// 本機開發沒有設定 bucket 時，存到暫存資料夾。
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function metadataToken(): Promise<string> {
  const r = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
    headers: { "Metadata-Flavor": "Google" },
  });
  if (!r.ok) throw new Error(`無法取得雲端儲存權杖（${r.status}）`);
  return ((await r.json()) as { access_token: string }).access_token;
}

export async function saveImage(objectName: string, data: Buffer): Promise<string> {
  const bucket = process.env.EDGE_IMAGE_BUCKET;
  if (!bucket) {
    const dir = join(tmpdir(), "parkdodo-images");
    const path = join(dir, objectName.replace(/[^\w.-]/g, "_"));
    await mkdir(dir, { recursive: true });
    await writeFile(path, data);
    return `local:${path}`;
  }
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}&ifGenerationMatch=0`;
  const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${await metadataToken()}`, "Content-Type": "image/jpeg" }, body: new Uint8Array(data) });
  if (!r.ok && r.status !== 412) throw new Error(`照片上傳失敗（${r.status}）`);   // 412＝已存在（重送），視為成功
  return `gs://${bucket}/${objectName}`;
}
