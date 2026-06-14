/**
 * Azure Identity Transformer
 *
 * Converts raw IdentityGraph fetcher output into validated GraphNode objects:
 * ManagedIdentityNode, ServicePrincipalNode.
 *
 * dataClassification:
 *   - Identity / RBAC data → 'restricted'
 *
 * Note: role assignments are emitted as graph RELATIONSHIPS (HAS_ROLE) by the
 * cloud-graph-builder, not as nodes.  The transformer only produces identity nodes.
 */

import * as crypto from 'crypto';
import {
  AnyGraphNode,
  ManagedIdentityNode,
  IdentityGraph,
  RawRoleAssignment,
} from '@batta/shared';
import {
  sanitizeNode,
  ManagedIdentitySchema,
} from '../../../graph/node-sanitizer';
import { resolveRoleName } from '../fetchers/azure-identity.fetcher';

// ============================================================================
// Public surface
// ============================================================================

export function transformIdentityGraph(
  identityGraph: IdentityGraph,
  tenantId: string,
  indexedAt: string,
): AnyGraphNode[] {
  const nodes: AnyGraphNode[] = [];

  // User-assigned managed identities
  for (const ua of identityGraph.userAssignedIdentities) {
    if (!ua.principalId) continue;
    const node = sanitizeNode<ManagedIdentityNode>(
      {
        id: nodeId(tenantId, ua.id),
        tenantId,
        cloudProvider: 'azure',
        nodeType: 'ManagedIdentity',
        providerResourceId: ua.id,
        displayName: ua.name,
        region: ua.location,
        tags: {},
        indexedAt,
        dataClassification: 'restricted',
        internetExposed: false,
        principalId: ua.principalId,
        clientId: ua.clientId ?? '',
        identityKind: 'UserAssigned',
        assignedToResourceIds: [],
      },
      ManagedIdentitySchema,
      'ManagedIdentity',
    );
    nodes.push(node);
  }

  // System-assigned managed identities (derived from resource identity blocks)
  // Grouped per resource so we don't create duplicate nodes for the same principal
  const seen = new Set<string>();
  for (const sa of identityGraph.systemAssignedIdentities) {
    if (!sa.principalId || seen.has(sa.principalId)) continue;
    seen.add(sa.principalId);
    const syntheticId = `${sa.resourceId}/providers/Microsoft.ManagedIdentity/systemAssigned`;
    const node = sanitizeNode<ManagedIdentityNode>(
      {
        id: nodeId(tenantId, syntheticId),
        tenantId,
        cloudProvider: 'azure',
        nodeType: 'ManagedIdentity',
        providerResourceId: syntheticId,
        displayName: `${sa.resourceName} (system-assigned)`,
        region: '',
        tags: {},
        indexedAt,
        dataClassification: 'restricted',
        internetExposed: false,
        principalId: sa.principalId,
        clientId: '',
        identityKind: 'SystemAssigned',
        assignedToResourceIds: [sa.resourceId.toLowerCase()],
      },
      ManagedIdentitySchema,
      'ManagedIdentity',
    );
    nodes.push(node);
  }

  return nodes;
}

// ============================================================================
// Role assignment helpers (used by graph builder to emit HAS_ROLE edges)
// ============================================================================

export interface ResolvedRoleAssignment extends RawRoleAssignment {
  roleName: string;
}

export function resolveRoleAssignments(
  roleAssignments: RawRoleAssignment[],
): ResolvedRoleAssignment[] {
  return roleAssignments.map(ra => ({
    ...ra,
    roleName: resolveRoleName(ra.roleDefinitionId),
  }));
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
