#!/bin/bash
# setup-azure.sh — One-time Azure bootstrap.
# Creates the resource group and deploys all infrastructure via Bicep.
# Run once per environment; re-run to update infra (idempotent).
#
# Usage:
#   source .azure-env && bash scripts/setup-azure.sh
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── Load env ──────────────────────────────────────────────────────────────────
for env_file in "${1:-}" "$ROOT_DIR/.azure-env" "$ROOT_DIR/.env.azure"; do
  [ -n "$env_file" ] && [ -f "$env_file" ] && { source "$env_file"; break; }
done

: "${AZURE_RESOURCE_GROUP:?AZURE_RESOURCE_GROUP is required}"
: "${AZURE_LOCATION:?AZURE_LOCATION is required}"
: "${BICEP_BASE_NAME:=${AZURE_RESOURCE_GROUP}}"

echo "🔧 Bootstrapping Azure resources"
echo "   Resource Group : $AZURE_RESOURCE_GROUP"
echo "   Location       : $AZURE_LOCATION"
echo "   Base Name      : $BICEP_BASE_NAME"
echo ""

# ── Prerequisites ─────────────────────────────────────────────────────────────
command -v az  >/dev/null || { echo "❌ Azure CLI not found. Install: brew install azure-cli"; exit 1; }
az account show &>/dev/null || { echo "❌ Not logged in. Run: az login"; exit 1; }

# Set subscription if provided
if [ -n "${AZURE_SUBSCRIPTION_ID:-}" ]; then
  az account set --subscription "$AZURE_SUBSCRIPTION_ID" 2>/dev/null || true
fi

# ── Resource group ────────────────────────────────────────────────────────────
echo "📦 Ensuring resource group '$AZURE_RESOURCE_GROUP' exists..."
EXISTING_RG_LOCATION=$(az group show --name "$AZURE_RESOURCE_GROUP" --query "location" --output tsv 2>/dev/null || true)
if [ -z "$EXISTING_RG_LOCATION" ]; then
  az group create \
    --name "$AZURE_RESOURCE_GROUP" \
    --location "$AZURE_LOCATION" \
    --only-show-errors
  echo "   Created resource group in $AZURE_LOCATION"
else
  echo "   Resource group already exists in $EXISTING_RG_LOCATION (skipping creation)"
fi

# ── Preserve live image tags so re-runs don't regress running containers ──────
# Read the current image from each resource; fall back to empty (placeholder) on
# first deploy when the resource doesn't exist yet.
_current_api_image() {
  az containerapp show \
    --name "${BICEP_BASE_NAME}-api" \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --query "properties.template.containers[0].image" --output tsv 2>/dev/null || true
}
_current_worker_image() {
  az containerapp job show \
    --name "${AZURE_WORKER_JOB_NAME:-${BICEP_BASE_NAME}-worker}" \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --query "properties.template.containers[0].image" --output tsv 2>/dev/null || true
}
_current_neo4j_image() {
  az containerapp show \
    --name "${BICEP_BASE_NAME}-neo4j" \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --query "properties.template.containers[0].image" --output tsv 2>/dev/null || true
}
_current_qdrant_image() {
  az containerapp show \
    --name "${BICEP_BASE_NAME}-qdrant" \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --query "properties.template.containers[0].image" --output tsv 2>/dev/null || true
}

echo "🔍 Reading current live image tags (to preserve on re-run)..."
LIVE_API_IMAGE=$(_current_api_image)
LIVE_WORKER_IMAGE=$(_current_worker_image)
LIVE_NEO4J_IMAGE=$(_current_neo4j_image)
LIVE_QDRANT_IMAGE=$(_current_qdrant_image)

