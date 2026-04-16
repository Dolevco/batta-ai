/**
 * Cloud Graph Builder
 *
 * Assembles a CloudGraph from all fetched and transformed data.
 * This is a pure function — no I/O, no side effects.
 *
 * Steps:
 *  1. Emit INTERNET synthetic node.
 *  2. Emit ingress nodes + routing edges.
 *  3. Emit VNet topology nodes + CONTAINS, PEERED_WITH, PROTECTED_BY edges.
 *  4. Emit private endpoint edges (DEPLOYED_IN, HAS_PRIVATE_ENDPOINT, CONNECTS_TO).
 *  5. Emit firewall rule edges (HAS_FIREWALL_RULE, ACCESSIBLE_FROM, internetExposed flag).
 *  6. Emit identity edges (ASSIGNED_IDENTITY, HAS_ROLE).
 *  7. Derive internet exposure via BFS from INTERNET node.
 *  8. Deduplication pass.
 *
 * Security:
 *  - All nodes arrive pre-sanitised (via node-sanitizer).
 *  - No raw API data is used here.
 *  - SHA-256 via Node.js built-in crypto only.
 */

import * as crypto from 'crypto';
import {
  CloudGraph,
  AnyGraphNode,
  GraphRelationship,
  GraphRelationshipType,
  InternetNode,
  FrontDoorProfileNode,
  FrontDoorEndpointNode,
  FrontDoorRouteNode,
  FrontDoorOriginGroupNode,
  FrontDoorOriginNode,
  TrafficManagerProfileNode,
  TrafficManagerEndpointNode,
  APIManagementServiceNode,
  APIMApiNode,
  APIMBackendNode,
  VirtualNetworkNode,
  SubnetNode,
  NetworkSecurityGroupNode,
  PrivateEndpointNode,
  ManagedIdentityNode,
  IngressGraph,
  NetworkTopology,
  IdentityGraph,
  RawResourceBatch,
} from '@ai-agent/shared';
import { transformIngressGraph } from '../connectors/azure/transformers/azure-ingress.transformer';
import { transformNetworkTopology } from '../connectors/azure/transformers/azure-network.transformer';
import { transformIdentityGraph, resolveRoleAssignments } from '../connectors/azure/transformers/azure-identity.transformer';
import { deduplicateRelationships } from './relationship-deduplicator';

// ============================================================================
// Types
// ============================================================================

export interface CloudGraphBuildInput {
  tenantId: string;
  resources: RawResourceBatch;
  ingressGraph: IngressGraph;
  networkTopology: NetworkTopology;
  identityGraph: IdentityGraph;
}

// ============================================================================
// Builder
// ============================================================================

export class CloudGraphBuilder {
  build(input: CloudGraphBuildInput): CloudGraph {
    const { tenantId, resources, ingressGraph, networkTopology, identityGraph } = input;
    const indexedAt = new Date().toISOString();

    const nodes: AnyGraphNode[] = [];
    const relationships: GraphRelationship[] = [];

    // ── Step 1: INTERNET node ─────────────────────────────────────────────
    const internet: InternetNode = {
      id: 'internet',
      tenantId,
      cloudProvider: 'synthetic',
      nodeType: 'InternetNode',
      providerResourceId: 'internet',
      displayName: 'INTERNET',
      region: 'global',
      tags: {},
      indexedAt,
      dataClassification: 'public',
      internetExposed: true,
    };
    nodes.push(internet);

    // ── Step 2: Ingress ───────────────────────────────────────────────────
    const ingressNodes = transformIngressGraph(ingressGraph, tenantId, indexedAt);
    nodes.push(...ingressNodes);
    relationships.push(...this.buildIngressEdges(internet.id, ingressNodes, tenantId));
    relationships.push(...this.buildOriginBackendEdges(ingressNodes, resources.resources, tenantId));

    // ── Step 3: Network topology ──────────────────────────────────────────
    const rawVnets = resources.resources.filter(
      r => typeof r.type === 'string' && r.type.toLowerCase() === 'microsoft.network/virtualnetworks',
    );
    const networkNodes = transformNetworkTopology(networkTopology, rawVnets, tenantId, indexedAt);
    nodes.push(...networkNodes);
    relationships.push(...this.buildNetworkEdges(networkNodes, networkTopology, tenantId));

    // ── Step 4: Private endpoint edges ────────────────────────────────────
    relationships.push(...this.buildPrivateEndpointEdges(networkNodes, tenantId));

    // ── Step 5: Firewall rule edges ───────────────────────────────────────
    const { relationships: fwRelationships, updatedNodes } = this.buildFirewallEdges(
      nodes, networkTopology, tenantId,
    );
    relationships.push(...fwRelationships);
    // Apply internetExposed updates from firewall rules
    for (const upd of updatedNodes) {
      const idx = nodes.findIndex(n => n.id === upd.id);
      if (idx >= 0) nodes[idx] = upd;
    }

    // ── Step 6: Identity ──────────────────────────────────────────────────
    const identityNodes = transformIdentityGraph(identityGraph, tenantId, indexedAt);
    nodes.push(...identityNodes);
    relationships.push(...this.buildIdentityEdges(identityNodes, identityGraph, nodes, tenantId));

    // ── Step 7: Compute → Subnet DEPLOYED_IN edges ────────────────────────
    relationships.push(...this.buildComputeSubnetEdges(resources.resources, networkNodes, tenantId));

    // ── Step 8: Derive internet exposure ──────────────────────────────────
    this.deriveInternetExposure(nodes, relationships);

    // ── Step 9: Deduplication ─────────────────────────────────────────────
    const deduped = deduplicateRelationships(relationships);

    return { nodes, relationships: deduped };
  }

