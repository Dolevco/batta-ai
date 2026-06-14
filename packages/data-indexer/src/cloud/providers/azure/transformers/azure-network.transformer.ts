/**
 * Azure Network Transformer
 *
 * Converts raw NetworkTopology fetcher output into validated GraphNode objects:
 * VirtualNetworkNode, SubnetNode, NetworkSecurityGroupNode, PrivateEndpointNode.
 *
 * dataClassification:
 *   - Network topology (VNet, Subnet, NSG, PrivateEndpoint) → 'confidential'
 *
 * CIDR normalisation is handled by SubnetSchema (via Zod transform).
 */

import * as crypto from 'crypto';
import {
  AnyGraphNode,
  VirtualNetworkNode,
  SubnetNode,
  NetworkSecurityGroupNode,
  NsgRule,
  PrivateEndpointNode,
  NetworkTopology,
  RawNsgRuleSet,
  RawNsgRule,
} from '@batta/shared';
import {
  sanitizeNode,
  VirtualNetworkSchema,
  SubnetSchema,
  NetworkSecurityGroupSchema,
  PrivateEndpointSchema,
} from '../../../graph/node-sanitizer';

// ============================================================================
// Public surface
// ============================================================================

export function transformNetworkTopology(
  topology: NetworkTopology,
  rawVnets: Record<string, any>[],
  tenantId: string,
  indexedAt: string,
): AnyGraphNode[] {
  const nodes: AnyGraphNode[] = [];

  // VNets and subnets come from raw resource batch (already collected by fetchResources)
  for (const vnet of rawVnets) {
    nodes.push(...transformVNet(vnet, tenantId, indexedAt));
  }

  // NSGs
  const nsgMap = buildNsgMap(topology.nsgRules);
  for (const [nsgId, { nsgName, inbound, outbound }] of nsgMap.entries()) {
    const nsgNode = sanitizeNode<NetworkSecurityGroupNode>(
      {
        id: nodeId(tenantId, nsgId),
        tenantId,
        cloudProvider: 'azure',
        nodeType: 'NetworkSecurityGroup',
        providerResourceId: nsgId,
        displayName: nsgName,
        region: '',
        tags: {},
        indexedAt,
        dataClassification: 'confidential',
        internetExposed: false,
        inboundRules: inbound,
        outboundRules: outbound,
      },
      NetworkSecurityGroupSchema,
      'NetworkSecurityGroup',
    );
    nodes.push(nsgNode);
  }

  // Private endpoints
  for (const pe of topology.privateEndpoints) {
    const targetId = resolveTargetResourceId(pe.privateLinkConnections);
    const groupIds = resolveGroupIds(pe.privateLinkConnections);
    const privateIp = resolvePrivateIp(pe.networkInterfaces);

    const peNode = sanitizeNode<PrivateEndpointNode>(
      {
        id: nodeId(tenantId, pe.id),
        tenantId,
        cloudProvider: 'azure',
        nodeType: 'PrivateEndpoint',
        providerResourceId: pe.id,
        displayName: pe.name,
        region: pe.location,
        tags: {},
        indexedAt,
        dataClassification: 'confidential',
        internetExposed: false,
        subnetId: pe.subnetId ?? '',
        targetResourceId: targetId,
        groupIds,
        privateIpAddress: privateIp,
        dnsZoneGroupIds: [],
      },
      PrivateEndpointSchema,
      'PrivateEndpoint',
    );
    nodes.push(peNode);
  }

  return nodes;
}

// ============================================================================
// VNet + Subnet transformation
// ============================================================================

function transformVNet(vnet: Record<string, any>, tenantId: string, indexedAt: string): AnyGraphNode[] {
  const nodes: AnyGraphNode[] = [];
  const props = vnet.properties ?? {};

  const addressSpaces: string[] = (props.addressSpace?.addressPrefixes as string[]) ?? [];
  const dnsServers: string[] = (props.dhcpOptions?.dnsServers as string[]) ?? [];
  const enableDdos: boolean = props.enableDdosProtection === true;

  const vnetNode = sanitizeNode<VirtualNetworkNode>(
    {
      id: nodeId(tenantId, vnet.id),
      tenantId,
      cloudProvider: 'azure',
      nodeType: 'VirtualNetwork',
      providerResourceId: vnet.id,
      displayName: vnet.name,
      region: vnet.location ?? '',
      tags: vnet.tags ?? {},
      indexedAt,
      dataClassification: 'confidential',
      internetExposed: false,
      addressSpaces,
      dnsServers,
      enableDdosProtection: enableDdos,
    },
    VirtualNetworkSchema,
    'VirtualNetwork',
  );
  nodes.push(vnetNode);

  for (const subnet of (props.subnets as Record<string, any>[]) ?? []) {
    const subProps = subnet.properties ?? {};
    const subnetId = subnet.id ?? `${vnet.id}/subnets/${subnet.name}`;

    const subnetNode = sanitizeNode<SubnetNode>(
      {
        id: nodeId(tenantId, subnetId),
        tenantId,
        cloudProvider: 'azure',
        nodeType: 'Subnet',
        providerResourceId: subnetId,
        displayName: subnet.name ?? '',
        region: vnet.location ?? '',
        tags: {},
        indexedAt,
        dataClassification: 'confidential',
        internetExposed: false,
        vnetId: vnet.id.toLowerCase(),
        cidr: subProps.addressPrefix ?? '',
        delegatedTo: (subProps.delegations as any[])?.[0]?.properties?.serviceName,
        serviceEndpoints: ((subProps.serviceEndpoints as any[]) ?? [])
          .map((se: any) => se.service as string)
          .filter(Boolean),
        nsgId: subProps.networkSecurityGroup?.id?.toLowerCase(),
        routeTableId: subProps.routeTable?.id?.toLowerCase(),
      },
      SubnetSchema,
      'Subnet',
    );
    nodes.push(subnetNode);
  }

  return nodes;
}

