/**
 * Azure Network Fetcher
 *
 * Fetches Azure networking topology: VNet peerings, NSG rules, private endpoints,
 * service endpoints per subnet, and resource-level firewall rules for Storage,
 * SQL, Cosmos DB, and Key Vault.
 *
 * All queries run against Azure Resource Graph — no extra ARM calls needed.
 *
 * Security:
 *  - Raw API error bodies are never propagated — only HTTP status codes.
 *  - CIDR values are passed through as-is; normalisation occurs in node-sanitizer.
 */

import {
  NetworkTopology,
  RawVNetPeering,
  RawNsgRuleSet,
  RawNsgRule,
  RawPrivateEndpoint,
  RawServiceEndpoint,
  RawFirewallRules,
} from '@batta/shared';
import { CloudGraphFetchError } from './azure-ingress.fetcher';

type AnyRecord = Record<string, any>;

// ============================================================================
// Public surface
// ============================================================================

export async function fetchAzureNetworkTopology(
  token: string,
  subscriptionIds: string[],
): Promise<NetworkTopology> {
  const [peerings, nsgRules, privateEndpoints, serviceEndpoints, firewallRules] = await Promise.all([
    fetchVNetPeerings(token, subscriptionIds),
    fetchNsgRules(token, subscriptionIds),
    fetchPrivateEndpoints(token, subscriptionIds),
    fetchServiceEndpoints(token, subscriptionIds),
    fetchFirewallRules(token, subscriptionIds),
  ]);

  const result: NetworkTopology = { vnetPeerings: peerings, nsgRules, privateEndpoints, serviceEndpoints, firewallRules };
  return result;
}

// ============================================================================
// ARG helper
// ============================================================================

async function argQuery(token: string, subscriptionIds: string[], query: string): Promise<AnyRecord[]> {
  const response = await fetch(
    'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(subscriptionIds.length > 0 && { subscriptions: subscriptionIds }), query, options: { resultFormat: 'objectArray' } }),
    },
  );
  if (!response.ok) {
    throw new CloudGraphFetchError('azure', 'networkTopology', `HTTP_${response.status}`);
  }
  const data = await response.json() as { data: AnyRecord[] };
  return data.data ?? [];
}

// ============================================================================
// VNet peerings
// ============================================================================

async function fetchVNetPeerings(token: string, subscriptionIds: string[]): Promise<RawVNetPeering[]> {
  const query = `
    resources
    | where type =~ 'microsoft.network/virtualnetworks'
    | mv-expand peering = properties.virtualNetworkPeerings
    | project
        vnetId              = id,
        peeringState        = peering.properties.peeringState,
        remoteVnetId        = peering.properties.remoteVirtualNetwork.id,
        allowGatewayTransit = peering.properties.allowGatewayTransit,
        allowForwarded      = peering.properties.allowForwardedTraffic,
        useRemoteGateways   = peering.properties.useRemoteGateways
  `;
  const rows = await argQuery(token, subscriptionIds, query);

  return rows.map(row => ({
    vnetId: row.vnetId ?? '',
    peeringState: row.peeringState ?? 'Unknown',
    remoteVnetId: row.remoteVnetId ?? '',
    allowGatewayTransit: row.allowGatewayTransit === true,
    allowForwardedTraffic: row.allowForwarded === true,
    useRemoteGateways: row.useRemoteGateways === true,
  } satisfies RawVNetPeering));
}

// ============================================================================
// NSG rules
// ============================================================================

