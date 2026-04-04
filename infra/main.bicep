// main.bicep — Orchestrates all AI Agent infrastructure resources.
//
// Deployed resources:
//   - Log Analytics workspace
//   - Azure Container Registry
//   - Storage account + file shares (Qdrant + Neo4j data) + static website (UI)
//   - Container Apps environment (Qdrant + Neo4j + Worker Job + API)
//
// Usage (initial setup):
//   az deployment group create \
//     --resource-group <rg> \
//     --template-file infra/main.bicep \
//     --parameters @infra/main.bicepparam
//
// Usage (rolling image update — supply new image tags):
//   az deployment group create \
//     --resource-group <rg> \
//     --template-file infra/main.bicep \
//     --parameters @infra/main.bicepparam \
//     --parameters apiImage=<acr>/api:<tag> workerImage=<acr>/worker:<tag>

targetScope = 'resourceGroup'

// ── Core identity ─────────────────────────────────────────────────────────────
@description('Short base name used to derive all resource names (e.g. "ai-agent-prod").')
param baseName string

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Resource tags applied to every resource.')
param tags object = { project: 'ai-agent', managedBy: 'bicep' }

// ── Name overrides (for adopting existing resources) ──────────────────────────
@description('Override the derived ACR name. Set this when an existing registry is in use.')
param acrName string = ''

@description('Override the Container Apps Environment name. Set to adopt an existing environment.')
param containerAppsEnvName string = ''

@description('Override the worker Container Apps Job name. Set to adopt an existing job.')
param workerJobNameOverride string = ''

@description('Override the derived storage account name. Set to adopt an existing storage account.')
param storageAccountNameOverride string = ''

@description('Override the derived Redis cache name. Set to adopt an existing cache instance.')
param redisNameOverride string = ''

// ── Images ────────────────────────────────────────────────────────────────────
@description('Fully-qualified API image (e.g. myacr.azurecr.io/api:20250101.1200). Leave empty on first deploy to use a placeholder.')
param apiImage string = ''

@description('Fully-qualified Worker image (e.g. myacr.azurecr.io/worker:20250101.1200). Leave empty on first deploy to use a placeholder.')
param workerImage string = ''

@description('Fully-qualified Qdrant image in ACR (e.g. myacr.azurecr.io/qdrant:latest). Leave empty on first deploy; will be pushed by setup-azure.sh.')
param qdrantImage string = ''

@description('Fully-qualified Neo4j image in ACR (e.g. myacr.azurecr.io/neo4j:5). Leave empty on first deploy; will be pushed by setup-azure.sh.')
param neo4jImage string = ''

// ── App configuration ─────────────────────────────────────────────────────────
// redisUrl: if left empty, a managed Azure Cache for Redis (Basic C0) is deployed
// automatically and its connection string is used.  Supply a value here only to
// adopt an externally-managed Redis instance.
@secure()
param redisUrl string = ''

@secure()
param qdrantApiKey string = ''

@description('Neo4j username for the graph database.')
param neo4jUsername string = 'neo4j'

@description('Neo4j password for the graph database (set a strong value).')
@secure()
param neo4jPassword string = ''

param taskCollectionName string = 'agent_tasks'
param chatMessageCollectionName string = 'chat_messages'

@secure()
param azureOpenAiEndpoint string = ''
@secure()
param azureOpenAiApiKey string = ''
param azureOpenAiDeployment string = ''
param azureOpenAiApiVersion string = '2024-02-01'
@secure()
param azureOpenAiEmbeddingEndpoint string = ''
@secure()
param azureOpenAiEmbeddingApiKey string = ''
param azureOpenAiEmbeddingDeployment string = ''
param azureOpenAiEmbeddingApiVersion string = ''

@secure()
param slackClientId string = ''
@secure()
param slackClientSecret string = ''
param slackRedirectUri string = ''

param githubAppId string = ''
@secure()
param githubAppPrivateKey string = ''
param githubAppSlug string = ''
param githubRedirectUri string = ''

param uiBaseUrl string = ''

@secure()
param jwtIssuer string = ''
@secure()
param jwtAudience string = ''
@secure()
param jwksUri string = ''
param entraEnabled string = 'false'
@secure()
param entraTenantId string = ''
@secure()
param entraClientId string = ''

// ── Modules ───────────────────────────────────────────────────────────────────

module logs 'modules/log-analytics.bicep' = {
  name: 'logs'
  params: { baseName: baseName, location: location, tags: tags }
}

module registry 'modules/registry.bicep' = {
  name: 'registry'
  params: { baseName: baseName, location: location, tags: tags, acrName: acrName }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: { baseName: baseName, location: location, tags: tags, storageAccountNameOverride: storageAccountNameOverride }
}