  // ============================================================================
  // Ingress edges
  // ============================================================================

  private buildIngressEdges(
    internetId: string,
    ingressNodes: AnyGraphNode[],
    tenantId: string,
  ): GraphRelationship[] {
    const rels: GraphRelationship[] = [];

    const byId = new Map(ingressNodes.map(n => [n.providerResourceId, n]));
    const byType = <T extends AnyGraphNode>(type: string) =>
      ingressNodes.filter((n): n is T => n.nodeType === type);

    // INTERNET → FrontDoorProfile
    for (const fd of byType<FrontDoorProfileNode>('FrontDoorProfile')) {
      rels.push(makeRel(internetId, fd.id, 'ROUTES_TO', tenantId, 'deterministic'));

      // FrontDoorProfile → FrontDoorEndpoint
      for (const ep of byType<FrontDoorEndpointNode>('FrontDoorEndpoint')) {
        if (ep.profileId === fd.providerResourceId.toLowerCase()) {
          rels.push(makeRel(fd.id, ep.id, 'HAS_ENDPOINT', tenantId, 'deterministic'));

          // FrontDoorEndpoint → FrontDoorRoute
          for (const route of byType<FrontDoorRouteNode>('FrontDoorRoute')) {
            if (route.endpointId === ep.providerResourceId.toLowerCase()) {
              rels.push(makeRel(ep.id, route.id, 'HAS_ROUTE', tenantId, 'deterministic'));
            }
          }
        }
      }

      // FrontDoorProfile → FrontDoorOriginGroup
      for (const og of byType<FrontDoorOriginGroupNode>('FrontDoorOriginGroup')) {
        if (og.profileId === fd.providerResourceId.toLowerCase()) {
          rels.push(makeRel(fd.id, og.id, 'HAS_ORIGIN_GROUP', tenantId, 'deterministic'));

          // FrontDoorOriginGroup → FrontDoorOrigin
          for (const origin of byType<FrontDoorOriginNode>('FrontDoorOrigin')) {
            if (origin.originGroupId === og.providerResourceId.toLowerCase()) {
              rels.push(makeRel(og.id, origin.id, 'HAS_ORIGIN', tenantId, 'deterministic'));
            }
          }
        }
      }

      // FrontDoorRoute → FrontDoorOriginGroup (ROUTES_TO)
      for (const route of byType<FrontDoorRouteNode>('FrontDoorRoute')) {
        const og = ingressNodes.find(
          n => n.nodeType === 'FrontDoorOriginGroup' &&
               n.providerResourceId.toLowerCase() === route.originGroupId,
        );
        if (og) {
          rels.push(makeRel(route.id, og.id, 'ROUTES_TO', tenantId, 'deterministic'));
        }
      }
    }

    // INTERNET → TrafficManagerProfile
    for (const tm of byType<TrafficManagerProfileNode>('TrafficManagerProfile')) {
      rels.push(makeRel(internetId, tm.id, 'ROUTES_TO', tenantId, 'deterministic'));

      // TrafficManagerProfile → TrafficManagerEndpoint
      for (const ep of byType<TrafficManagerEndpointNode>('TrafficManagerEndpoint')) {
        if (ep.profileId === tm.providerResourceId.toLowerCase()) {
          rels.push(makeRel(tm.id, ep.id, 'ROUTES_TO', tenantId, 'deterministic'));
        }
      }
    }

    // INTERNET → APIManagementService (when not internal VNet)
    for (const apim of byType<APIManagementServiceNode>('APIManagementService')) {
      if (apim.vnetType === 'None' || apim.vnetType === 'External') {
        rels.push(makeRel(internetId, apim.id, 'ROUTES_TO', tenantId, 'deterministic'));
      }

      // APIManagementService → APIMApi
      for (const api of byType<APIMApiNode>('APIMApi')) {
        if (api.apimServiceId === apim.providerResourceId.toLowerCase()) {
          rels.push(makeRel(apim.id, api.id, 'EXPOSES_API', tenantId, 'deterministic'));
        }
      }

      // APIMApi → APIMBackend (match by service — all backends belong to the service)
      for (const backend of byType<APIMBackendNode>('APIMBackend')) {
        if (backend.apimServiceId === apim.providerResourceId.toLowerCase()) {
          // Associate backends with all APIs in this service (conservative approach)
          for (const api of byType<APIMApiNode>('APIMApi')) {
            if (api.apimServiceId === apim.providerResourceId.toLowerCase()) {
              rels.push(makeRel(api.id, backend.id, 'HAS_BACKEND', tenantId, 'heuristic'));
            }
          }
        }
      }
    }

    return rels;
  }

