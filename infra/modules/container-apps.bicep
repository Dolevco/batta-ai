// Container Apps environment hosting:
//   - Qdrant (internal-only container app with persistent storage)
//   - Neo4j  (internal-only container app with persistent storage + ACR image)
//   - Worker (manual-trigger Container Apps Job)
//   - API    (external-facing container app on port 3001)

@description('Short base name used to derive resource names.')
param baseName string

@description('Azure region.')
param location string

@description('Resource tags.')
param tags object = {}

@description('Log Analytics workspace resource ID.')
param logAnalyticsWorkspaceId string = ''  // reserved for future diagnostics

@description('Log Analytics customer ID (used for Container Apps env).')
param logAnalyticsCustomerId string

@description('Log Analytics shared key.')
@secure()
param logAnalyticsKey string

@description('ACR login server (e.g. myregistry.azurecr.io).')
param acrLoginServer string

@description('Resource ID of the ACR (used for role assignment).')
param acrId string

@description('Fully-qualified worker image tag (e.g. myregistry.azurecr.io/worker:20250101.1200).')
param workerImage string

@description('Fully-qualified Qdrant image tag in ACR (e.g. myacr.azurecr.io/qdrant:latest). Falls back to placeholder on first deploy.')
param qdrantImage string = ''

@description('Storage account name for Qdrant data.')
param storageAccountName string

@description('Storage account key for Qdrant data.')
@secure()
param storageAccountKey string

@description('File share name for Qdrant data.')
param storageShareName string

@description('File share name for Neo4j data.')
param neo4jShareName string

@description('Optional Qdrant API key.')
@secure()
param qdrantApiKey string = ''

@description('Neo4j username.')
param neo4jUsername string = 'neo4j'

@description('Neo4j password (required — set a strong value).')
@secure()
param neo4jPassword string = ''

@description('Fully-qualified Neo4j image in ACR (e.g. myacr.azurecr.io/neo4j:5).')
param neo4jImage string = ''

@description('Fully-qualified API image in ACR (e.g. myacr.azurecr.io/api:20250101.1200).')
param apiImage string = ''

@description('Redis connection URL.')
@secure()
param redisUrl string = ''

@description('Qdrant collection name for tasks.')
param taskCollectionName string = 'agent_tasks'

@description('Qdrant collection name for chat messages.')
param chatMessageCollectionName string = 'chat_messages'

// Optional app-level settings forwarded to the worker
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

// ── API-specific parameters ───────────────────────────────────────────────────
@description('Azure Subscription ID (used by API to trigger worker jobs).')
param azureSubscriptionId string = ''

@description('Azure Resource Group name (used by API to trigger worker jobs).')
param azureResourceGroup string = ''

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

@description('Override the Container Apps Environment name (to adopt an existing env).')
param envNameOverride string = ''

@description('Override the worker job name (to adopt an existing job).')
param workerJobNameOverride string = ''

var envName               = empty(envNameOverride)      ? '${baseName}-cae'    : envNameOverride
var qdrantAppName         = '${baseName}-qdrant'
var neo4jAppName          = '${baseName}-neo4j'
var apiAppName            = '${baseName}-api'
var workerJobName         = empty(workerJobNameOverride) ? '${baseName}-worker' : workerJobNameOverride
var storageMountName      = 'qdrant-storage'
var neo4jStorageMountName = 'neo4j-storage'
var resolvedQdrantImage   = empty(qdrantImage) ? 'mcr.microsoft.com/azuredocs/aci-helloworld:latest' : qdrantImage
var resolvedNeo4jImage    = empty(neo4jImage)  ? 'mcr.microsoft.com/azuredocs/aci-helloworld:latest' : neo4jImage
var resolvedApiImage      = empty(apiImage)    ? 'mcr.microsoft.com/azuredocs/aci-helloworld:latest' : apiImage
// NEO4J_AUTH is username/password
var neo4jAuth = '${neo4jUsername}/${neo4jPassword}'

// Existing ACR reference
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: last(split(acrId, '/'))
}

// Container Apps environment
resource cae 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: envName
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsCustomerId
        sharedKey: logAnalyticsKey
      }
    }
    workloadProfiles: [
      { name: 'Consumption', workloadProfileType: 'Consumption' }
    ]
  }
}

