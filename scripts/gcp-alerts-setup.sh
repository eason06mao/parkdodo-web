#!/usr/bin/env bash
# 系統通知（工控機離線寄信）設定。在 Google Cloud Shell 執行：
#   bash scripts/gcp-alerts-setup.sh <專案ID>
# 做的事：
#   1. 把公司信箱（service@parkdodo.tw）的密碼存進 Secret Manager（smtp-pass），用鍵盤輸入、畫面不顯示
#   2. 自動產生一組呼叫密碼存進 Secret Manager（cron-secret）
#   3. 建立 Cloud Scheduler 工作：每分鐘呼叫 /api/cron/edge-offline 檢查工控機有沒有離線
# 完成後到 GitHub → Settings → Secrets and variables → Actions → Variables 新增 ALERTS=on，再重新部署一次。
set -euo pipefail

PROJECT_ID="${1:?請提供專案 ID，例如 parkdodo-staging}"
REGION=asia-east1
SERVICE="${2:-parkdodo-staging}"
RUN_SA="parkdodo-run@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud config set project "$PROJECT_ID" >/dev/null
gcloud services enable secretmanager.googleapis.com cloudscheduler.googleapis.com >/dev/null

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

echo "請輸入 service@parkdodo.tw 的信箱密碼（畫面不會顯示）。直接按 Enter 表示沿用已存的密碼。"
read -rsp "信箱密碼：" SMTP_PASS; echo
if [ -n "$SMTP_PASS" ]; then put smtp-pass "$SMTP_PASS"; elif ! gcloud secrets describe smtp-pass >/dev/null 2>&1; then echo "還沒有存過信箱密碼"; exit 1; fi
unset SMTP_PASS

if gcloud secrets describe cron-secret >/dev/null 2>&1; then
  CRON_SECRET=$(gcloud secrets versions access latest --secret cron-secret)
  echo "  ✓ cron-secret（沿用）"
else
  CRON_SECRET=$(openssl rand -hex 24)
  put cron-secret "$CRON_SECRET"
fi

URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')
[ -n "$URL" ] || { echo "找不到 Cloud Run 服務 $SERVICE"; exit 1; }
JOB=edge-offline-check
ARGS=(--location "$REGION" --schedule "* * * * *" --time-zone "Asia/Taipei" --uri "$URL/api/cron/edge-offline"
      --http-method POST --headers "Authorization=Bearer $CRON_SECRET" --attempt-deadline 30s)
if gcloud scheduler jobs describe "$JOB" --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$JOB" "${ARGS[@]}" >/dev/null
else
  gcloud scheduler jobs create http "$JOB" "${ARGS[@]}" >/dev/null
fi
unset CRON_SECRET
echo "  ✓ 每分鐘檢查：$URL/api/cron/edge-offline"
echo
echo "完成。接著到 GitHub Variables 新增 ALERTS=on，然後到 Actions 重新執行最新一次「自動檢查」部署。"