  // ============================================================================
  // Origin → backend resource edges
  // ============================================================================

  private buildOriginBackendEdges(
    ingressNodes: AnyGraphNode[],
    rawResources: Record<string, any>[],
    tenantId: string,
  ): GraphRelationship[] {
    const rels: GraphRelationship[] = [];

    // Build hostname → ARM resource ID index from raw resources.
    // Matches Container App FQDNs, Web App default hostnames, and Storage static-web endpoints.
    const hostToResourceId = new Map<string, string>();
    for (const r of rawResources) {
      const type = (r.type ?? '').toLowerCase();
      const id: string = r.id ?? '';
      if (!id) continue;

      if (type === 'microsoft.app/containerapps') {
        const fqdn: string = r.properties?.configuration?.ingress?.fqdn ?? '';
        if (fqdn) hostToResourceId.set(fqdn.toLowerCase(), id);
      }

      if (type === 'microsoft.web/sites') {
        const defaultHost: string = r.properties?.defaultHostName ?? '';
        if (defaultHost) hostToResourceId.set(defaultHost.toLowerCase(), id);
      }

      if (type === 'microsoft.storage/storageaccounts') {
        // Static website endpoint: <account>.z<n>.web.core.windows.net
        const webEndpoint: string = r.properties?.primaryEndpoints?.web ?? '';
        if (webEndpoint) {
          try {
            const host = new URL(webEndpoint).hostname.toLowerCase();
            if (host) hostToResourceId.set(host, id);
          } catch { /* malformed URL — skip */ }
        }
        const blobEndpoint: string = r.properties?.primaryEndpoints?.blob ?? '';
        if (blobEndpoint) {
          try {
            const host = new URL(blobEndpoint).hostname.toLowerCase();
            if (host) hostToResourceId.set(host, id);
          } catch { /* malformed URL — skip */ }
        }
      }
    }

    // Bridge FrontDoorProfile and FrontDoorEndpoint nodes to their legacy cloud_resource counterparts
    // so that traversal starting from the cloud_resource entity can reach the full graph topology.
    /*for (const node of ingressNodes) {
      if (node.nodeType === 'FrontDoorProfile' || node.nodeType === 'FrontDoorEndpoint') {
        const legacyId = cloudResourceEntityId(tenantId, node.providerResourceId);
        // cloud_resource → FrontDoorProfile/Endpoint (REPRESENTS): legacy resource IS the FD node
        rels.push(makeRel(legacyId, node.id, 'REPRESENTS', tenantId, 'deterministic'));
      }
    }*/

    // FrontDoorOrigin → backend cloud_resource (RESOLVES_TO)
    for (const origin of ingressNodes.filter((n): n is FrontDoorOriginNode => n.nodeType === 'FrontDoorOrigin')) {
      const hostname = (origin.hostName ?? '').toLowerCase();
      if (!hostname) continue;
      const backendResourceId = hostToResourceId.get(hostname);
      if (backendResourceId) {
        // Use cloudResourceEntityId to match the ID format used by the legacy connector
        // (stored in both Qdrant and Neo4j as cloud_resource:<hash>)
        const backendNodeId = cloudResourceEntityId(tenantId, backendResourceId);
        rels.push(makeRel(origin.id, backendNodeId, 'RESOLVES_TO', tenantId, 'heuristic'));
      }
    }

    return rels;
  }

