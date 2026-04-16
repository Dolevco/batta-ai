/**
 * Cloud Graph → Qdrant Entity Converter
 *
 * Converts AnyGraphNode instances (produced by CloudGraphBuilder) into
 * CloudResource CanonicalEntity records so they can be stored in Qdrant and
 * discovered by the SecurityQueryTools BFS traversal.
 *
 * Security classification: CONFIDENTIAL — contains cloud infrastructure topology.
 * Access: service-account only; isolated per tenantId in all Qdrant queries.
 *
 * Data minimization:
 *  - `tags` are stored as-is; the CloudGraphBuilder's node-sanitizer already
 *    redacts secret-pattern values before nodes reach this layer.
 *  - No secrets, tokens, or PII are handled here.
 */

import { CloudResource } from '@ai-agent/shared';
import { AnyGraphNode, CloudGraph } from '@ai-agent/shared';

/**
 * Maps a GraphNodeType to a human-readable cloud resource type category.
 * Kept as a simple lookup so types never have to be inferred from strings.
 */
const NODE_TYPE_TO_RESOURCE_TYPE: Record<string, CloudResource['resourceType']> = {
  // Ingress
  FrontDoorProfile: 'network',
  FrontDoorEndpoint: 'network',
  FrontDoorRoute: 'network',
  FrontDoorOriginGroup: 'network',
  FrontDoorOrigin: 'network',
  TrafficManagerProfile: 'network',
  TrafficManagerEndpoint: 'network',
  APIManagementService: 'network',
  APIMApi: 'network',
  APIMBackend: 'network',
  AppGateway: 'network',
  // Networking
  VirtualNetwork: 'network',
  Subnet: 'network',
  NetworkSecurityGroup: 'network',
  PrivateEndpoint: 'network',
  // Identity (map to 'other' — identity entities use AzureIdentity, not CloudResource,
  // but we still need them to be traversable via the BFS)
  ManagedIdentity: 'other',
  ServicePrincipal: 'other',
  // Synthetic
  InternetNode: 'network',
};

/**
 * Converts a single AnyGraphNode to a CloudResource CanonicalEntity.
 *
 * The resulting entity:
 *  - Uses the same `id` as the Neo4j node (16-char hex), ensuring BFS lookups
 *    by that ID succeed in Qdrant.
 *  - Sets `entityType: 'cloud_resource'` so existing API and query code handles
 *    it without modification.
 *  - Stores all node-specific properties in `metadata` for display/query use.
 *  - Applies tenantId isolation — same value used in Neo4j.
 */
export function graphNodeToCloudResource(node: AnyGraphNode): CloudResource {
  const now = node.indexedAt ?? new Date().toISOString();
  const resourceType = NODE_TYPE_TO_RESOURCE_TYPE[node.nodeType] ?? 'other';

  // Build metadata without any secret-adjacent fields; tags are already
  // sanitized upstream by the node-sanitizer in CloudGraphBuilder.
  const { id, tenantId, nodeType, displayName, region, tags, indexedAt, providerResourceId, cloudProvider, dataClassification, internetExposed, ...specificProps } = node as any;

  return {
    id,
    tenantId,
    entityType: 'cloud_resource',
    resourceType,
    cloudProvider: cloudProvider === 'synthetic' ? 'azure' : cloudProvider,
    name: displayName,
    resourceId: providerResourceId,
    region: region ?? undefined,
    environment: tags?.environment ?? tags?.env ?? undefined,
    appTag: tags?.app ?? tags?.application ?? undefined,
    createdAt: now,
    updatedAt: now,
    lastIndexedAt: now,
    confidence: 'deterministic',
    metadata: {
      nodeType,
      dataClassification,
      internetExposed,
      tags,
      ...specificProps,
    },
  };
}

/**
 * Converts all nodes in a CloudGraph to CloudResource entities, skipping
 * the synthetic InternetNode (it has no meaningful cloud representation and
 * is not a real asset — it is only used to anchor internet-exposure BFS).
 *
 * Audit: logs node count at INFO level; no raw node data is logged.
 */
export function cloudGraphToQdrantEntities(graph: CloudGraph): CloudResource[] {
  const entities = graph.nodes
    .filter(node => node.nodeType !== 'InternetNode')
    .map(node => graphNodeToCloudResource(node));

  console.info('[CloudGraphToQdrant] Converted graph nodes for Qdrant', {
    // Classification: CONFIDENTIAL — topology count only, no topology detail
    nodeCount: entities.length,
  });

  return entities;
}
