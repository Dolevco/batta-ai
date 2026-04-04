#!/bin/bash
# deploy-api.sh — Build, push, and deploy the API + Worker + Qdrant + Neo4j containers.
#
# For rolling image updates this script:
#   1. Builds and pushes new API and Worker images to ACR.
#   2. Mirrors Qdrant (qdrant/qdrant:latest) and Neo4j (neo4j:5) from Docker Hub into ACR.
#   3. Updates the API Container App image in-place.
#   4. Updates the Worker Container Apps Job image in-place.
#   5. Updates the Neo4j Container App image in-place.
#   6. Updates the Qdrant Container App image in-place.
#
# Both Qdrant and Neo4j are pulled from Docker Hub, re-tagged, and pushed to ACR so
# Container Apps can pull them via system-assigned managed identity (AcrPull) rather
# than using public Docker Hub pulls or admin credentials.
#
# Usage:
#   pnpm deploy:api                         # loads .azure-env automatically
#   bash scripts/deploy-api.sh /path/to/.env
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── Load env ──────────────────────────────────────────────────────────────────
for env_file in "${1:-}" "$ROOT_DIR/.azure-env" "$ROOT_DIR/.env.azure"; do
  [ -n "$env_file" ] && [ -f "$env_file" ] && { source "$env_file"; break; }
done

# ── Validate required env vars ────────────────────────────────────────────────
: "${AZURE_RESOURCE_GROUP:?AZURE_RESOURCE_GROUP is required}"
: "${AZURE_CONTAINER_REGISTRY:?AZURE_CONTAINER_REGISTRY is required}"
: "${AZURE_API_APP_NAME:?AZURE_API_APP_NAME is required — run pnpm setup:azure first}"
: "${AZURE_WORKER_JOB_NAME:?AZURE_WORKER_JOB_NAME is required}"
: "${AZURE_NEO4J_APP_NAME:?AZURE_NEO4J_APP_NAME is required}"
: "${AZURE_QDRANT_APP_NAME:?AZURE_QDRANT_APP_NAME is required}"

# Set subscription if provided
[ -n "${AZURE_SUBSCRIPTION_ID:-}" ] && az account set --subscription "$AZURE_SUBSCRIPTION_ID" 2>/dev/null || true

# ── Derived names ─────────────────────────────────────────────────────────────
BICEP_BASE_NAME="${BICEP_BASE_NAME:-${AZURE_API_APP_NAME%%-api}}"

# ── Resolve REDIS_URL if not set ──────────────────────────────────────────────
if [ -z "${REDIS_URL:-}" ]; then
  REDIS_NAME="${BICEP_BASE_NAME}-redis"
  REDIS_HOST=$(az redis show --name "$REDIS_NAME" --resource-group "$AZURE_RESOURCE_GROUP" \
    --query "hostName" --output tsv 2>/dev/null || true)
  if [ -n "$REDIS_HOST" ]; then
    REDIS_KEY=$(az redis list-keys --name "$REDIS_NAME" --resource-group "$AZURE_RESOURCE_GROUP" \
      --query "primaryKey" --output tsv 2>/dev/null || true)
    REDIS_URL="redis://default:${REDIS_KEY}@${REDIS_HOST}:6380?tls=true&abortConnect=false"
    echo "ℹ️  REDIS_URL resolved from Azure Redis: $REDIS_HOST"
  fi
fi

# ── Image tags ─────────────────────────────────────────────────────────────────
TIMESTAMP=$(date +"%Y%m%d.%H%M")
ACR="${AZURE_CONTAINER_REGISTRY}.azurecr.io"
API_IMAGE="${ACR}/api:${TIMESTAMP}"
WORKER_IMAGE="${ACR}/worker:${TIMESTAMP}"
# Qdrant: pull from Docker Hub, re-tag, push to ACR (enables ACR managed-identity pull)
QDRANT_SOURCE_IMAGE="qdrant/qdrant:latest"
QDRANT_IMAGE="${ACR}/qdrant:latest"
# Neo4j: pull from Docker Hub, re-tag, push to ACR (enables ACR managed-identity pull)
NEO4J_SOURCE_IMAGE="neo4j:5"
NEO4J_IMAGE="${ACR}/neo4j:5"

echo "🚀 Deploying API + Worker + Qdrant (Neo4j deployment is disabled)"
echo "   Resource Group : $AZURE_RESOURCE_GROUP"
echo "   API App        : $AZURE_API_APP_NAME"
echo "   Worker Job     : $AZURE_WORKER_JOB_NAME"
# echo "   Neo4j App      : $AZURE_NEO4J_APP_NAME"
echo "   Qdrant App     : $AZURE_QDRANT_APP_NAME"
echo "   API image      : $API_IMAGE"
echo "   Worker image   : $WORKER_IMAGE"
echo "   Qdrant image   : $QDRANT_IMAGE"
# echo "   Neo4j image    : $NEO4J_IMAGE"
echo ""

