/**
 * Cloud Graph → Entity Converter
 *
 * Converts AnyGraphNode instances (produced by CloudGraphBuilder) into
 * CloudResource CanonicalEntity records for Postgres storage, discoverable
 * by the SecurityQueryTools BFS traversal.
 *
 * Security classification: CONFIDENTIAL — contains cloud infrastructure topology.
 * Access: service-account only; isolated per tenantId in all queries.
 *
 * Data minimization:
 *  - `tags` are stored as-is; the CloudGraphBuilder's node-sanitizer already
 *    redacts secret-pattern values before nodes reach this layer.
 *  - No secrets, tokens, or PII are handled here.
 */

import { CloudResource } from '@batta/shared';
import { AnyGraphNode, CloudGraph } from '@batta/shared';

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
  // Compute / PaaS — these are first-class graph nodes that also appear as
  // backends for Front Door / Traffic Manager origins.  Use proper resourceType
  // values so the UI's icon resolution (getIconFromResourceType) works correctly.
  ContainerApp: 'compute',
  WebApp: 'compute',
  StorageAccount: 'storage',
  // Identity (map to 'other' — identity entities use AzureIdentity, not CloudResource,
  // but we still need them to be traversable via the BFS)
  ManagedIdentity: 'other',
  ServicePrincipal: 'other',
  // Synthetic
  InternetNode: 'network',
};

/**
 * Derives the ARM provider/resource-type segment from a providerResourceId ARM path.
 *
 * E.g. "/subscriptions/.../providers/microsoft.app/containerapps/batta-api"
 *   → "microsoft.app/containerapps"
 *
 * Returns empty string if the path cannot be parsed (safe — callers treat '' as
 * "no type override").
 *
 * Security: the input is always a pre-validated ARM path from the Azure Management API;
 * this is a pure string parse — no I/O, no side effects.
 */
function armTypeFromResourceId(providerResourceId: string): string {
  if (!providerResourceId) return '';
  // ARM IDs are case-insensitive; normalise to lower-case for consistent matching.
  const lower = providerResourceId.toLowerCase();
  const match = lower.match(/\/providers\/([^/]+\/[^/]+)/);
  return match ? match[1] : '';
}

/**
 * Converts a single AnyGraphNode to a CloudResource CanonicalEntity.
 *
 * The resulting entity:
 *  - Uses the same `id` as the graph store node (16-char hex), ensuring BFS
 *    lookups by that ID succeed in the data store.
 *  - Sets `entityType: 'cloud_resource'` so existing API and query code handles
 *    it without modification.
 *  - Stores all node-specific properties in `metadata` for display/query use.
 *  - Stores the ARM provider/resource-type in `metadata.type` so the UI's
 *    `getIconFromResourceType` helper can resolve the correct icon (e.g. the
 *    Container Apps icon for ContainerApp nodes).
 *  - Applies tenantId isolation.
 *
 * Data classification: CONFIDENTIAL (infrastructure topology); tenantId-isolated.
 */
function graphNodeToCloudResource(node: AnyGraphNode): CloudResource {
  const now = node.indexedAt ?? new Date().toISOString();
  const resourceType = NODE_TYPE_TO_RESOURCE_TYPE[node.nodeType] ?? 'other';

  // Build metadata without any secret-adjacent fields; tags are already
  // sanitized upstream by the node-sanitizer in CloudGraphBuilder.
  const { id, tenantId, nodeType, displayName, region, tags, indexedAt: _indexedAt, providerResourceId, cloudProvider, dataClassification, internetExposed, ...specificProps } = node as any;

  // Derive the ARM resource type from the providerResourceId so the UI icon
  // logic (`getIconFromResourceType`) can resolve the correct icon.
  // For synthetic/network-only nodes the ARM type may be empty — that is fine;
  // those nodes already have a concrete resourceType ('network') that the icon
  // logic falls back to.
  const armType = armTypeFromResourceId(providerResourceId);

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
      // Include the ARM provider/resource-type string (e.g. "microsoft.app/containerapps")
      // so the UI's getIconFromResourceType() helper can resolve the correct Azure icon
      // without needing to re-parse the resourceId on the client side.
      ...(armType && { type: armType }),
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
 * Data classification: CONFIDENTIAL — topology count only logged, no topology detail.
 */
export function cloudGraphToEntities(graph: CloudGraph): CloudResource[] {
  const entities = graph.nodes
    .filter(node => node.nodeType !== 'InternetNode')
    .map(node => graphNodeToCloudResource(node));

  console.info('[CloudGraphToEntities] Converted graph nodes to CloudResource entities', {
    // Classification: CONFIDENTIAL — topology count only, no topology detail
    nodeCount: entities.length,
  });

  return entities;
}