[ -n "$LIVE_API_IMAGE" ]    && echo "   API    : $LIVE_API_IMAGE"    || echo "   API    : (first deploy — will use placeholder)"
[ -n "$LIVE_WORKER_IMAGE" ] && echo "   Worker : $LIVE_WORKER_IMAGE" || echo "   Worker : (first deploy — will use placeholder)"
[ -n "$LIVE_NEO4J_IMAGE" ]  && echo "   Neo4j  : $LIVE_NEO4J_IMAGE"  || echo "   Neo4j  : (first deploy — will use placeholder)"
[ -n "$LIVE_QDRANT_IMAGE" ] && echo "   Qdrant : $LIVE_QDRANT_IMAGE" || echo "   Qdrant : (first deploy — will use placeholder)"
echo ""

# ── Build Bicep parameter overrides from environment variables ────────────────
PARAMS=(
  "baseName=$BICEP_BASE_NAME"
  "location=$AZURE_LOCATION"
)

# Map env vars → Bicep parameters (non-empty values only)
add_param() {
  local val="${!2:-}"
  if [ -n "$val" ]; then
    PARAMS+=("$1=$val")
  fi
  return 0
}

add_param "redisUrl"                        "REDIS_URL"
add_param "qdrantApiKey"                    "QDRANT_API_KEY"
add_param "neo4jUsername"                   "NEO4J_USERNAME"
add_param "neo4jPassword"                   "NEO4J_PASSWORD"
add_param "acrName"                         "AZURE_CONTAINER_REGISTRY"
add_param "containerAppsEnvName"            "AZURE_CONTAINER_APPS_ENV"
add_param "workerJobNameOverride"           "AZURE_WORKER_JOB_NAME"
add_param "storageAccountNameOverride"      "AZURE_STORAGE_ACCOUNT"
add_param "taskCollectionName"              "TASK_COLLECTION_NAME"
add_param "chatMessageCollectionName"       "CHAT_MESSAGE_COLLECTION_NAME"
add_param "azureOpenAiEndpoint"             "AZURE_OPENAI_ENDPOINT"
add_param "azureOpenAiApiKey"               "AZURE_OPENAI_API_KEY"
add_param "azureOpenAiDeployment"           "AZURE_OPENAI_DEPLOYMENT"
add_param "azureOpenAiApiVersion"           "AZURE_OPENAI_API_VERSION"
add_param "azureOpenAiEmbeddingEndpoint"    "AZURE_OPENAI_EMBEDDING_ENDPOINT"
add_param "azureOpenAiEmbeddingApiKey"      "AZURE_OPENAI_EMBEDDING_API_KEY"
add_param "azureOpenAiEmbeddingDeployment"  "AZURE_OPENAI_EMBEDDING_DEPLOYMENT"
add_param "azureOpenAiEmbeddingApiVersion"  "AZURE_OPENAI_EMBEDDING_API_VERSION"
add_param "slackClientId"                   "SLACK_CLIENT_ID"
add_param "slackClientSecret"               "SLACK_CLIENT_SECRET"
add_param "slackRedirectUri"                "SLACK_REDIRECT_URI"
add_param "githubAppId"                     "GITHUB_APP_ID"
add_param "githubAppPrivateKey"             "GITHUB_APP_PRIVATE_KEY"
add_param "githubAppSlug"                   "GITHUB_APP_SLUG"
add_param "githubRedirectUri"               "GITHUB_REDIRECT_URI"
add_param "uiBaseUrl"                       "UI_BASE_URL"
add_param "jwtIssuer"                       "JWT_ISSUER"
add_param "jwtAudience"                     "JWT_AUDIENCE"
add_param "jwksUri"                         "JWKS_URI"
add_param "entraEnabled"                    "ENTRA_ENABLED"
add_param "entraTenantId"                   "ENTRA_TENANT_ID"

