#!/usr/bin/env bash
# ParkDodo 正式站：Google Cloud 一次性建置（獨立專案，和測試站完全分開）。在 Google Cloud Shell 執行：
#   bash scripts/gcp-prod-setup.sh <正式站專案ID> [測試站專案ID]
#   例：bash scripts/gcp-prod-setup.sh parkdodo-prod-tw parkdodo-staging
# 專案 ID 全球唯一，只能用小寫英文、數字、連字號（6–30 字）；被用走了就換一個，例如 parkdodo-prod-2026。
#
# 會做的事（重複執行也安全）：
#   1. 建立專案，帳單沿用測試站的帳單帳戶
#   2. 開啟 Cloud Run、映像檔倉庫、Secret Manager、Cloud SQL、Cloud Storage、Cloud Scheduler
#   3. 服務帳號：github-deployer（GitHub 部署）、parkdodo-run（網站執行）
#   4. Workload Identity：只允許 eason06mao/parkdodo-web 的 main、而且是 GitHub「production」環境的工作部署
#   5. 資料庫 parkdodo-prod-db：PostgreSQL 16、高可用（主機故障自動切換）、每日備份保留 30 天、可回復到任一時間點、防誤刪
#   6. 車牌照片儲存空間（90 天後自動刪除）
#   7. 後台門禁帳密（admin-gate）：正式帳號登入完成前，保護後台；繳費頁不受影響
# 費用（2026 年參考，以 Google 帳單為準）：資料庫高可用約每月 US$100–120、網站常駐 1 台約 US$15–25、其他幾美元。
set -euo pipefail

PROJECT_ID="${1:?用法：bash scripts/gcp-prod-setup.sh <正式站專案ID> [測試站專案ID]}"
STAGING_ID="${2:-parkdodo-staging}"
REPO="eason06mao/parkdodo-web"
REGION="asia-east1"
POOL="github"
INSTANCE="parkdodo-prod-db"
DB="parkdodo"
DB_USER="parkdodo_app"
BUCKET="${PROJECT_ID}-edge-images"
DEPLOY_SA="github-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
RUN_SA="parkdodo-run@${PROJECT_ID}.iam.gserviceaccount.com"
CONN="${PROJECT_ID}:${REGION}:${INSTANCE}"

echo "▶ 專案 ${PROJECT_ID}"
if ! gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud projects create "$PROJECT_ID" --name "ParkDodo 正式站" || { echo "建立失敗：專案 ID 可能已被使用，請換一個再執行"; exit 1; }
fi
BILLING="$(gcloud billing projects describe "$STAGING_ID" --format='value(billingAccountName)')"
[ -n "$BILLING" ] || { echo "找不到測試站 ${STAGING_ID} 的帳單帳戶"; exit 1; }
gcloud billing projects link "$PROJECT_ID" --billing-account "${BILLING#billingAccounts/}" >/dev/null
echo "  ✓ 帳單：${BILLING#billingAccounts/}"
gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

echo "▶ 開啟需要的服務（第一次約 2–3 分鐘）"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com sqladmin.googleapis.com storage.googleapis.com cloudscheduler.googleapis.com

echo "▶ 映像檔倉庫"
gcloud artifacts repositories describe parkdodo --location "$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create parkdodo --repository-format docker --location "$REGION" --description "ParkDodo 正式站映像檔"

echo "▶ 服務帳號與權限"
gcloud iam service-accounts describe "$DEPLOY_SA" >/dev/null 2>&1 || gcloud iam service-accounts create github-deployer --display-name "GitHub 部署正式站"
gcloud iam service-accounts describe "$RUN_SA" >/dev/null 2>&1 || gcloud iam service-accounts create parkdodo-run --display-name "ParkDodo 正式站執行"
for role in roles/run.admin roles/artifactregistry.writer roles/cloudsql.client; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$DEPLOY_SA" --role "$role" --condition None --quiet >/dev/null
done
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$RUN_SA" --role roles/cloudsql.client --condition None --quiet >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$RUN_SA" --member "serviceAccount:$DEPLOY_SA" --role roles/iam.serviceAccountUser --quiet >/dev/null

echo "▶ Workload Identity（只允許 ${REPO} 的 main＋production 環境）"
gcloud iam workload-identity-pools describe "$POOL" --location global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create "$POOL" --location global --display-name "GitHub Actions"
gcloud iam workload-identity-pools providers describe "$POOL" --location global --workload-identity-pool "$POOL" >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc "$POOL" --location global --workload-identity-pool "$POOL" \
    --issuer-uri "https://token.actions.githubusercontent.com" \
    --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.environment=assertion.environment" \
    --attribute-condition "assertion.repository=='${REPO}' && assertion.ref=='refs/heads/main' && assertion.environment=='production'"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${REPO}" \
  --quiet >/dev/null