async function fetchNsgRules(token: string, subscriptionIds: string[]): Promise<RawNsgRuleSet[]> {
  const query = `
    resources
    | where type =~ 'microsoft.network/networksecuritygroups'
    | mv-expand rule = array_concat(
        properties.securityRules,
        properties.defaultSecurityRules
      )
    | project
        nsgId     = id,
        nsgName   = name,
        ruleName  = rule.name,
        direction = rule.properties.direction,
        priority  = toint(rule.properties.priority),
        protocol  = rule.properties.protocol,
        access    = rule.properties.access,
        srcPrefix = rule.properties.sourceAddressPrefix,
        srcPrefixes = rule.properties.sourceAddressPrefixes,
        dstPrefix = rule.properties.destinationAddressPrefix,
        dstPrefixes = rule.properties.destinationAddressPrefixes,
        dstPort   = rule.properties.destinationPortRange,
        dstPorts  = rule.properties.destinationPortRanges
  `;
  const rows = await argQuery(token, subscriptionIds, query);

  // Group by NSG ID
  const nsgMap = new Map<string, RawNsgRuleSet>();
  for (const row of rows) {
    const nsgId: string = row.nsgId ?? '';
    if (!nsgMap.has(nsgId)) {
      nsgMap.set(nsgId, { nsgId, nsgName: row.nsgName ?? '', rules: [] });
    }
    nsgMap.get(nsgId)!.rules.push({
      ruleName: row.ruleName ?? '',
      direction: row.direction ?? 'Inbound',
      priority: Number(row.priority ?? 0),
      protocol: row.protocol ?? '*',
      access: row.access ?? 'Deny',
      srcPrefix: row.srcPrefix ?? '',
      srcPrefixes: Array.isArray(row.srcPrefixes) ? row.srcPrefixes : [],
      dstPrefix: row.dstPrefix ?? '',
      dstPrefixes: Array.isArray(row.dstPrefixes) ? row.dstPrefixes : [],
      dstPort: row.dstPort ?? '',
      dstPorts: Array.isArray(row.dstPorts) ? row.dstPorts : [],
    } satisfies RawNsgRule);
  }
  return Array.from(nsgMap.values());
}

// ============================================================================
// Private endpoints
// ============================================================================

async function fetchPrivateEndpoints(token: string, subscriptionIds: string[]): Promise<RawPrivateEndpoint[]> {
  const query = `
    resources
    | where type =~ 'microsoft.network/privateendpoints'
    | project
        id, name, resourceGroup, location,
        subnetId                = properties.subnet.id,
        privateLinkConnections  = properties.privateLinkServiceConnections,
        networkInterfaces       = properties.networkInterfaces
  `;
  const rows = await argQuery(token, subscriptionIds, query);

  return rows.map(row => ({
    id: row.id ?? '',
    name: row.name ?? '',
    resourceGroup: row.resourceGroup ?? '',
    location: row.location ?? '',
    subnetId: row.subnetId ?? '',
    privateLinkConnections: Array.isArray(row.privateLinkConnections) ? row.privateLinkConnections : [],
    networkInterfaces: Array.isArray(row.networkInterfaces) ? row.networkInterfaces : [],
  } satisfies RawPrivateEndpoint));
}

// ============================================================================
// Service endpoints per subnet
// ============================================================================

async function fetchServiceEndpoints(token: string, subscriptionIds: string[]): Promise<RawServiceEndpoint[]> {
  const query = `
    resources
    | where type =~ 'microsoft.network/virtualnetworks'
    | mv-expand subnet = properties.subnets
    | mv-expand endpoint = subnet.properties.serviceEndpoints
    | project
        vnetId   = id,
        subnetId = strcat(id, '/subnets/', subnet.name),
        service  = tostring(endpoint.service)
  `;
  const rows = await argQuery(token, subscriptionIds, query);

  return rows.map(row => ({
    vnetId: row.vnetId ?? '',
    subnetId: row.subnetId ?? '',
    service: row.service ?? '',
  } satisfies RawServiceEndpoint));
}

// ============================================================================
// Resource-level firewall rules
// ============================================================================

async function fetchFirewallRules(token: string, subscriptionIds: string[]): Promise<RawFirewallRules[]> {
  const query = `
    resources
    | where type in~ (
        'microsoft.storage/storageaccounts',
        'microsoft.sql/servers',
        'microsoft.documentdb/databaseaccounts',
        'microsoft.keyvault/vaults'
      )
    | project
        id, name, type, resourceGroup,
        defaultAction = properties.networkAcls.defaultAction,
        ipRules       = properties.networkAcls.ipRules,
        vnetRules     = properties.networkAcls.virtualNetworkRules,
        bypass        = properties.networkAcls.bypass
  `;
  const rows = await argQuery(token, subscriptionIds, query);

  return rows.map(row => ({
    id: row.id ?? '',
    name: row.name ?? '',
    type: row.type ?? '',
    resourceGroup: row.resourceGroup ?? '',
    defaultAction: (row.defaultAction === 'Allow') ? 'Allow' : 'Deny',
    ipRules: Array.isArray(row.ipRules)
      ? row.ipRules.map((r: AnyRecord) => ({ value: r.value ?? r.iPAddressOrRange ?? '' }))
      : [],
    vnetRules: Array.isArray(row.vnetRules)
      ? row.vnetRules.map((r: AnyRecord) => ({ id: r.id ?? '', vnetId: r.properties?.virtualNetworkSubnetId }))
      : [],
    bypass: row.bypass,
  } satisfies RawFirewallRules));
}