# Image params — resolution priority:
#   1. If the live image is already from our ACR, preserve it (rolling deploy safety).
#   2. Else if an env-var override is set, use it (lets setup:azure push correct images).
#   3. Else leave empty so Bicep uses the safe placeholder on first deploy.
#
# "Our ACR" is derived from AZURE_CONTAINER_REGISTRY (e.g. aisecagentregistry.azurecr.io).
ACR_SERVER="${AZURE_CONTAINER_REGISTRY:-}.azurecr.io"
_is_acr_image() {
  # Returns 0 (true) if the image is from our own registry
  [[ "$1" == "${ACR_SERVER}/"* ]]
}
_resolve_image() {
  local live="$1" envvar="$2"
  local envval="${!envvar:-}"
  if [ -n "$live" ] && _is_acr_image "$live"; then
    # Live image is already our own ACR image — preserve it
    echo "$live"
  elif [ -n "$envval" ]; then
    # Env var provides the authoritative image (e.g. ACR URL set in .azure-env)
    echo "$envval"
  elif [ -n "$live" ]; then
    # Live image exists but is NOT from our ACR (placeholder / Docker Hub) — skip it
    echo ""
  else
    echo ""
  fi
}
API_IMAGE_PARAM=$(_resolve_image    "$LIVE_API_IMAGE"    "AZURE_API_IMAGE")
WORKER_IMAGE_PARAM=$(_resolve_image "$LIVE_WORKER_IMAGE" "AZURE_WORKER_IMAGE")
NEO4J_IMAGE_PARAM=$(_resolve_image  "$LIVE_NEO4J_IMAGE"  "NEO4J_IMAGE")
QDRANT_IMAGE_PARAM=$(_resolve_image "$LIVE_QDRANT_IMAGE" "QDRANT_IMAGE")

[ -n "$API_IMAGE_PARAM" ]    && PARAMS+=("apiImage=$API_IMAGE_PARAM")
[ -n "$WORKER_IMAGE_PARAM" ] && PARAMS+=("workerImage=$WORKER_IMAGE_PARAM")
[ -n "$NEO4J_IMAGE_PARAM" ]  && PARAMS+=("neo4jImage=$NEO4J_IMAGE_PARAM")
[ -n "$QDRANT_IMAGE_PARAM" ] && PARAMS+=("qdrantImage=$QDRANT_IMAGE_PARAM")

# ── Mirror Qdrant & Neo4j into ACR (idempotent — skips if tag already exists) ─
# This ensures setup:azure is self-contained: images are available in ACR before
# Bicep deploys the container apps, so managed-identity pulls succeed immediately.
if [ -n "${AZURE_CONTAINER_REGISTRY:-}" ]; then
  ACR_LOGIN_SERVER="${AZURE_CONTAINER_REGISTRY}.azurecr.io"
  QDRANT_ACR_IMAGE="${QDRANT_IMAGE:-${ACR_LOGIN_SERVER}/qdrant:latest}"
  NEO4J_ACR_IMAGE="${NEO4J_IMAGE:-${ACR_LOGIN_SERVER}/neo4j:5}"

  _acr_tag_exists() {
    local repo="$1" tag="$2"
    az acr repository show-tags \
      --name "$AZURE_CONTAINER_REGISTRY" \
      --repository "$repo" \
      --output tsv 2>/dev/null | grep -qx "$tag"
  }

  _qdrant_repo=$(echo "$QDRANT_ACR_IMAGE" | sed "s|${ACR_LOGIN_SERVER}/||" | cut -d: -f1)
  _qdrant_tag=$(echo "$QDRANT_ACR_IMAGE" | cut -d: -f2)
  _neo4j_repo=$(echo "$NEO4J_ACR_IMAGE"  | sed "s|${ACR_LOGIN_SERVER}/||" | cut -d: -f1)
  _neo4j_tag=$(echo "$NEO4J_ACR_IMAGE"   | cut -d: -f2)

  echo "🐳 Ensuring Qdrant image is in ACR (${QDRANT_ACR_IMAGE})..."
  if _acr_tag_exists "$_qdrant_repo" "$_qdrant_tag"; then
    echo "   ✓ Already present — skipping import."
  else
    echo "   Importing qdrant/qdrant:latest → ${QDRANT_ACR_IMAGE}..."
    az acr import \
      --name "$AZURE_CONTAINER_REGISTRY" \
      --source "docker.io/qdrant/qdrant:latest" \
      --image "${_qdrant_repo}:${_qdrant_tag}" \
      --force \
      --only-show-errors
    echo "   ✓ Qdrant imported."
  fi

  echo "🐳 Ensuring Neo4j image is in ACR (${NEO4J_ACR_IMAGE})..."
  if _acr_tag_exists "$_neo4j_repo" "$_neo4j_tag"; then
    echo "   ✓ Already present — skipping import."
  else
    echo "   Importing neo4j:5 → ${NEO4J_ACR_IMAGE}..."
    az acr import \
      --name "$AZURE_CONTAINER_REGISTRY" \
      --source "docker.io/library/neo4j:5" \
      --image "${_neo4j_repo}:${_neo4j_tag}" \
      --force \
      --only-show-errors
    echo "   ✓ Neo4j imported."
  fi
  echo ""