# ── Build & push ──────────────────────────────────────────────────────────────
echo "🔐 Logging in to ACR..."
az acr login --name "$AZURE_CONTAINER_REGISTRY"

echo "🏗️  Building and pushing API image..."
docker buildx build --platform linux/amd64 \
  -t "$API_IMAGE" -f packages/api/Dockerfile --push .

echo "🏗️  Building and pushing Worker image..."
docker buildx build --platform linux/amd64 \
  -t "$WORKER_IMAGE" -f packages/worker/Dockerfile --push .

echo "🏗️  Pulling Qdrant from Docker Hub and pushing to ACR..."
docker pull --platform linux/amd64 "$QDRANT_SOURCE_IMAGE"
docker tag "$QDRANT_SOURCE_IMAGE" "$QDRANT_IMAGE"
docker push "$QDRANT_IMAGE"

# echo "🏗️  Pulling Neo4j from Docker Hub and pushing to ACR..."
# docker pull --platform linux/amd64 "$NEO4J_SOURCE_IMAGE"
# docker tag "$NEO4J_SOURCE_IMAGE" "$NEO4J_IMAGE"
# docker push "$NEO4J_IMAGE"

# ── Update API Container App image ────────────────────────────────────────────
echo "🔄 Deploying API Container App..."

# Resolve the Container Apps environment ID from an existing container app (e.g. qdrant)
CAE_ID=$(az containerapp show \
  --name "$AZURE_QDRANT_APP_NAME" \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --query "properties.environmentId" --output tsv 2>/dev/null || true)

# Check if the API container app already exists
API_CA_EXISTS=$(az containerapp show \
  --name "$AZURE_API_APP_NAME" \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --query "name" --output tsv 2>/dev/null || true)

if [ -z "$API_CA_EXISTS" ]; then
  echo "   Creating new API Container App '$AZURE_API_APP_NAME'..."
  # Resolve config values (fall back to empty if not set)
  QDRANT_FQDN=$(az containerapp show --name "$AZURE_QDRANT_APP_NAME" --resource-group "$AZURE_RESOURCE_GROUP" \
    --query "properties.configuration.ingress.fqdn" --output tsv 2>/dev/null || true)
  QDRANT_URL="https://${QDRANT_FQDN}"
  NEO4J_FQDN=$(az containerapp show --name "$AZURE_NEO4J_APP_NAME" --resource-group "$AZURE_RESOURCE_GROUP" \
    --query "properties.configuration.ingress.fqdn" --output tsv 2>/dev/null || true)
  NEO4J_URL="bolt://${NEO4J_FQDN}:7474"
  WORKER_JOB_NAME="${AZURE_WORKER_JOB_NAME}"

  az containerapp create \
    --name "$AZURE_API_APP_NAME" \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --environment "$CAE_ID" \
    --image "$API_IMAGE" \
    --target-port 3001 \
    --ingress external \
    --transport http \
    --cpu 1 --memory 2Gi \
    --min-replicas 1 --max-replicas 3 \
    --registry-server "${ACR}" \
    --registry-identity system \
    --system-assigned \
    --env-vars \
      PORT=3001 \
      HTTPS=false \
      "QDRANT_URL=${QDRANT_URL}" \
      "QDRANT_API_KEY=${QDRANT_API_KEY:-}" \
      "REDIS_URL=${REDIS_URL:-}" \
      "TASK_COLLECTION_NAME=${TASK_COLLECTION_NAME:-agent_tasks}" \
      "CHAT_MESSAGE_COLLECTION_NAME=${CHAT_MESSAGE_COLLECTION_NAME:-chat_messages}" \
      "NEO4J_URI=${NEO4J_URL}" \
      "NEO4J_USERNAME=${NEO4J_USERNAME:-neo4j}" \
      "NEO4J_PASSWORD=${NEO4J_PASSWORD:-}" \
      "AZURE_SUBSCRIPTION_ID=${AZURE_SUBSCRIPTION_ID:-}" \
      "AZURE_RESOURCE_GROUP=${AZURE_RESOURCE_GROUP}" \
      "AZURE_CONTAINER_JOB_NAME=${WORKER_JOB_NAME}" \
      WORKER_ENVIRONMENT=azure \
      "UI_BASE_URL=${UI_BASE_URL:-}" \
      "AZURE_OPENAI_ENDPOINT=${AZURE_OPENAI_ENDPOINT:-}" \
      "AZURE_OPENAI_API_KEY=${AZURE_OPENAI_API_KEY:-}" \
      "AZURE_OPENAI_DEPLOYMENT=${AZURE_OPENAI_DEPLOYMENT:-}" \
      "AZURE_OPENAI_API_VERSION=${AZURE_OPENAI_API_VERSION:-}" \
      "AZURE_OPENAI_EMBEDDING_ENDPOINT=${AZURE_OPENAI_EMBEDDING_ENDPOINT:-}" \
      "AZURE_OPENAI_EMBEDDING_API_KEY=${AZURE_OPENAI_EMBEDDING_API_KEY:-}" \
      "AZURE_OPENAI_EMBEDDING_DEPLOYMENT=${AZURE_OPENAI_EMBEDDING_DEPLOYMENT:-}" \
      "AZURE_OPENAI_EMBEDDING_API_VERSION=${AZURE_OPENAI_EMBEDDING_API_VERSION:-}" \
      "SLACK_CLIENT_ID=${SLACK_CLIENT_ID:-}" \
      "SLACK_CLIENT_SECRET=${SLACK_CLIENT_SECRET:-}" \
      "SLACK_REDIRECT_URI=${SLACK_REDIRECT_URI:-}" \
      "GITHUB_APP_ID=${GITHUB_APP_ID:-}" \
      "GITHUB_APP_PRIVATE_KEY=${GITHUB_APP_PRIVATE_KEY:-}" \
      "GITHUB_APP_SLUG=${GITHUB_APP_SLUG:-}" \
      "GITHUB_REDIRECT_URI=${GITHUB_REDIRECT_URI:-}" \
      "ENTRA_ENABLED=${ENTRA_ENABLED:-false}" \
      "ENTRA_TENANT_ID=${ENTRA_TENANT_ID:-}" \
    --only-show-errors

  # Grant AcrPull to the new container app's managed identity
  echo "   Granting AcrPull role to API container app managed identity..."
  API_PRINCIPAL_ID=$(az containerapp show \
    --name "$AZURE_API_APP_NAME" \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --query "identity.principalId" --output tsv 2>/dev/null || true)
  ACR_ID=$(az acr show --name "$AZURE_CONTAINER_REGISTRY" --query id --output tsv 2>/dev/null || true)
  if [ -n "$API_PRINCIPAL_ID" ] && [ -n "$ACR_ID" ]; then
    az role assignment create \
      --assignee-object-id "$API_PRINCIPAL_ID" \
      --assignee-principal-type ServicePrincipal \
      --role "7f951dda-4ed3-4680-a7ca-43fe172d538d" \
      --scope "$ACR_ID" \
      --only-show-errors 2>/dev/null || true
    # Grant Contributor on resource group so API can trigger worker jobs
    RG_ID=$(az group show --name "$AZURE_RESOURCE_GROUP" --query id --output tsv 2>/dev/null || true)
    az role assignment create \
      --assignee-object-id "$API_PRINCIPAL_ID" \
      --assignee-principal-type ServicePrincipal \
      --role "b24988ac-6180-42a0-ab88-20f7382dd24c" \
      --scope "$RG_ID" \
      --only-show-errors 2>/dev/null || true
    echo "   Roles granted."
  fi
