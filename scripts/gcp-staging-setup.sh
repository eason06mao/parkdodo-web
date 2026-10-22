#!/usr/bin/env bash
# ParkDodo 測試站：Google Cloud 一次性設定。請在 Google Cloud Shell（瀏覽器裡的終端機）執行：
#   bash scripts/gcp-staging-setup.sh <專案ID>
# 會做的事（重複執行也安全）：
#   1. 開啟 Cloud Run、Artifact Registry、Secret Manager、IAM Credentials API
#   2. 建立映像檔倉庫 parkdodo（台灣 asia-east1）
#   3. 建立兩個服務帳號：github-deployer（GitHub 部署用）、parkdodo-run（網站執行用）
#   4. 設定 Workload Identity：只允許 GitHub repo eason06mao/parkdodo-web 登入，不產生任何金鑰檔
#   5. 建立測試站門禁密碼（Secret Manager，輸入時不顯示）
# 最後印出要填到 GitHub「Variables」的三個值（不是密碼，可以公開）。
set -euo pipefail

PROJECT_ID="${1:?用法：bash scripts/gcp-staging-setup.sh <專案ID>}"
REPO="eason06mao/parkdodo-web"
REGION="asia-east1"
POOL="github"
DEPLOY_SA="github-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
RUN_SA="parkdodo-run@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

echo "▶ 開啟需要的服務（第一次約 1–2 分鐘）"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com

echo "▶ 映像檔倉庫"
gcloud artifacts repositories describe parkdodo --location "$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create parkdodo --repository-format docker --location "$REGION" \
    --description "ParkDodo 網站映像檔"

echo "▶ 服務帳號"
gcloud iam service-accounts describe "$DEPLOY_SA" >/dev/null 2>&1 || \
  gcloud iam service-accounts create github-deployer --display-name "GitHub 部署測試站"
gcloud iam service-accounts describe "$RUN_SA" >/dev/null 2>&1 || \
  gcloud iam service-accounts create parkdodo-run --display-name "ParkDodo 網站執行"

# 部署帳號：只給部署需要的權限
for role in roles/run.admin roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$DEPLOY_SA" --role "$role" \
    --condition None --quiet >/dev/null
done
# 部署帳號可以「以 parkdodo-run 身分」啟動網站
gcloud iam service-accounts add-iam-policy-binding "$RUN_SA" --member "serviceAccount:$DEPLOY_SA" \
  --role roles/iam.serviceAccountUser --quiet >/dev/null

echo "▶ Workload Identity（只允許 ${REPO}）"
gcloud iam workload-identity-pools describe "$POOL" --location global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create "$POOL" --location global --display-name "GitHub Actions"
gcloud iam workload-identity-pools providers describe "$POOL" --location global --workload-identity-pool "$POOL" >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc "$POOL" --location global --workload-identity-pool "$POOL" \
    --issuer-uri "https://token.actions.githubusercontent.com" \
    --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition "assertion.repository=='${REPO}' && assertion.ref=='refs/heads/main'"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${REPO}" \
  --quiet >/dev/null

echo "▶ 測試站門禁密碼"
if gcloud secrets describe staging-basic-auth >/dev/null 2>&1; then
  echo "  已存在，略過（要更換請到 Secret Manager 新增版本）"
else
  read -r -p "  門禁帳號（例如 parkdodo）：" BA_USER
  read -r -s -p "  門禁密碼（輸入時不會顯示，至少 12 字元）：" BA_PASS; echo
  [ "${#BA_PASS}" -ge 12 ] || { echo "密碼太短"; exit 1; }
  printf '%s:%s' "$BA_USER" "$BA_PASS" | gcloud secrets create staging-basic-auth --data-file=- --replication-policy automatic
fi
gcloud secrets add-iam-policy-binding staging-basic-auth --member "serviceAccount:$RUN_SA" \
  --role roles/secretmanager.secretAccessor --quiet >/dev/null

cat <<EOF

✅ 設定完成。請到 GitHub → parkdodo-web → Settings → Secrets and variables → Actions → Variables，新增三個變數：

  GCP_PROJECT_ID   = ${PROJECT_ID}
  GCP_WIF_PROVIDER = projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${POOL}
  GCP_DEPLOY_SA    = ${DEPLOY_SA}

這三個值不是密碼。之後每次 main 合併、自動檢查通過，就會部署到測試站。
EOF
