// Azure Cache for Redis — Basic C0 (cheapest tier, suitable for dev/staging)
// Basic tier: single node, no SLA, no replication, no geo-replication.
// C0 = 250 MB cache, 256 connections.

@description('Short base name used to derive resource names.')
param baseName string

@description('Azure region.')
param location string

@description('Resource tags.')
param tags object = {}

@description('Override the derived Redis name (to adopt an existing instance).')
param redisNameOverride string = ''

// Derive a valid Redis name: 1-63 chars, lowercase alphanumeric and hyphens only.
var derivedRedisName = '${toLower(replace(replace(baseName, '_', '-'), '.', '-'))}-redis'
var resolvedRedisName = empty(redisNameOverride) ? derivedRedisName : redisNameOverride

resource redisCache 'Microsoft.Cache/redis@2024-03-01' = {
  name: resolvedRedisName
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'Basic'
      family: 'C'
      capacity: 0  // C0 — smallest and most cost-effective
    }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
    redisConfiguration: {
      'maxmemory-policy': 'allkeys-lru'
    }
    publicNetworkAccess: 'Enabled'
  }
}

// Build the rediss:// connection string from the primary key
var redisKey  = redisCache.listKeys().primaryKey
var redisHost = redisCache.properties.hostName
var redisPort = redisCache.properties.sslPort

output redisName       string = redisCache.name
output redisHostName   string = redisHost
output redisSslPort    int    = redisPort
// Full connection URL usable by ioredis / redis clients
output redisUrl        string = 'rediss://:${redisKey}@${redisHost}:${redisPort}'