fi

# ── Pre-grant AcrPull to existing container apps (fixes chicken-and-egg on re-run) ──
# On first deploy Bicep creates the role assignments after the container apps are
# provisioned.  On re-runs, the container apps already exist with a managed identity
# but the AcrPull assignment may be missing, causing image-pull failures before
# Bicep can create the assignment.  Grant it here imperatively so it is in place
# before the Bicep deployment attempts to pull the ACR images.
#
# We use guid(acrId, containerAppId, 'AcrPull-acr-scope') — the same formula used
# in container-apps.bicep — so Bicep finds the assignment already exists and skips
# re-creating it (idempotent).
if [ -n "${AZURE_CONTAINER_REGISTRY:-}" ]; then
  _ACR_ID=$(az acr show --name "$AZURE_CONTAINER_REGISTRY" --query id --output tsv 2>/dev/null || true)
  ACRPULL_ROLE_DEF="7f951dda-4ed3-4680-a7ca-43fe172d538d"

  # Compute guid(arg1, arg2, arg3) using the same algorithm as ARM's Bicep guid() function.
  # ARM guid() uses: uuidv5(namespace=11fb06fb-712d-4ddd-98c7-e71bbd588830, input=args joined with '-')
  # Reference: https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/bicep-functions-string#guid
  _bicep_guid() {
    python3 -c "
import uuid, sys
ns = uuid.UUID('11fb06fb-712d-4ddd-98c7-e71bbd588830')
print(uuid.uuid5(ns, '-'.join(sys.argv[1:])))
" "$1" "$2" "$3" 2>/dev/null || true
  }

  _grant_acrpull() {
    local app_name="$1"
    local app_id principal_id
    app_id=$(az containerapp show \
      --name "$app_name" \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --query id --output tsv 2>/dev/null || true)
    # Normalize resource ID to canonical ARM casing (CLI returns lowercase 'containerapps',
    # but Bicep's guid() uses the canonical 'containerApps' casing).
    app_id=$(echo "$app_id" | sed 's|/providers/Microsoft\.App/containerapps/|/providers/Microsoft.App/containerApps/|g')
    principal_id=$(az containerapp show \
      --name "$app_name" \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --query "identity.principalId" --output tsv 2>/dev/null || true)
    if [ -z "$principal_id" ] || [ -z "$_ACR_ID" ] || [ -z "$app_id" ]; then return; fi

    # Use the same GUID formula as container-apps.bicep
    local assignment_name
    assignment_name=$(_bicep_guid "$_ACR_ID" "$app_id" "AcrPull-acr-scope")

    # Check if already exists with this exact name (idempotent)
    local existing
    existing=$(az role assignment list \
      --scope "$_ACR_ID" \
      --query "[?name=='${assignment_name}'] | length(@)" \
      --output tsv 2>/dev/null || echo "0")
    if [ "${existing:-0}" -gt "0" ] 2>/dev/null; then
      echo "   AcrPull for $app_name already exists (name=$assignment_name) — skipping."
      return
    fi

    # Delete any conflicting AcrPull assignment at ACR scope for this principal (wrong name)
    az role assignment delete \
      --assignee "$principal_id" \
      --role "$ACRPULL_ROLE_DEF" \
      --scope "$_ACR_ID" \
      --only-show-errors 2>/dev/null || true

    # Create with the deterministic name Bicep expects
    az role assignment create \
      --name "$assignment_name" \
      --assignee-object-id "$principal_id" \
      --assignee-principal-type "ServicePrincipal" \
      --role "$ACRPULL_ROLE_DEF" \
      --scope "$_ACR_ID" \
      --only-show-errors 2>/dev/null || true

    echo "   Granted AcrPull for $app_name (principalId=$principal_id, name=$assignment_name)"
  }

  # Variant for Container Apps Jobs (uses `az containerapp job show`)
  _grant_acrpull_job() {
    local job_name="$1"
    local job_id principal_id
    job_id=$(az containerapp job show \
      --name "$job_name" \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --query id --output tsv 2>/dev/null || true)
    principal_id=$(az containerapp job show \
      --name "$job_name" \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --query "identity.principalId" --output tsv 2>/dev/null || true)
    if [ -z "$principal_id" ] || [ -z "$_ACR_ID" ] || [ -z "$job_id" ]; then return; fi

    local assignment_name
    assignment_name=$(_bicep_guid "$_ACR_ID" "$job_id" "AcrPull-acr-scope")

    local existing
    existing=$(az role assignment list \
      --scope "$_ACR_ID" \
      --query "[?name=='${assignment_name}'] | length(@)" \
      --output tsv 2>/dev/null || echo "0")
    if [ "${existing:-0}" -gt "0" ] 2>/dev/null; then
      echo "   AcrPull for $job_name already exists (name=$assignment_name) — skipping."
      return
    fi

    az role assignment delete \
      --assignee "$principal_id" \
      --role "$ACRPULL_ROLE_DEF" \
      --scope "$_ACR_ID" \
      --only-show-errors 2>/dev/null || true

    az role assignment create \
      --name "$assignment_name" \
      --assignee-object-id "$principal_id" \
      --assignee-principal-type "ServicePrincipal" \
      --role "$ACRPULL_ROLE_DEF" \
      --scope "$_ACR_ID" \
      --only-show-errors 2>/dev/null || true

    echo "   Granted AcrPull for $job_name (principalId=$principal_id, name=$assignment_name)"
  }

  # Recover container apps / jobs stuck in Failed provisioning state so that
  # Bicep re-deployments do not time out trying to update already-failed resources.
  _recover_failed_containerapp() {
    local app_name="$1"
    local state
    state=$(az containerapp show \
      --name "$app_name" \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --query "properties.provisioningState" --output tsv 2>/dev/null || true)
    if [ "$state" = "Failed" ]; then
      echo "   Recovering Failed container app '$app_name'..."
      local img
      img=$(az containerapp show --name "$app_name" --resource-group "$AZURE_RESOURCE_GROUP" \
        --query "properties.template.containers[0].image" --output tsv 2>/dev/null || true)
      az containerapp update \
        --name "$app_name" \
        --resource-group "$AZURE_RESOURCE_GROUP" \
        --image "${img:-mcr.microsoft.com/azuredocs/aci-helloworld:latest}" \
        --only-show-errors 2>/dev/null || true
      echo "   Recovered '$app_name'."
    fi
  }
  _recover_failed_job() {
    local job_name="$1"
    local state
    state=$(az containerapp job show \
      --name "$job_name" \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --query "properties.provisioningState" --output tsv 2>/dev/null || true)
    if [ "$state" = "Failed" ]; then
      echo "   Recovering Failed container app job '$job_name'..."
      local img
      img=$(az containerapp job show --name "$job_name" --resource-group "$AZURE_RESOURCE_GROUP" \
        --query "properties.template.containers[0].image" --output tsv 2>/dev/null || true)
      az containerapp job update \
        --name "$job_name" \
        --resource-group "$AZURE_RESOURCE_GROUP" \
        --image "${img:-mcr.microsoft.com/azuredocs/aci-helloworld:latest}" \
        --only-show-errors 2>/dev/null || true
      echo "   Recovered '$job_name'."
    fi
  }

  # Ensure the API container app has the Contributor role on the resource group
  # with the deterministic name that Bicep expects: guid(rgId, apiApp.id, 'Contributor-rg-scope').
  # If an assignment already exists for the same principal+role+scope but with a DIFFERENT name,
  # Bicep will try to create a new one and fail with RoleAssignmentExists.
  # We delete the wrongly-named assignment and recreate it with the correct deterministic name.
  _grant_contributor_api() {
    local app_name="${BICEP_BASE_NAME}-api"
    local app_id principal_id
    app_id=$(az containerapp show \
      --name "$app_name" \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --query id --output tsv 2>/dev/null || true)
    # Normalize to canonical ARM casing that Bicep's guid() uses
    app_id=$(echo "$app_id" | sed 's|/providers/Microsoft\.App/containerapps/|/providers/Microsoft.App/containerApps/|g')
    principal_id=$(az containerapp show \
      --name "$app_name" \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --query "identity.principalId" --output tsv 2>/dev/null || true)
    if [ -z "$principal_id" ] || [ -z "$app_id" ]; then return; fi

    local rg_id="/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${AZURE_RESOURCE_GROUP}"
    local contributor_role_def="b24988ac-6180-42a0-ab88-20f7382dd24c"
    local assignment_name
    assignment_name=$(_bicep_guid "$rg_id" "$app_id" "Contributor-rg-scope")

    # Check if the correctly-named assignment already exists
    local existing
    existing=$(az role assignment list \
      --scope "$rg_id" \
      --query "[?name=='${assignment_name}'] | length(@)" \
      --output tsv 2>/dev/null || echo "0")
    if [ "${existing:-0}" -gt "0" ] 2>/dev/null; then
      echo "   Contributor for $app_name already exists (name=$assignment_name) — skipping."
      return
    fi

    # Delete any existing Contributor assignment for this principal with a wrong name
    # (this is what causes RoleAssignmentExists when Bicep tries to create the correct-named one)
    az role assignment delete \
      --assignee "$principal_id" \
      --role "$contributor_role_def" \
      --scope "$rg_id" \
      --only-show-errors 2>/dev/null || true

    # Recreate with the deterministic name Bicep expects
    az role assignment create \
      --name "$assignment_name" \
      --assignee-object-id "$principal_id" \
      --assignee-principal-type "ServicePrincipal" \
      --role "$contributor_role_def" \
      --scope "$rg_id" \
      --only-show-errors 2>/dev/null || true

    echo "   Granted Contributor for $app_name on RG (principalId=$principal_id, name=$assignment_name)"
  }

  echo "🔑 Pre-granting AcrPull to container apps (idempotent, matching Bicep names)..."
  _grant_acrpull "${BICEP_BASE_NAME}-qdrant"
  _grant_acrpull "${BICEP_BASE_NAME}-neo4j"
  _grant_acrpull "${BICEP_BASE_NAME}-api"
  _grant_acrpull_job "${AZURE_WORKER_JOB_NAME:-${BICEP_BASE_NAME}-worker}"
  echo "   Done."
  echo ""

  echo "🔑 Pre-granting Contributor to API container app on resource group (idempotent)..."
  _grant_contributor_api
  echo "   Done."
  echo ""

  echo "🔧 Recovering any container apps/jobs stuck in Failed provisioning state..."
  _recover_failed_containerapp "${BICEP_BASE_NAME}-qdrant"
  _recover_failed_containerapp "${BICEP_BASE_NAME}-neo4j"
  _recover_failed_containerapp "${BICEP_BASE_NAME}-api"
  _recover_failed_job "${AZURE_WORKER_JOB_NAME:-${BICEP_BASE_NAME}-worker}"
  echo "   Done."
  echo ""