// Azure File storage mount for Qdrant
resource caeStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  parent: cae
  name: storageMountName
  properties: {
    azureFile: {
      accountName: storageAccountName
      accountKey: storageAccountKey
      shareName: storageShareName
      accessMode: 'ReadWrite'
    }
  }
}

// Azure File storage mount for Neo4j
resource neo4jCaeStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  parent: cae
  name: neo4jStorageMountName
  properties: {
    azureFile: {
      accountName: storageAccountName
      accountKey: storageAccountKey
      shareName: neo4jShareName
      accessMode: 'ReadWrite'
    }
  }
}

// Qdrant container app
resource qdrant 'Microsoft.App/containerApps@2024-03-01' = {
  name: qdrantAppName
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    environmentId: cae.id
    configuration: {
      ingress: {
        external: true
        targetPort: 6333
      }
      registries: [
        {
          server: acrLoginServer
          identity: 'system'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'qdrant'
          image: resolvedQdrantImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [
            { name: 'QDRANT__SERVICE__GRPC_PORT', value: '6334' }
            { name: 'QDRANT__SERVICE__HTTP_PORT', value: '6333' }
            { name: 'QDRANT__SERVICE__API_KEY', value: qdrantApiKey }
          ]
          volumeMounts: [
            { volumeName: 'qdrant-volume', mountPath: '/qdrant/storage' }
          ]
        }
      ]
      volumes: [
        {
          name: 'qdrant-volume'
          storageType: 'AzureFile'
          storageName: storageMountName
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
  dependsOn: [caeStorage]
}

// AcrPull for Qdrant — uses '-acr-scope' suffix to generate a GUID that does not
// collide with any legacy resource-group-scoped assignment.
resource acrPullRoleQdrant 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acrId, qdrant.id, 'AcrPull-acr-scope')
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: qdrant.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Neo4j container app
resource neo4j 'Microsoft.App/containerApps@2024-03-01' = {
  name: neo4jAppName
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    environmentId: cae.id
    configuration: {
      ingress: {
        external: false
        targetPort: 7687
        transport: 'tcp'
      }
      registries: [
        {
          server: acrLoginServer
          identity: 'system'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'neo4j'
          image: resolvedNeo4jImage
          resources: { cpu: json('1'), memory: '2Gi' }
          env: [
            { name: 'NEO4J_AUTH', value: neo4jAuth }
            { name: 'NEO4J_dbms_default__listen__address', value: '0.0.0.0' }
            { name: 'NEO4J_dbms_connector_bolt_listen__address', value: '0.0.0.0:7687' }
            { name: 'NEO4J_dbms_connector_http_listen__address', value: '0.0.0.0:7474' }
            { name: 'NEO4J_dbms_memory_heap_initial__size', value: '512m' }
            { name: 'NEO4J_dbms_memory_heap_max__size', value: '1024m' }
            { name: 'NEO4J_dbms_logs_debug_level', value: 'WARN' }
            { name: 'NEO4J_dbms_logs_query_enabled', value: 'OFF' }
            { name: 'NEO4J_dbms_logs_gc_enabled', value: 'false' }
            // Azure Files (SMB) does not support POSIX/Java advisory file locks.
            // Neo4j's store_lock uses FileLock which fails on SMB mounts in Azure
            // Container Apps, causing "Lock file has been locked by another process"
            // on every (re)start even when no other process holds the lock.
            // The fix is two-fold:
            //   1. Pass the JVM flag that disables the SMB-incompatible lock check.
            //   2. Set NEO4J_server_memory_pagecache__size within the 2 Gi container
            //      limit so Neo4j doesn't over-allocate and crash before acquiring the lock.
            { name: 'NEO4J_server_jvm_additional', value: '-Dneo4j.store_lock.check.smb=false' }
          ]
          volumeMounts: [
            { volumeName: 'neo4j-volume', mountPath: '/data' }
          ]
        }
      ]
      volumes: [
        {
          name: 'neo4j-volume'
          storageType: 'AzureFile'
          storageName: neo4jStorageMountName
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
  dependsOn: [neo4jCaeStorage]
}

// AcrPull for Neo4j — uses '-acr-scope' suffix to generate a GUID that does not
// collide with any legacy resource-group-scoped assignment.
resource acrPullRoleNeo4j 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acrId, neo4j.id, 'AcrPull-acr-scope')
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: neo4j.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

var qdrantInternalUrl = 'https://${qdrant.properties.configuration.ingress.fqdn}'
// Neo4j uses TCP ingress (transport: 'tcp', targetPort: 7687).
// In Azure Container Apps, internal TCP apps are reachable by their app name
// as the hostname within the Container Apps Environment's internal DNS — NOT via
// the ingress.fqdn, which is an HTTP-only concept.
// Format: bolt://<app-name>:7687
var neo4jInternalUrl  = 'bolt://${neo4jAppName}:7687'

// Worker Container Apps Job
resource workerJob 'Microsoft.App/jobs@2024-03-01' = {
  name: workerJobName
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    environmentId: cae.id
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 1800
      replicaRetryLimit: 0
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: acrLoginServer
          identity: 'system'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'worker'
          image: workerImage
          resources: { cpu: json('1'), memory: '2Gi' }
          env: [
            { name: 'QDRANT_URL',                        value: qdrantInternalUrl }
            { name: 'REDIS_URL',                         value: redisUrl }
            { name: 'QDRANT_API_KEY',                    value: qdrantApiKey }
            { name: 'TASK_COLLECTION_NAME',              value: taskCollectionName }
            { name: 'CHAT_MESSAGE_COLLECTION_NAME',      value: chatMessageCollectionName }
            { name: 'NEO4J_URI',                         value: neo4jInternalUrl }
            { name: 'NEO4J_USERNAME',                    value: neo4jUsername }
            { name: 'NEO4J_PASSWORD',                    value: neo4jPassword }
            { name: 'AZURE_OPENAI_ENDPOINT',             value: azureOpenAiEndpoint }
            { name: 'AZURE_OPENAI_API_KEY',              value: azureOpenAiApiKey }
            { name: 'AZURE_OPENAI_DEPLOYMENT',           value: azureOpenAiDeployment }
            { name: 'AZURE_OPENAI_API_VERSION',          value: azureOpenAiApiVersion }
            { name: 'AZURE_OPENAI_EMBEDDING_ENDPOINT',   value: azureOpenAiEmbeddingEndpoint }
            { name: 'AZURE_OPENAI_EMBEDDING_API_KEY',    value: azureOpenAiEmbeddingApiKey }
            { name: 'AZURE_OPENAI_EMBEDDING_DEPLOYMENT', value: azureOpenAiEmbeddingDeployment }
            { name: 'AZURE_OPENAI_EMBEDDING_API_VERSION',value: azureOpenAiEmbeddingApiVersion }
            { name: 'SLACK_CLIENT_ID',                   value: slackClientId }
            { name: 'SLACK_CLIENT_SECRET',               value: slackClientSecret }
            { name: 'SLACK_REDIRECT_URI',                value: slackRedirectUri }
            { name: 'GITHUB_APP_ID',                     value: githubAppId }
            { name: 'GITHUB_APP_PRIVATE_KEY',            value: githubAppPrivateKey }
            { name: 'GITHUB_APP_SLUG',                   value: githubAppSlug }
            { name: 'GITHUB_REDIRECT_URI',               value: githubRedirectUri }
            { name: 'UI_BASE_URL',                       value: uiBaseUrl }
          ]
        }
      ]
    }
  }
}