  // ============================================================================
  // Network edges
  // ============================================================================

  private buildNetworkEdges(
    networkNodes: AnyGraphNode[],
    topology: NetworkTopology,
    tenantId: string,
  ): GraphRelationship[] {
    const rels: GraphRelationship[] = [];

    const vnets = networkNodes.filter((n): n is VirtualNetworkNode => n.nodeType === 'VirtualNetwork');
    const subnets = networkNodes.filter((n): n is SubnetNode => n.nodeType === 'Subnet');
    const nsgs = networkNodes.filter((n): n is NetworkSecurityGroupNode => n.nodeType === 'NetworkSecurityGroup');
    const vnetIndex = new Map(vnets.map(v => [v.providerResourceId, v]));
    const subnetIndex = new Map(subnets.map(s => [s.providerResourceId, s]));
    const nsgIndex = new Map(nsgs.map(n => [n.providerResourceId, n]));

    // VirtualNetwork → Subnet (CONTAINS)
    for (const subnet of subnets) {
      const vnet = vnetIndex.get(subnet.vnetId) ??
        // Fallback: match by prefix of VNet ID
        [...vnetIndex.values()].find(v => subnet.providerResourceId.toLowerCase().startsWith(v.providerResourceId + '/'));
      if (vnet) {
        rels.push(makeRel(vnet.id, subnet.id, 'CONTAINS', tenantId, 'deterministic'));
      }

      // Subnet → NSG (PROTECTED_BY)
      if (subnet.nsgId) {
        const nsg = nsgIndex.get(subnet.nsgId) ??
          [...nsgIndex.values()].find(n => n.providerResourceId.toLowerCase() === subnet.nsgId);
        if (nsg) {
          rels.push(makeRel(subnet.id, nsg.id, 'PROTECTED_BY', tenantId, 'deterministic'));
        }
      }

      // Subnet → service type (HAS_SERVICE_ENDPOINT)
      for (const se of topology.serviceEndpoints) {
        if (se.subnetId.toLowerCase() === subnet.providerResourceId.toLowerCase()) {
          rels.push({
            ...makeRel(subnet.id, subnet.id, 'HAS_SERVICE_ENDPOINT', tenantId, 'deterministic'),
            // Override targetId with a synthetic value; metadata carries the service name
            targetId: subnet.id,
            metadata: { service: se.service },
          });
        }
      }
    }

    // VNet ↔ VNet (PEERED_WITH) — emit both directions
    for (const peering of topology.vnetPeerings) {
      if (peering.peeringState !== 'Connected') continue;
      const srcVnet = [...vnetIndex.values()].find(
        v => v.providerResourceId.toLowerCase() === peering.vnetId.toLowerCase(),
      );
      const dstVnet = [...vnetIndex.values()].find(
        v => v.providerResourceId.toLowerCase() === peering.remoteVnetId.toLowerCase(),
      );
      if (srcVnet && dstVnet) {
        rels.push(makeRel(srcVnet.id, dstVnet.id, 'PEERED_WITH', tenantId, 'deterministic', {
          allowGatewayTransit: peering.allowGatewayTransit,
          allowForwardedTraffic: peering.allowForwardedTraffic,
          useRemoteGateways: peering.useRemoteGateways,
        }));
        rels.push(makeRel(dstVnet.id, srcVnet.id, 'PEERED_WITH', tenantId, 'deterministic', {
          allowGatewayTransit: peering.allowGatewayTransit,
          allowForwardedTraffic: peering.allowForwardedTraffic,
          useRemoteGateways: peering.useRemoteGateways,
        }));
      }
    }

    return rels;
  }

