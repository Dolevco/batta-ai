#!/bin/bash
# deploy-ui.sh — Build and deploy the UI as an Azure Storage static website.
#
# Workflow:
#   1. Builds the Vite SPA (pnpm --filter @ai-agent/ui build).
#   2. Uploads the build output to the $web container in Azure Blob Storage.
#   3. Ensures static-website hosting is enabled on the storage account.
#
# Storage account selection:
#   AZURE_UI_STORAGE_ACCOUNT — preferred, used when set (e.g. a dedicated UI account)
#   AZURE_STORAGE_ACCOUNT    — fallback (the shared infra storage account)
#
# Usage:
#   pnpm deploy:ui                         # loads .azure-env automatically
#   bash scripts/deploy-ui.sh /path/to/.env
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── Load env ──────────────────────────────────────────────────────────────────
for env_file in "${1:-}" "$ROOT_DIR/.azure-env" "$ROOT_DIR/.env.azure"; do
  [ -n "$env_file" ] && [ -f "$env_file" ] && { source "$env_file"; break; }
done

# ── Validate required env vars ────────────────────────────────────────────────
: "${AZURE_RESOURCE_GROUP:?AZURE_RESOURCE_GROUP is required}"

# Prefer AZURE_UI_STORAGE_ACCOUNT, fall back to AZURE_STORAGE_ACCOUNT
STORAGE_ACCOUNT="${AZURE_UI_STORAGE_ACCOUNT:-${AZURE_STORAGE_ACCOUNT:-}}"
: "${STORAGE_ACCOUNT:?AZURE_UI_STORAGE_ACCOUNT or AZURE_STORAGE_ACCOUNT is required — run pnpm setup:azure first}"

# Set subscription if provided
[ -n "${AZURE_SUBSCRIPTION_ID:-}" ] && az account set --subscription "$AZURE_SUBSCRIPTION_ID" 2>/dev/null || true

echo "🚀 Deploying UI as static website"
echo "   Resource Group  : $AZURE_RESOURCE_GROUP"
echo "   Storage Account : $STORAGE_ACCOUNT"
echo ""

# ── Prerequisites ─────────────────────────────────────────────────────────────
command -v az  >/dev/null || { echo "❌ Azure CLI not found. Install: brew install azure-cli"; exit 1; }
az account show &>/dev/null || { echo "❌ Not logged in. Run: az login"; exit 1; }

# ── Retrieve storage key ──────────────────────────────────────────────────────
echo "🔑 Retrieving storage account key..."
STORAGE_KEY=$(az storage account keys list \
  --account-name "$STORAGE_ACCOUNT" \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --query "[0].value" --output tsv)

# ── Build UI ──────────────────────────────────────────────────────────────────
echo "📦 Building UI..."
cd "$ROOT_DIR"
pnpm --filter @ai-agent/ui build

# Ensure images directory is included in the build output
if [ -d "packages/ui/images" ] && [ -d "packages/ui/dist" ]; then
  echo "📁 Copying packages/ui/images into packages/ui/dist/"
  cp -r packages/ui/images packages/ui/dist/ || true
fi

# ── Ensure static website hosting is enabled ─────────────────────────────────
echo "🌐 Enabling static website hosting..."
az storage blob service-properties update \
  --account-name "$STORAGE_ACCOUNT" \
  --account-key "$STORAGE_KEY" \
  --static-website \
  --index-document index.html \
  --404-document index.html \
  --only-show-errors

# ── Upload JS/CSS assets (long-lived cache for content-hashed filenames) ──────
echo "☁️  Uploading JS/CSS assets (long-lived cache)..."
az storage blob upload-batch \
  --account-name "$STORAGE_ACCOUNT" \
  --account-key "$STORAGE_KEY" \
  --destination '$web' \
  --source packages/ui/dist \
  --overwrite \
  --content-cache-control "public, max-age=31536000, immutable" \
  --pattern "*.js" \
  --only-show-errors

az storage blob upload-batch \
  --account-name "$STORAGE_ACCOUNT" \
  --account-key "$STORAGE_KEY" \
  --destination '$web' \
  --source packages/ui/dist \
  --overwrite \
  --content-cache-control "public, max-age=31536000, immutable" \
  --pattern "*.css" \
  --only-show-errors

# ── Upload HTML (no-cache so new deploys are picked up immediately) ───────────
echo "☁️  Uploading HTML (no-cache)..."
az storage blob upload-batch \
  --account-name "$STORAGE_ACCOUNT" \
  --account-key "$STORAGE_KEY" \
  --destination '$web' \
  --source packages/ui/dist \
  --overwrite \
  --content-cache-control "no-cache, no-store, must-revalidate" \
  --pattern "*.html" \
  --only-show-errors

# ── Upload everything else (images, fonts, SVGs, etc.) ───────────────────────
echo "☁️  Uploading remaining assets..."
az storage blob upload-batch \
  --account-name "$STORAGE_ACCOUNT" \
  --account-key "$STORAGE_KEY" \
  --destination '$web' \
  --source packages/ui/dist \
  --overwrite \
  --only-show-errors

# ── Get the static website URL ────────────────────────────────────────────────
UI_URL=$(az storage account show \
  --name "$STORAGE_ACCOUNT" \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --query "primaryEndpoints.web" --output tsv)

echo ""
echo "✅ UI deployed!"
echo "   URL : ${UI_URL%/}"
echo ""
echo "📝 Useful commands:"
echo "   List blobs : az storage blob list --account-name $STORAGE_ACCOUNT --container-name '\$web' --output table"