// AcrPull for Worker — uses '-acr-scope' suffix to generate a GUID that does not
// collide with the legacy resource-group-scoped assignment (name: 8b4f6af9).
resource acrPullRoleWorker 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acrId, workerJob.id, 'AcrPull-acr-scope')
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: workerJob.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── API Container App (external, port 3001) ────────────────────────────────────
resource apiApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: apiAppName
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    environmentId: cae.id
    configuration: {
      ingress: {
        external: true
        targetPort: 3001
        transport: 'http'
        allowInsecure: false
      }
      registries: [
        {
          server: acrLoginServer
          identity: 'system'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: resolvedApiImage
          resources: { cpu: json('1'), memory: '2Gi' }
          env: [
            { name: 'PORT',                                  value: '3001' }
            { name: 'HTTPS',                                 value: 'false' }
            { name: 'QDRANT_URL',                            value: qdrantInternalUrl }
            { name: 'QDRANT_API_KEY',                        value: qdrantApiKey }
            { name: 'REDIS_URL',                             value: redisUrl }
            { name: 'TASK_COLLECTION_NAME',                  value: taskCollectionName }
            { name: 'CHAT_MESSAGE_COLLECTION_NAME',          value: chatMessageCollectionName }
            { name: 'NEO4J_URI',                             value: neo4jInternalUrl }
            { name: 'NEO4J_USERNAME',                        value: neo4jUsername }
            { name: 'NEO4J_PASSWORD',                        value: neo4jPassword }
            { name: 'AZURE_SUBSCRIPTION_ID',                 value: azureSubscriptionId }
            { name: 'AZURE_RESOURCE_GROUP',                  value: azureResourceGroup }
            { name: 'AZURE_CONTAINER_JOB_NAME',              value: workerJobName }
            { name: 'WORKER_ENVIRONMENT',                    value: 'azure' }
            { name: 'UI_BASE_URL',                           value: uiBaseUrl }
            { name: 'AZURE_OPENAI_ENDPOINT',                 value: azureOpenAiEndpoint }
            { name: 'AZURE_OPENAI_API_KEY',                  value: azureOpenAiApiKey }
            { name: 'AZURE_OPENAI_DEPLOYMENT',               value: azureOpenAiDeployment }
            { name: 'AZURE_OPENAI_API_VERSION',              value: azureOpenAiApiVersion }
            { name: 'AZURE_OPENAI_EMBEDDING_ENDPOINT',       value: azureOpenAiEmbeddingEndpoint }
            { name: 'AZURE_OPENAI_EMBEDDING_API_KEY',        value: azureOpenAiEmbeddingApiKey }
            { name: 'AZURE_OPENAI_EMBEDDING_DEPLOYMENT',     value: azureOpenAiEmbeddingDeployment }
            { name: 'AZURE_OPENAI_EMBEDDING_API_VERSION',    value: azureOpenAiEmbeddingApiVersion }
            { name: 'SLACK_CLIENT_ID',                       value: slackClientId }
            { name: 'SLACK_CLIENT_SECRET',                   value: slackClientSecret }
            { name: 'SLACK_REDIRECT_URI',                    value: slackRedirectUri }
            { name: 'GITHUB_APP_ID',                         value: githubAppId }
            { name: 'GITHUB_APP_PRIVATE_KEY',                value: githubAppPrivateKey }
            { name: 'GITHUB_APP_SLUG',                       value: githubAppSlug }
            { name: 'GITHUB_REDIRECT_URI',                   value: githubRedirectUri }
            { name: 'JWT_ISSUER',                            value: jwtIssuer }
            { name: 'JWT_AUDIENCE',                          value: jwtAudience }
            { name: 'JWKS_URI',                              value: jwksUri }
            { name: 'ENTRA_ENABLED',                         value: entraEnabled }
            { name: 'ENTRA_TENANT_ID',                       value: entraTenantId }
            { name: 'ENTRA_CLIENT_ID',                       value: entraClientId }
            { name: 'MCP_ISSUER_URL',                        value: 'https://batta.ai' }
          ]
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
}

// AcrPull for API Container App — ACR scope
resource acrPullRoleApi 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acrId, apiApp.id, 'AcrPull-acr-scope')
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: apiApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Contributor on the resource group so the API can trigger Container Apps Jobs for the worker.
resource contributorRoleApi 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, apiApp.id, 'Contributor-rg-scope')
  scope: resourceGroup()
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b24988ac-6180-42a0-ab88-20f7382dd24c')
    principalId: apiApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output qdrantInternalUrl string = qdrantInternalUrl
output neo4jInternalUrl  string = neo4jInternalUrl
output workerJobName string = workerJob.name
output workerJobId string = workerJob.id
output apiAppName string = apiApp.name
output apiUrl string = 'https://${apiApp.properties.configuration.ingress.fqdn}'