  // ============================================================================
  // Private endpoint edges
  // ============================================================================

  private buildPrivateEndpointEdges(
    networkNodes: AnyGraphNode[],
    tenantId: string,
  ): GraphRelationship[] {
    const rels: GraphRelationship[] = [];
    const privateEndpoints = networkNodes.filter((n): n is PrivateEndpointNode => n.nodeType === 'PrivateEndpoint');
    const subnetIndex = new Map(
      networkNodes.filter((n): n is SubnetNode => n.nodeType === 'Subnet')
        .map(s => [s.providerResourceId, s]),
    );

    for (const pe of privateEndpoints) {
      // PrivateEndpoint → Subnet (DEPLOYED_IN)
      const subnet = subnetIndex.get(pe.subnetId.toLowerCase()) ??
        [...subnetIndex.values()].find(s => s.providerResourceId.toLowerCase() === pe.subnetId.toLowerCase());
      if (subnet) {
        rels.push(makeRel(pe.id, subnet.id, 'DEPLOYED_IN', tenantId, 'deterministic'));
      }

      // PaaS resource → PrivateEndpoint (HAS_PRIVATE_ENDPOINT)
      // The target resource ID is an ARM path; we emit the relationship using it as the source ID.
      // If the target node exists in the graph, it will resolve. If not, the edge is still emitted.
      if (pe.targetResourceId) {
        const targetNodeId = nodeId(tenantId, pe.targetResourceId);
        rels.push(makeRel(targetNodeId, pe.id, 'HAS_PRIVATE_ENDPOINT', tenantId, 'deterministic'));
        // CONNECTS_TO is the reverse semantic: PE connects to the PaaS resource
        rels.push(makeRel(pe.id, targetNodeId, 'CONNECTS_TO', tenantId, 'deterministic'));
      }
    }

    return rels;
  }

  // ============================================================================
  // Firewall rule edges + internet exposure derivation from firewall rules
  // ============================================================================

  private buildFirewallEdges(
    nodes: AnyGraphNode[],
    topology: NetworkTopology,
    tenantId: string,
  ): { relationships: GraphRelationship[]; updatedNodes: AnyGraphNode[] } {
    const rels: GraphRelationship[] = [];
    const updatedNodes: AnyGraphNode[] = [];

    const subnetIndex = new Map(
      nodes.filter((n): n is SubnetNode => n.nodeType === 'Subnet')
        .map(s => [s.providerResourceId, s]),
    );

    for (const fw of topology.firewallRules) {
      const resourceNodeId = nodeId(tenantId, fw.id);

      // HAS_FIREWALL_RULE (stored in edge metadata, no separate node)
      rels.push({
        id: relId(tenantId, 'HAS_FIREWALL_RULE', resourceNodeId, resourceNodeId + '_fw'),
        tenantId,
        type: 'HAS_FIREWALL_RULE',
        sourceId: resourceNodeId,
        targetId: resourceNodeId + '_fw', // synthetic target for inline rule
        confidence: 'deterministic',
        metadata: {
          defaultAction: fw.defaultAction,
          ipRules: fw.ipRules,
          vnetRules: fw.vnetRules,
          bypass: fw.bypass,
        },
      });

      // Derive internet exposure
      if (fw.defaultAction === 'Allow') {
        const node = nodes.find(n => n.id === resourceNodeId);
        if (node) {
          updatedNodes.push({ ...node, internetExposed: true });
        }
      } else {
        // Check if any IP rule is 0.0.0.0/0
        const hasPublicIpRule = fw.ipRules.some(r => r.value === '0.0.0.0/0');
        if (hasPublicIpRule) {
          const node = nodes.find(n => n.id === resourceNodeId);
          if (node) {
            updatedNodes.push({ ...node, internetExposed: true });
          }
        }
      }

      // ACCESSIBLE_FROM — heuristic: match vnet rules to subnets
      for (const vnetRule of fw.vnetRules) {
        const subnetId = vnetRule.id ?? vnetRule.vnetId ?? '';
        const subnet = [...subnetIndex.values()].find(
          s => s.providerResourceId.toLowerCase() === subnetId.toLowerCase(),
        );
        if (subnet) {
          rels.push(makeRel(resourceNodeId, subnet.id, 'ACCESSIBLE_FROM', tenantId, 'heuristic'));
        }
      }
    }

    return { relationships: rels, updatedNodes };
  }