else
  echo "   Updating existing API Container App '$AZURE_API_APP_NAME'..."
  az containerapp update \
    --name "$AZURE_API_APP_NAME" \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --image "$API_IMAGE" \
    --only-show-errors
fi

# ── Update Worker Container Apps Job image ─────────────────────────────────────
echo "🔄 Updating Worker Job container image..."
az containerapp job update \
  --name "$AZURE_WORKER_JOB_NAME" \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --image "$WORKER_IMAGE" \
  --only-show-errors

# ── Update Neo4j Container App image (disabled) ───────────────────────────────
# echo "🔄 Updating Neo4j Container App image..."
# az containerapp update \
#   --name "$AZURE_NEO4J_APP_NAME" \
#   --resource-group "$AZURE_RESOURCE_GROUP" \
#   --image "$NEO4J_IMAGE" \
#   --only-show-errors

# ── Update Qdrant Container App image ─────────────────────────────────────────
echo "🔄 Updating Qdrant Container App image..."
az containerapp update \
  --name "$AZURE_QDRANT_APP_NAME" \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --image "$QDRANT_IMAGE" \
  --only-show-errors

# ── Get API URL ────────────────────────────────────────────────────────────────
API_URL="https://$(az containerapp show \
  --name "$AZURE_API_APP_NAME" \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --query "properties.configuration.ingress.fqdn" --output tsv)"

echo ""
echo "✅ API deployed!"
echo "   URL          : $API_URL"
echo "   Worker Job   : $AZURE_WORKER_JOB_NAME"
# echo "   Neo4j App    : $AZURE_NEO4J_APP_NAME"
echo "   Qdrant App   : $AZURE_QDRANT_APP_NAME"
echo ""
echo "📝 Useful commands:"
echo "   Tail API logs  : az containerapp logs show --name $AZURE_API_APP_NAME --resource-group $AZURE_RESOURCE_GROUP --follow"
echo "   Health check   : curl $API_URL/health"
