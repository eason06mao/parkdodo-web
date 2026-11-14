#!/usr/bin/env bash
# 網址設定：把 parkdodo.tw 的子網域接到 Cloud Run。在 Google Cloud Shell 執行：
#   bash scripts/gcp-domain-setup.sh <正式站專案ID> [測試站專案ID]
# 會接上：
#   staging.parkdodo.tw → 測試站（parkdodo-staging 專案的 parkdodo-staging 服務）
#   pay.parkdodo.tw、admin.parkdodo.tw → 正式站（parkdodo 服務；正式站部署過一次之後才接得上）
# 第一次要先證明你擁有 parkdodo.tw：腳本會給一個網址，照畫面在 Gandi 加一筆 TXT 記錄後再執行一次。
# 最後印出要在 Gandi「DNS 記錄」新增的 CNAME。HTTPS 憑證由 Google 自動配發（DNS 生效後約 15 分鐘到數小時）。
set -euo pipefail

PROD_ID="${1:?用法：bash scripts/gcp-domain-setup.sh <正式站專案ID> [測試站專案ID]}"
STAGING_ID="${2:-parkdodo-staging}"
DOMAIN="parkdodo.tw"
REGION="asia-east1"

if ! gcloud domains list-user-verified --format='value(id)' 2>/dev/null | grep -qx "$DOMAIN"; then
  echo "▶ 還沒驗證你擁有 ${DOMAIN}。接下來會開啟 Google Search Console 的驗證頁："
  echo "   1. 驗證方式選「網域名稱供應商」→ 複製 google-site-verification=… 那串文字"
  echo "   2. Gandi → 網域 → parkdodo.tw → DNS 記錄 → 新增：類型 TXT、名稱 @、值貼上那串文字"
  echo "   3. 等幾分鐘後在驗證頁按「驗證」，成功後再執行一次這個腳本"
  gcloud domains verify "$DOMAIN"
  exit 0
fi
echo "✓ 已驗證擁有 ${DOMAIN}"

map() {
  local project="$1" service="$2" host="$3"
  if ! gcloud run services describe "$service" --region "$REGION" --project "$project" >/dev/null 2>&1; then
    echo "  － ${host}：專案 ${project} 還沒有 ${service} 服務，先略過（部署後再執行一次）"; return
  fi
  if ! gcloud beta run domain-mappings describe --domain "$host" --region "$REGION" --project "$project" >/dev/null 2>&1; then
    gcloud beta run domain-mappings create --service "$service" --domain "$host" --region "$REGION" --project "$project" --quiet >/dev/null
  fi
  echo "  ✓ ${host} → ${project}/${service}"
}

echo "▶ 接上網址"
map "$STAGING_ID" parkdodo-staging "staging.${DOMAIN}"
map "$PROD_ID" parkdodo "pay.${DOMAIN}"
map "$PROD_ID" parkdodo "admin.${DOMAIN}"

echo
echo "▶ 請到 Gandi → 網域 → ${DOMAIN} → DNS 記錄，新增下面的記錄（已存在的不用重複加）："
for pair in "$STAGING_ID staging" "$PROD_ID pay" "$PROD_ID admin"; do
  set -- $pair
  gcloud beta run domain-mappings describe --domain "$2.${DOMAIN}" --region "$REGION" --project "$1" \
    --format='value(status.resourceRecords[].type,status.resourceRecords[].rrdata)' 2>/dev/null \
    | awk -v n="$2" -F'\t' 'NF{print "   類型 " $1 "　名稱 " n "　值 " $2}'
done
echo
echo "加好之後，用這個指令看憑證進度（Ready 為 True 就可以用 https 開啟）："
echo "  gcloud beta run domain-mappings describe --domain pay.${DOMAIN} --region ${REGION} --project ${PROD_ID} --format='value(status.conditions)'"
