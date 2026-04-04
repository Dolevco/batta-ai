// Azure Container Registry used to store all application images.

@description('Short base name used to derive resource names.')
param baseName string

@description('Azure region.')
param location string

@description('Resource tags.')
param tags object = {}

@description('Override the derived ACR name (useful when adopting an existing registry).')
param acrName string = ''

// Derive ACR name: 5-50 chars, lowercase alphanumeric only
var derivedAcrName = take(toLower(replace(replace(replace(baseName, '-', ''), '_', ''), '.', '')), 50)
var resolvedAcrName = empty(acrName) ? derivedAcrName : acrName

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: resolvedAcrName
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

output registryId string = registry.id
output registryName string = registry.name
output loginServer string = registry.properties.loginServer