  // ============================================================================
  // Identity edges
  // ============================================================================

  private buildIdentityEdges(
    identityNodes: AnyGraphNode[],
    identityGraph: IdentityGraph,
    allNodes: AnyGraphNode[],
    tenantId: string,
  ): GraphRelationship[] {
    const rels: GraphRelationship[] = [];
    const miIndex = new Map(
      identityNodes.filter((n): n is ManagedIdentityNode => n.nodeType === 'ManagedIdentity')
        .map(m => [m.principalId, m]),
    );

    // ASSIGNED_IDENTITY: Compute → ManagedIdentity
    for (const sa of identityGraph.systemAssignedIdentities) {
      const mi = miIndex.get(sa.principalId);
      if (!mi) continue;
      const computeNodeId = nodeId(tenantId, sa.resourceId);
      rels.push(makeRel(computeNodeId, mi.id, 'ASSIGNED_IDENTITY', tenantId, 'deterministic'));
    }

    // HAS_ROLE: ManagedIdentity → scope resource
    const resolved = resolveRoleAssignments(identityGraph.roleAssignments);
    for (const ra of resolved) {
      const mi = miIndex.get(ra.principalId);
      if (!mi) continue; // Only emit for known managed identities

      const scopeNodeId = nodeId(tenantId, ra.scope);
      rels.push(makeRel(mi.id, scopeNodeId, 'HAS_ROLE', tenantId, 'deterministic', {
        roleName: ra.roleName,
        roleDefinitionId: ra.roleDefinitionId,
        principalType: ra.principalType,
        scope: ra.scope,
      }));
    }

    return rels;
  }

  // ============================================================================
  // Compute → Subnet DEPLOYED_IN edges
  // ============================================================================

  private buildComputeSubnetEdges(
    rawResources: Record<string, any>[],
    networkNodes: AnyGraphNode[],
    tenantId: string,
  ): GraphRelationship[] {
    const rels: GraphRelationship[] = [];
    const subnetIndex = new Map(
      networkNodes.filter((n): n is SubnetNode => n.nodeType === 'Subnet')
        .map(s => [s.providerResourceId, s]),
    );

    const computeTypes = [
      'microsoft.compute/virtualmachines',
      'microsoft.web/sites',
      'microsoft.app/containerapps',
      'microsoft.app/jobs',
      'microsoft.containerservice/managedclusters',
    ];

    for (const resource of rawResources) {
      if (!computeTypes.includes((resource.type ?? '').toLowerCase())) continue;

      const computeNodeId = nodeId(tenantId, resource.id);
      const subnetId = extractSubnetId(resource);
      if (!subnetId) continue;

      const subnet = [...subnetIndex.values()].find(
        s => s.providerResourceId.toLowerCase() === subnetId.toLowerCase(),
      );
      if (subnet) {
        rels.push(makeRel(computeNodeId, subnet.id, 'DEPLOYED_IN', tenantId, 'deterministic'));
      }
    }

    return rels;
  }

  // ============================================================================
  // Internet exposure derivation — BFS from INTERNET node
  // ============================================================================

  private deriveInternetExposure(nodes: AnyGraphNode[], relationships: GraphRelationship[]): void {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const adjacency = new Map<string, Set<string>>();
    const ingressEdgeTypes = new Set<GraphRelationshipType>([
      'ROUTES_TO', 'HAS_ENDPOINT', 'HAS_ROUTE', 'HAS_ORIGIN_GROUP', 'HAS_ORIGIN',
      'EXPOSES_API', 'HAS_BACKEND', 'RESOLVES_TO', 'DEPLOYED_IN', 'HAS_PRIVATE_ENDPOINT',
    ]);

    for (const rel of relationships) {
      if (!ingressEdgeTypes.has(rel.type)) continue;
      if (!adjacency.has(rel.sourceId)) adjacency.set(rel.sourceId, new Set());
      adjacency.get(rel.sourceId)!.add(rel.targetId);
    }

    // BFS
    const visited = new Set<string>();
    const queue: string[] = ['internet'];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);