// ============================================================================
// NSG rule grouping
// ============================================================================

interface NsgEntry {
  nsgName: string;
  inbound: NsgRule[];
  outbound: NsgRule[];
}

function buildNsgMap(nsgRuleSets: RawNsgRuleSet[]): Map<string, NsgEntry> {
  const map = new Map<string, NsgEntry>();

  for (const ruleSet of nsgRuleSets) {
    const id = ruleSet.nsgId.toLowerCase();
    if (!map.has(id)) {
      map.set(id, { nsgName: ruleSet.nsgName, inbound: [], outbound: [] });
    }
    const entry = map.get(id)!;
    for (const rule of ruleSet.rules) {
      const transformed = transformNsgRule(rule);
      if (rule.direction?.toLowerCase() === 'inbound') {
        entry.inbound.push(transformed);
      } else {
        entry.outbound.push(transformed);
      }
    }
  }

  return map;
}

function transformNsgRule(raw: RawNsgRule): NsgRule {
  const normalizeProtocol = (p: string): 'Tcp' | 'Udp' | 'Icmp' | '*' => {
    const upper = p.toUpperCase();
    if (upper === 'TCP') return 'Tcp';
    if (upper === 'UDP') return 'Udp';
    if (upper === 'ICMP') return 'Icmp';
    return '*';
  };

  const normalizeCidrs = (prefix: string, prefixes: string[]): string[] => {
    const all = [
      ...(prefix && prefix !== '*' && prefix !== '' ? [prefix] : []),
      ...prefixes,
    ];
    // Remove wildcards and service tags from CIDR arrays (they go to serviceTag field)
    return all.filter(c => c.includes('/') || c.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/));
  };

  const extractServiceTag = (prefix: string): string | undefined => {
    if (prefix && !prefix.includes('/') && !prefix.match(/^\d/)) return prefix;
    return undefined;
  };

  const sourceCidrs = normalizeCidrs(raw.srcPrefix, raw.srcPrefixes);
  const destinationCidrs = normalizeCidrs(raw.dstPrefix, raw.dstPrefixes);
  const sourceServiceTag = extractServiceTag(raw.srcPrefix);
  const destinationServiceTag = extractServiceTag(raw.dstPrefix);

  const normalizePorts = (port: string, ports: string[]): string[] => {
    const all = [
      ...(port && port !== '*' ? [port] : []),
      ...ports,
    ];
    return all.length > 0 ? all : ['*'];
  };

  return {
    name: raw.ruleName,
    priority: raw.priority,
    protocol: normalizeProtocol(raw.protocol),
    access: raw.access === 'Allow' ? 'Allow' : 'Deny',
    sourceCidrs,
    sourceServiceTag,
    destinationCidrs,
    destinationServiceTag,
    destinationPorts: normalizePorts(raw.dstPort, raw.dstPorts),
  };
}

// ============================================================================
// Private endpoint helpers
// ============================================================================

function resolveTargetResourceId(connections: any[]): string {
  if (!Array.isArray(connections) || connections.length === 0) return '';
  const conn = connections[0];
  return conn?.properties?.privateLinkServiceId ?? conn?.privateLinkServiceId ?? '';
}

function resolveGroupIds(connections: any[]): string[] {
  if (!Array.isArray(connections) || connections.length === 0) return [];
  const conn = connections[0];
  return (conn?.properties?.groupIds as string[]) ?? [];
}

function resolvePrivateIp(networkInterfaces: any[]): string {
  if (!Array.isArray(networkInterfaces) || networkInterfaces.length === 0) return '';
  const nic = networkInterfaces[0];
  const ipConfigs: any[] = nic?.properties?.ipConfigurations ?? [];
  return ipConfigs[0]?.properties?.privateIPAddress ?? '';
}

// ============================================================================
// Utility
// ============================================================================

function nodeId(tenantId: string, armId: string): string {
  return crypto
    .createHash('sha256')
    .update(`${tenantId}:${armId.toLowerCase()}`)
    .digest('hex')
    .substring(0, 16);
}
