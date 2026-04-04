// Storage account with:
//   - Azure File Share for Qdrant persistent data
//   - Azure File Share for Neo4j persistent data
//   - Static website hosting for the UI (SPA)

@description('Short base name used to derive resource names.')
param baseName string

@description('Azure region.')
param location string

@description('Resource tags.')
param tags object = {}

@description('Override the derived storage account name (to adopt an existing account).')
param storageAccountNameOverride string = ''

// Derive a valid storage account name: lowercase alphanumeric, max 24 chars.
var derivedStorageName = '${take(toLower(replace(replace(replace(baseName, '-', ''), '_', ''), '.', '')), 20)}stor'
var resolvedStorageName = empty(storageAccountNameOverride) ? derivedStorageName : storageAccountNameOverride

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: resolvedStorageName
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    // Must allow blob public access for static website hosting
    allowBlobPublicAccess: true
    supportsHttpsTrafficOnly: true
  }
}

// ── Blob service ──────────────────────────────────────────────────────────────
// NOTE: Static website hosting cannot be enabled via the ARM management-plane API
// (the 'staticWebsite' property is a data-plane setting).  It is enabled by the
// setup-azure.sh script using:
//   az storage blob service-properties update --static-website ...
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  parent: storageAccount
  name: 'default'
  properties: {}
}

// ── File service ──────────────────────────────────────────────────────────────
resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2023-01-01' = {
  parent: storageAccount
  name: 'default'
}

// ── File share: Qdrant ────────────────────────────────────────────────────────
resource qdrantShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-01-01' = {
  parent: fileService
  name: 'qdrant-data'
  properties: { shareQuota: 10 }
}

// ── File share: Neo4j ─────────────────────────────────────────────────────────
resource neo4jShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-01-01' = {
  parent: fileService
  name: 'neo4j-data'
  properties: { shareQuota: 20 }
}

output storageAccountId string = storageAccount.id
output storageAccountName string = storageAccount.name
output storageKey string = storageAccount.listKeys().keys[0].value
output shareName string = qdrantShare.name
output neo4jShareName string = neo4jShare.name
output staticWebsiteUrl string = storageAccount.properties.primaryEndpoints.web