      const node = nodeMap.get(id);
      if (node && !node.internetExposed) {
        (node as AnyGraphNode).internetExposed = true;
      }

      for (const neighbour of adjacency.get(id) ?? []) {
        if (!visited.has(neighbour)) queue.push(neighbour);
      }
    }

    // Additionally: NSG rule check — if inbound Allow * from Internet/*, mark subnet exposed
    const nsgs = nodes.filter((n): n is NetworkSecurityGroupNode => n.nodeType === 'NetworkSecurityGroup');
    for (const nsg of nsgs) {
      const isPubliclyExposed = nsg.inboundRules.some(
        r => r.access === 'Allow' &&
          (r.sourceServiceTag === 'Internet' || r.sourceServiceTag === '*' ||
           r.sourceCidrs.includes('0.0.0.0/0')),
      );
      if (isPubliclyExposed) {
        nsg.internetExposed = true;
      }
    }
  }
}

// ============================================================================
// Utility helpers
// ============================================================================

function nodeId(tenantId: string, armId: string): string {
  return crypto
    .createHash('sha256')
    .update(`${tenantId}:${armId.toLowerCase()}`)
    .digest('hex')
    .substring(0, 16);
}

/**
 * Generate the cloud_resource entity ID that matches the legacy EntityIdUtils.cloudResourceId()
 * format used by the Azure Resource Graph connector and stored in Qdrant/Neo4j.
 * Format: cloud_resource:<hash> where hash is derived from sorted key fields.
 */
function cloudResourceEntityId(tenantId: string, armId: string): string {
  const fields = {
    tenantId,
    entityType: 'cloud_resource',
    provider: 'azure',
    resourceId: armId.toLowerCase(),
  };
  const sortedKeys = Object.keys(fields).sort();
  const keyString = sortedKeys.map(k => `${k}=${(fields as Record<string, string>)[k]}`).join('|');
  const hash = crypto.createHash('sha256').update(keyString).digest('hex').substring(0, 16);
  return `cloud_resource:${hash}`;
}

function relId(tenantId: string, type: string, sourceId: string, targetId: string): string {
  return crypto
    .createHash('sha256')
    .update(`rel:${tenantId}:${type}:${sourceId}:${targetId}`)
    .digest('hex')
    .substring(0, 16);
}

function makeRel(
  sourceId: string,
  targetId: string,
  type: GraphRelationshipType,
  tenantId: string,
  confidence: GraphRelationship['confidence'],
  metadata: Record<string, any> = {},
): GraphRelationship {
  return {
    id: relId(tenantId, type, sourceId, targetId),
    tenantId,
    type,
    sourceId,
    targetId,
    confidence,
    metadata,
  };
}

function extractSubnetId(resource: Record<string, any>): string | null {
  const props = resource.properties ?? {};
  const type = (resource.type ?? '').toLowerCase();

  // VMs: networkProfile → networkInterfaces → ipConfigurations → subnet
  if (type === 'microsoft.compute/virtualmachines') {
    const nics: any[] = props.networkProfile?.networkInterfaces ?? [];
    for (const nic of nics) {
      const ipConfigs: any[] = nic.properties?.ipConfigurations ?? [];
      for (const ip of ipConfigs) {
        if (ip.properties?.subnet?.id) return ip.properties.subnet.id;
      }
    }
  }

  // Web/Function App: virtualNetworkSubnetId or vnetContentShareEnabled
  if (type === 'microsoft.web/sites') {
    if (props.virtualNetworkSubnetId) return props.virtualNetworkSubnetId;
  }

  // Container Apps
  if (type === 'microsoft.app/containerapps' || type === 'microsoft.app/jobs') {
    if (props.environmentId) return null; // resolves via managed environment
  }

  return null;
}