echo "▶ 資料庫主機（第一次建立約 10–15 分鐘，請耐心等候）"
if gcloud sql instances describe "$INSTANCE" >/dev/null 2>&1; then
  echo "  已存在，略過"
else
  gcloud sql instances create "$INSTANCE" \
    --database-version POSTGRES_16 --edition ENTERPRISE --tier db-custom-1-3840 --availability-type REGIONAL \
    --region "$REGION" --storage-type SSD --storage-size 20 --storage-auto-increase \
    --backup --backup-start-time 19:00 --retained-backups-count 30 --enable-point-in-time-recovery \
    --maintenance-window-day TUE --maintenance-window-hour 19 \
    --database-flags cloudsql.iam_authentication=on --deletion-protection
fi
gcloud sql instances patch "$INSTANCE" --clear-authorized-networks --quiet >/dev/null

echo "▶ 資料庫與帳號"
gcloud sql databases describe "$DB" --instance "$INSTANCE" >/dev/null 2>&1 || gcloud sql databases create "$DB" --instance "$INSTANCE"
if gcloud secrets describe database-url >/dev/null 2>&1; then
  echo "  連線設定已存在，略過"
else
  PASS="$(openssl rand -base64 36 | tr -dc 'A-Za-z0-9' | head -c 32)"
  if gcloud sql users list --instance "$INSTANCE" --format='value(name)' | grep -qx "$DB_USER"; then
    gcloud sql users set-password "$DB_USER" --instance "$INSTANCE" --password "$PASS" >/dev/null
  else
    gcloud sql users create "$DB_USER" --instance "$INSTANCE" --password "$PASS" >/dev/null
  fi
  printf 'postgresql://%s:%s@/%s?host=/cloudsql/%s' "$DB_USER" "$PASS" "$DB" "$CONN" \
    | gcloud secrets create database-url --data-file=- --replication-policy automatic >/dev/null
  printf 'postgresql://%s:%s@127.0.0.1:5432/%s' "$DB_USER" "$PASS" "$DB" \
    | gcloud secrets create database-migrate-url --data-file=- --replication-policy automatic >/dev/null
  unset PASS
  echo "  已建立帳號 ${DB_USER}，密碼只存在 Secret Manager"
fi
gcloud secrets add-iam-policy-binding database-url --member "serviceAccount:$RUN_SA" --role roles/secretmanager.secretAccessor --quiet >/dev/null
gcloud secrets add-iam-policy-binding database-migrate-url --member "serviceAccount:$DEPLOY_SA" --role roles/secretmanager.secretAccessor --quiet >/dev/null

echo "▶ 車牌照片儲存空間"
gcloud storage buckets describe "gs://${BUCKET}" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://${BUCKET}" --location "$REGION" --uniform-bucket-level-access --public-access-prevention
printf '%s' '{"rule":[{"action":{"type":"Delete"},"condition":{"age":90}}]}' > /tmp/pd-lifecycle.json
gcloud storage buckets update "gs://${BUCKET}" --lifecycle-file /tmp/pd-lifecycle.json >/dev/null
rm -f /tmp/pd-lifecycle.json
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" --member "serviceAccount:$RUN_SA" --role roles/storage.objectCreator >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" --member "serviceAccount:$RUN_SA" --role roles/storage.objectViewer >/dev/null

echo "▶ 後台門禁帳密（繳費頁、會員頁、工控機不受影響）"
if gcloud secrets describe admin-gate >/dev/null 2>&1; then
  echo "  已存在，略過（要更換請到 Secret Manager 新增版本）"
else
  read -r -p "  後台帳號（例如 parkdodo）：" GA_USER
  read -r -s -p "  後台密碼（輸入時不會顯示，至少 12 字元，不要和測試站相同）：" GA_PASS; echo
  [ "${#GA_PASS}" -ge 12 ] || { echo "密碼太短"; exit 1; }
  printf '%s:%s' "$GA_USER" "$GA_PASS" | gcloud secrets create admin-gate --data-file=- --replication-policy automatic >/dev/null
  unset GA_PASS
fi
gcloud secrets add-iam-policy-binding admin-gate --member "serviceAccount:$RUN_SA" --role roles/secretmanager.secretAccessor --quiet >/dev/null

cat <<EOF

✅ 正式站建置完成。請到 GitHub → parkdodo-web → Settings → Secrets and variables → Actions → Variables，新增：

  PROD_GCP_PROJECT_ID     = ${PROJECT_ID}
  PROD_GCP_WIF_PROVIDER   = projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${POOL}
  PROD_GCP_DEPLOY_SA      = ${DEPLOY_SA}
  PROD_CLOUDSQL_INSTANCE  = ${CONN}
  PROD_EDGE_IMAGE_BUCKET  = ${BUCKET}

再到 Settings → Environments → New environment，名稱填 production（可勾選 Required reviewers 加自己，部署前要你按同意）。
這些值都不是密碼。之後到 Actions →「部署正式站」→ Run workflow 部署。
EOF