fi

# ── Deploy Bicep ──────────────────────────────────────────────────────────────
DEPLOY_NAME="setup-$(date +%Y%m%d-%H%M%S)"
echo "🚀 Deploying infrastructure via Bicep (deployment: ${DEPLOY_NAME})..."
DEPLOY_OUTPUT=$(az deployment group create \
  --name "$DEPLOY_NAME" \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --template-file "$ROOT_DIR/infra/main.bicep" \
  --parameters "${PARAMS[@]}" \
  --query "properties.outputs" \
  --output json)

echo ""
echo "✅ Infrastructure deployed successfully!"
echo ""

# ── Helper: extract a value from the Bicep deployment JSON output ─────────────
_jq() { echo "$DEPLOY_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$1',{}).get('value',''))" 2>/dev/null || true; }

# ── Enable static website hosting on the storage account ─────────────────────
# The ARM API does not support setting staticWebsite via the management plane;
# it must be enabled via the Azure Storage data-plane CLI.
STORAGE_ACCT_NAME="${AZURE_STORAGE_ACCOUNT:-}"
if [ -z "$STORAGE_ACCT_NAME" ]; then
  # Derive from Bicep output if not explicitly set
  STORAGE_ACCT_NAME=$(_jq storageAccount)
fi
if [ -n "$STORAGE_ACCT_NAME" ]; then
  echo "🌐 Enabling static website hosting on storage account '$STORAGE_ACCT_NAME'..."
  az storage blob service-properties update \
    --account-name "$STORAGE_ACCT_NAME" \
    --static-website \
    --index-document "index.html" \
    --404-document "index.html" \
    --auth-mode login \
    --only-show-errors
  echo "   Static website hosting enabled."