// ── Redis ─────────────────────────────────────────────────────────────────────
// Deploy a managed Azure Cache for Redis (Basic C0) when no external Redis URL
// is supplied.  On re-runs with an existing external Redis, the module is still
// deployed but the resolvedRedisUrl below prefers the caller-supplied value.
module redis 'modules/redis.bicep' = {
  name: 'redis'
  params: { baseName: baseName, location: location, tags: tags, redisNameOverride: redisNameOverride }
}

// Prefer an externally supplied Redis URL; fall back to the managed instance.
var resolvedRedisUrl = empty(redisUrl) ? redis.outputs.redisUrl : redisUrl

// Use placeholder images on first deploy so ARM doesn't fail before images are pushed.
var resolvedApiImage    = empty(apiImage)    ? 'mcr.microsoft.com/azuredocs/aci-helloworld:latest' : apiImage
var resolvedWorkerImage = empty(workerImage) ? 'mcr.microsoft.com/azuredocs/aci-helloworld:latest' : workerImage
// qdrant image — if empty, the container app will use the placeholder until deploy-api.sh pushes the real image.
var resolvedQdrantImage = empty(qdrantImage) ? 'mcr.microsoft.com/azuredocs/aci-helloworld:latest' : qdrantImage
// neo4j image — if empty, the container app will use the placeholder until deploy-api.sh pushes the real image.
var resolvedNeo4jImage  = empty(neo4jImage)  ? 'mcr.microsoft.com/azuredocs/aci-helloworld:latest' : neo4jImage

module containerApps 'modules/container-apps.bicep' = {
  name: 'container-apps'
  params: {
    baseName: baseName
    location: location
    tags: tags
    logAnalyticsWorkspaceId: logs.outputs.workspaceId
    logAnalyticsCustomerId: logs.outputs.customerId
    logAnalyticsKey: logs.outputs.primarySharedKey
    acrLoginServer: registry.outputs.loginServer
    acrId: registry.outputs.registryId
    workerImage: resolvedWorkerImage
    neo4jImage: resolvedNeo4jImage
    qdrantImage: resolvedQdrantImage
    apiImage: resolvedApiImage
    storageAccountName: storage.outputs.storageAccountName
    storageAccountKey: storage.outputs.storageKey
    storageShareName: storage.outputs.shareName
    neo4jShareName: storage.outputs.neo4jShareName
    qdrantApiKey: qdrantApiKey
    neo4jUsername: neo4jUsername
    neo4jPassword: neo4jPassword
    redisUrl: resolvedRedisUrl
    taskCollectionName: taskCollectionName
    chatMessageCollectionName: chatMessageCollectionName
    azureOpenAiEndpoint: azureOpenAiEndpoint
    azureOpenAiApiKey: azureOpenAiApiKey
    azureOpenAiDeployment: azureOpenAiDeployment
    azureOpenAiApiVersion: azureOpenAiApiVersion
    azureOpenAiEmbeddingEndpoint: azureOpenAiEmbeddingEndpoint
    azureOpenAiEmbeddingApiKey: azureOpenAiEmbeddingApiKey
    azureOpenAiEmbeddingDeployment: azureOpenAiEmbeddingDeployment
    azureOpenAiEmbeddingApiVersion: azureOpenAiEmbeddingApiVersion
    slackClientId: slackClientId
    slackClientSecret: slackClientSecret
    slackRedirectUri: slackRedirectUri
    githubAppId: githubAppId
    githubAppPrivateKey: githubAppPrivateKey
    githubAppSlug: githubAppSlug
    githubRedirectUri: githubRedirectUri
    uiBaseUrl: uiBaseUrl
    azureSubscriptionId: subscription().subscriptionId
    azureResourceGroup: resourceGroup().name
    jwtIssuer: jwtIssuer
    jwtAudience: jwtAudience
    jwksUri: jwksUri
    entraEnabled: entraEnabled
    entraTenantId: entraTenantId
    entraClientId: entraClientId
    envNameOverride: containerAppsEnvName
    workerJobNameOverride: workerJobNameOverride
  }
}

// ── Outputs ───────────────────────────────────────────────────────────────────
output acrLoginServer  string = registry.outputs.loginServer
output acrName         string = registry.outputs.registryName
output apiUrl          string = containerApps.outputs.apiUrl
output uiUrl           string = storage.outputs.staticWebsiteUrl
output apiAppName      string = containerApps.outputs.apiAppName
output storageAccount  string = storage.outputs.storageAccountName
output workerJobName   string = containerApps.outputs.workerJobName
output qdrantUrl       string = containerApps.outputs.qdrantInternalUrl
output neo4jUrl        string = containerApps.outputs.neo4jInternalUrl
output redisName       string = redis.outputs.redisName
output redisHostName   string = redis.outputs.redisHostName
// Note: redisUrl contains the primary key and is marked @secure to prevent it being
// stored in deployment history in plaintext. Use az redis list-keys to retrieve the key.
@secure()
output redisUrl        string = resolvedRedisUrl
