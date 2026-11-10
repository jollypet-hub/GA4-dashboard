#!/usr/bin/env bash
# 一次性設定：讓 GitHub Actions 透過 Workload Identity Federation 部署 Cloud Run（不使用任何金鑰）。
# 在 Cloud Shell 執行：bash scripts/setup-cicd.sh
# 可重複執行；已存在的資源會略過。
set -euo pipefail

# 只信任這個 repo 的 main 分支（以不可變的數字 ID 比對，改名或被搶註也無效）
REPO_ID=1452222425          # jollypet-hub/GA4-dashboard
REPO_OWNER_ID=317334578     # jollypet-hub
REGION=asia-east1
POOL=github-pool
PROVIDER=github
DEPLOYER=ga4-mcp-deployer
RUNNER=ga4-mcp-runner

PROJECT=$(gcloud config get-value project 2>/dev/null)
NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
DEPLOYER_SA="$DEPLOYER@$PROJECT.iam.gserviceaccount.com"
RUNNER_SA="$RUNNER@$PROJECT.iam.gserviceaccount.com"
BUILD_SA="$NUMBER-compute@developer.gserviceaccount.com"
echo "專案：$PROJECT（$NUMBER）"

gcloud services enable iamcredentials.googleapis.com sts.googleapis.com iam.googleapis.com --quiet

# 1. 部署專用服務帳號（與執行身分分開）
gcloud iam service-accounts describe "$DEPLOYER_SA" >/dev/null 2>&1 ||
  gcloud iam service-accounts create "$DEPLOYER" --display-name="GA4 MCP deployer (GitHub Actions)" --quiet

# 2. 最小部署權限：從原始碼部署 Cloud Run 所需
for role in roles/run.sourceDeveloper roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$DEPLOYER_SA" \
    --role="$role" --condition=None --quiet >/dev/null
done
# 只能以執行身分與建置身分部署，不能冒用其他服務帳號
for sa in "$RUNNER_SA" "$BUILD_SA"; do
  gcloud iam service-accounts add-iam-policy-binding "$sa" --member="serviceAccount:$DEPLOYER_SA" \
    --role=roles/iam.serviceAccountUser --quiet >/dev/null
done

# 3. Workload Identity Pool 與 GitHub OIDC Provider
gcloud iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools create "$POOL" --location=global --display-name="GitHub Actions" --quiet

CONDITION="assertion.repository_id=='$REPO_ID' && assertion.repository_owner_id=='$REPO_OWNER_ID' && assertion.ref=='refs/heads/main'"
if gcloud iam workload-identity-pools providers describe "$PROVIDER" --location=global --workload-identity-pool="$POOL" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers update-oidc "$PROVIDER" --location=global --workload-identity-pool="$POOL" \
    --attribute-condition="$CONDITION" --quiet >/dev/null
else
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --location=global --workload-identity-pool="$POOL" \
    --display-name="GitHub" --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref" \
    --attribute-condition="$CONDITION" --quiet
fi

# 4. 只有這個 repo 能扮演部署帳號
gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER_SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$NUMBER/locations/global/workloadIdentityPools/$POOL/attribute.repository_id/$REPO_ID" \
  --quiet >/dev/null

echo
echo "=== 請在 GitHub repo 設定以下 Variables（Settings → Secrets and variables → Actions → Variables）==="
echo "GCP_PROJECT=$PROJECT"
echo "GCP_WIF_PROVIDER=projects/$NUMBER/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER"
echo "GCP_DEPLOY_SA=$DEPLOYER_SA"
echo "SETUP_CICD_DONE"