else
  echo "⚠️  Could not determine storage account name — skipping static website enablement."
  echo "   Run manually: az storage blob service-properties update --account-name <name> --static-website --index-document index.html --404-document index.html --auth-mode login"
fi
echo ""

# ── Print outputs ─────────────────────────────────────────────────────────────

ACR_NAME=$(_jq acrName)
ACR_SERVER=$(_jq acrLoginServer)
API_URL=$(_jq apiUrl)
UI_URL=$(_jq uiUrl)
API_APP=$(_jq apiAppName)
STORAGE_ACCT=$(_jq storageAccount)
WORKER_JOB=$(_jq workerJobName)
NEO4J_APP="${BICEP_BASE_NAME}-neo4j"
QDRANT_APP="${BICEP_BASE_NAME}-qdrant"

echo "📋 Resource summary:"
[ -n "$ACR_NAME" ]    && echo "   ACR         : $ACR_NAME  ($ACR_SERVER)"
[ -n "$API_URL" ]     && echo "   API         : $API_URL  (app: $API_APP)"
[ -n "$UI_URL" ]      && echo "   UI          : $UI_URL  (storage: $STORAGE_ACCT)"
[ -n "$WORKER_JOB" ]  && echo "   Worker Job  : $WORKER_JOB"
[ -n "$NEO4J_APP" ]   && echo "   Neo4j App   : $NEO4J_APP"
[ -n "$QDRANT_APP" ]  && echo "   Qdrant App  : $QDRANT_APP"
echo ""
echo "📝 Add the following to your .azure-env if not already set:"
echo ""
[ -n "$ACR_NAME" ]    && echo "   AZURE_CONTAINER_REGISTRY=$ACR_NAME"
[ -n "$API_APP" ]     && echo "   AZURE_API_APP_NAME=$API_APP"
[ -n "$STORAGE_ACCT" ] && echo "   AZURE_STORAGE_ACCOUNT=$STORAGE_ACCT"
[ -n "$WORKER_JOB" ]  && echo "   AZURE_WORKER_JOB_NAME=$WORKER_JOB"
[ -n "$NEO4J_APP" ]   && echo "   AZURE_NEO4J_APP_NAME=$NEO4J_APP"
[ -n "$QDRANT_APP" ]  && echo "   AZURE_QDRANT_APP_NAME=$QDRANT_APP"
echo ""
echo "▶  Next: pnpm deploy:api && pnpm deploy:ui"
