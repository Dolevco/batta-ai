// Log Analytics workspace used by the Container Apps environment for diagnostics and monitoring.

@description('Short base name used to derive resource names.')
param baseName string

@description('Azure region.')
param location string

@description('Resource tags.')
param tags object = {}

resource workspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: '${baseName}-logs'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

output workspaceId string = workspace.id
output workspaceName string = workspace.name
output customerId string = workspace.properties.customerId
output primarySharedKey string = workspace.listKeys().primarySharedKey
