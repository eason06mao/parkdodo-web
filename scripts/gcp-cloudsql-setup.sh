#!/usr/bin/env bash
# ParkDodo 測試站：建立雲端資料庫（Cloud SQL for PostgreSQL 16）與車牌照片儲存空間。
# 請在 Google Cloud Shell 執行（重複執行也安全）：
#   bash scripts/gcp-cloudsql-setup.sh <專案ID>
# 會做的事：
#   1. 開啟 Cloud SQL Admin API
#   2. 建立資料庫主機 parkdodo-staging-db（台灣 asia-east1、最小規格 db-f1-micro、10GB、每日自動備份保留 7 天）
#      沒有開放任何外部 IP 連入；只有 Cloud Run 與 GitHub 部署（透過 Cloud SQL 連線器，需 IAM 權限）連得到
#   3. 建立資料庫 parkdodo 與帳號 parkdodo_app，密碼隨機產生、直接存進 Secret Manager，不會顯示在畫面上
#   4. 建立車牌照片儲存空間（90 天後自動刪除）
#   5. 給 parkdodo-run（網站）與 github-deployer（部署、更新資料表）需要的最小權限
# 費用（2026 年參考）：資料庫約每月 US$9–11，照片儲存每月幾分錢。最後印出兩個要填到 GitHub Variables 的值。
set -euo pipefail

PROJECT_ID="${1:?用法：bash scripts/gcp-cloudsql-setup.sh <專案ID>}"
REGION="asia-east1"
INSTANCE="parkdodo-staging-db"
DB="parkdodo"
DB_USER="parkdodo_app"
BUCKET="${PROJECT_ID}-edge-images"
RUN_SA="parkdodo-run@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_SA="github-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
CONN="${PROJECT_ID}:${REGION}:${INSTANCE}"

gcloud config set project "$PROJECT_ID" >/dev/null

echo "▶ 開啟 Cloud SQL Admin API"
gcloud services enable sqladmin.googleapis.com storage.googleapis.com

echo "▶ 資料庫主機（第一次建立約 5–10 分鐘，請耐心等候）"
if gcloud sql instances describe "$INSTANCE" >/dev/null 2>&1; then
  echo "  已存在，略過"
else
  gcloud sql instances create "$INSTANCE" \
    --database-version POSTGRES_16 --edition ENTERPRISE --tier db-f1-micro \
    --region "$REGION" --storage-type SSD --storage-size 10 --storage-auto-increase \
    --backup --backup-start-time 19:00 --retained-backups-count 7 \
    --maintenance-window-day SUN --maintenance-window-hour 20 \
    --database-flags cloudsql.iam_authentication=on
fi
# 不開放任何外部網段直接連線（只能透過 Cloud SQL 連線器）
gcloud sql instances patch "$INSTANCE" --clear-authorized-networks --quiet >/dev/null

echo "▶ 資料庫與帳號"
gcloud sql databases describe "$DB" --instance "$INSTANCE" >/dev/null 2>&1 || gcloud sql databases create "$DB" --instance "$INSTANCE"
if gcloud secrets describe staging-database-url >/dev/null 2>&1; then
  echo "  連線設定已存在，略過（要更換密碼請先刪除 staging-database-url 與 staging-database-migrate-url 兩個 Secret）"
else
  PASS="$(openssl rand -base64 36 | tr -dc 'A-Za-z0-9' | head -c 32)"
  if gcloud sql users list --instance "$INSTANCE" --format='value(name)' | grep -qx "$DB_USER"; then
    gcloud sql users set-password "$DB_USER" --instance "$INSTANCE" --password "$PASS" >/dev/null
  else
    gcloud sql users create "$DB_USER" --instance "$INSTANCE" --password "$PASS" >/dev/null
  fi
  printf 'postgresql://%s:%s@/%s?host=/cloudsql/%s' "$DB_USER" "$PASS" "$DB" "$CONN" \
    | gcloud secrets create staging-database-url --data-file=- --replication-policy automatic >/dev/null
  printf 'postgresql://%s:%s@127.0.0.1:5432/%s' "$DB_USER" "$PASS" "$DB" \
    | gcloud secrets create staging-database-migrate-url --data-file=- --replication-policy automatic >/dev/null
  unset PASS
  echo "  已建立帳號 ${DB_USER}，密碼只存在 Secret Manager"
fi

echo "▶ 車牌照片儲存空間"
if ! gcloud storage buckets describe "gs://${BUCKET}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${BUCKET}" --location "$REGION" --uniform-bucket-level-access --public-access-prevention
fi
cat > /tmp/pd-lifecycle.json <<'JSON'
{"rule":[{"action":{"type":"Delete"},"condition":{"age":90}}]}
JSON
gcloud storage buckets update "gs://${BUCKET}" --lifecycle-file /tmp/pd-lifecycle.json >/dev/null
rm -f /tmp/pd-lifecycle.json

echo "▶ 權限"
for sa in "$RUN_SA" "$DEPLOY_SA"; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$sa" --role roles/cloudsql.client --condition None --quiet >/dev/null
done
gcloud secrets add-iam-policy-binding staging-database-url --member "serviceAccount:$RUN_SA" --role roles/secretmanager.secretAccessor --quiet >/dev/null
gcloud secrets add-iam-policy-binding staging-database-migrate-url --member "serviceAccount:$DEPLOY_SA" --role roles/secretmanager.secretAccessor --quiet >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" --member "serviceAccount:$RUN_SA" --role roles/storage.objectCreator >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" --member "serviceAccount:$RUN_SA" --role roles/storage.objectViewer >/dev/null

cat <<EOF

✅ 雲端資料庫設定完成。請到 GitHub → parkdodo-web → Settings → Secrets and variables → Actions → Variables，新增兩個變數：

  CLOUDSQL_INSTANCE  = ${CONN}
  EDGE_IMAGE_BUCKET  = ${BUCKET}

這兩個值不是密碼。新增後到 Actions 按「Run workflow」重新部署一次，測試站就會接上資料庫並自動建立資料表。
EOF
