#!/usr/bin/env bash
# 把統一金流（PAYUNi）商店金鑰存進 Google Secret Manager，並讓 Cloud Run 讀得到。
# 在 Google Cloud Shell 執行：
#   bash scripts/gcp-payuni-secrets.sh <專案ID>            # 兩站共用一個商店
#   bash scripts/gcp-payuni-secrets.sh <專案ID> TXG002     # 某一站用自己的商店
# 金鑰用鍵盤輸入（畫面不顯示），不會寫進檔案、不會出現在指令紀錄。請勿貼到聊天或 GitHub。
set -euo pipefail

PROJECT_ID="${1:?請提供專案 ID，例如 parkdodo-staging}"
SITE="${2:-}"
SITE=$(echo "$SITE" | tr -cd 'A-Za-z0-9' | tr A-Z a-z)
SUFFIX=""; [ -n "$SITE" ] && SUFFIX="-$SITE"
RUN_SA="parkdodo-run@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud config set project "$PROJECT_ID" >/dev/null
gcloud services enable secretmanager.googleapis.com >/dev/null

echo "統一金流商店設定${SITE:+（站點 ${SITE^^}）}。輸入時畫面不會顯示文字。"
read -rp  "商店代號 MerID：" MER_ID
read -rsp "Hash Key（32 個字元）：" HASH_KEY; echo
read -rsp "Hash IV（16 個字元）：" HASH_IV; echo
MER_ID=$(echo -n "$MER_ID" | tr -d '[:space:]'); HASH_KEY=$(echo -n "$HASH_KEY" | tr -d '[:space:]'); HASH_IV=$(echo -n "$HASH_IV" | tr -d '[:space:]')
[ -n "$MER_ID" ] || { echo "商店代號不能空白"; exit 1; }
[ ${#HASH_KEY} -eq 32 ] || { echo "Hash Key 應為 32 個字元（目前 ${#HASH_KEY}）"; exit 1; }
[ ${#HASH_IV} -eq 16 ] || { echo "Hash IV 應為 16 個字元（目前 ${#HASH_IV}）"; exit 1; }

put() {
  local name="$1" value="$2"
  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- >/dev/null
  else
    printf '%s' "$value" | gcloud secrets create "$name" --replication-policy=automatic --data-file=- >/dev/null
  fi
  gcloud secrets add-iam-policy-binding "$name" --member "serviceAccount:$RUN_SA" --role roles/secretmanager.secretAccessor --quiet >/dev/null
  echo "  ✓ $name"
}
put "payuni-mer-id$SUFFIX" "$MER_ID"
put "payuni-hash-key$SUFFIX" "$HASH_KEY"
put "payuni-hash-iv$SUFFIX" "$HASH_IV"
unset HASH_KEY HASH_IV

echo
echo "完成。接著到 GitHub → Settings → Secrets and variables → Actions → Variables："
if [ -n "$SITE" ]; then
  echo "  PAYUNI_SITES 加上 ${SITE^^}（多站用空白分隔）"
else
  echo "  新增 PAYUNI_SECRETS，值為 on"
fi
echo "測試區金鑰維持 PAYUNI_ENV 不設定（預設 sandbox）；正式上線時再設 PAYUNI_ENV=production。"
echo "設定好後重新部署（Actions → CI → Run workflow，或合併下一個 PR）。"
