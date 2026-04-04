/**
 * Azure Identity Extractor
 *
 * Extracts Azure managed identities and IAM role assignments from raw Azure
 * Resource Graph data and transforms them into canonical AzureIdentity entities
 * and Relationship edges.
 *
 * Supports:
 *  - System-assigned managed identities (derived from each resource's `identity` block)
 *  - User-assigned managed identities (Microsoft.ManagedIdentity/userAssignedIdentities)
 *  - Role assignments (Microsoft.Authorization/roleAssignments)
 *
 * CONSTRAINT: Only emit entities / relationships based on deterministic, schema-known
 * Azure fields. No heuristic guessing.
 */

import {
  AzureIdentity,
  IamRoleAssignment,
  Relationship,
  TenantId,
} from '@ai-agent/shared';
import { AzureResource } from '../connectors/azure-resource-graph.connector';
import { EntityIdUtils } from './id-generator';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface AzureIdentityExtractionResult {
  identities: AzureIdentity[];
  roleAssignments: IamRoleAssignment[];
  /** Graph relationships derived from the above data */
  relationships: Relationship[];
}

/**
 * Main entry-point.  Accepts the full list of raw ARG resources and returns
 * all identities, role-assignment entities, and relationships.
 */
export function extractAzureIdentities(
  resources: AzureResource[],
  tenantId: TenantId,
  idUtils: EntityIdUtils,
): AzureIdentityExtractionResult {
  const now = new Date().toISOString();

  // Collect unique identities keyed by principalId to avoid duplicates when
  // the same user-assigned identity is attached to several resources.
  const identityMap = new Map<string, AzureIdentity>();
  const roleAssignmentMap = new Map<string, IamRoleAssignment>();
  const relationships: Relationship[] = [];

  for (const resource of resources) {
    const resourceType = resource.type.toLowerCase();

    // -----------------------------------------------------------------------
    // 1. System-assigned managed identity (from any resource's identity block)
    // -----------------------------------------------------------------------
    const sysIdentity = extractSystemAssignedIdentity(
      resource, tenantId, now, idUtils,
    );
    if (sysIdentity) {
      identityMap.set(sysIdentity.principalId!, sysIdentity);

      // Relationship: (AzureIdentity) -[ASSIGNED_TO]-> (CloudResource)
      const resourceEntityId = idUtils.cloudResourceId(tenantId, 'azure', resource.id);
      relationships.push(
        makeRelationship(
          idUtils.azureIdentityId(tenantId, sysIdentity.principalId!),
          resourceEntityId,
          'ASSIGNED_TO',
          tenantId,
          now,
          {
            identityKind: 'system_assigned',
            identityPrincipalId: sysIdentity.principalId,
            resourceArmId: resource.id,
          },
        ),
      );
    }

    // -----------------------------------------------------------------------
    // 2. User-assigned managed identities (from resource's identity block)
    // -----------------------------------------------------------------------
    const userIdentities = extractUserAssignedIdentities(
      resource, tenantId, now, idUtils,
    );
    for (const { identity, armId } of userIdentities) {
      identityMap.set(identity.principalId!, identity);

      const resourceEntityId = idUtils.cloudResourceId(tenantId, 'azure', resource.id);
      const identityEntityId = idUtils.azureIdentityId(tenantId, identity.principalId!);

      // Relationship: (AzureIdentity) -[ASSIGNED_TO]-> (CloudResource)
      relationships.push(
        makeRelationship(
          identityEntityId,
          resourceEntityId,
          'ASSIGNED_TO',
          tenantId,
          now,
          {
            identityKind: 'user_assigned',
            identityArmId: armId,
            identityPrincipalId: identity.principalId,
            resourceArmId: resource.id,
          },
        ),
      );
    }

    // -----------------------------------------------------------------------
    // 3. User-assigned managed identity as a standalone resource
    //    (Microsoft.ManagedIdentity/userAssignedIdentities)
    // -----------------------------------------------------------------------
    if (resourceType === 'microsoft.managedidentity/userassignedidentities') {
      const identity = extractUserAssignedIdentityResource(
        resource, tenantId, now, idUtils,
      );
      if (identity) {
        identityMap.set(identity.principalId!, identity);
      }
    }

    // -----------------------------------------------------------------------
    // 4. Role assignments (Microsoft.Authorization/roleAssignments)
    // -----------------------------------------------------------------------
    if (resourceType === 'microsoft.authorization/roleassignments') {
      const ra = extractRoleAssignment(resource, tenantId, now, idUtils);
      if (ra) {
        roleAssignmentMap.set(ra.roleAssignmentId, ra);

        // Resolve the identity entity ID from principalId (may or may not already
        // be in identityMap – that's fine, the relationship will be valid once
        // both nodes exist in the graph).
        const identityEntityId = idUtils.azureIdentityId(tenantId, ra.principalId);

        // Resolve the scope to a CloudResource entity ID when the scope is a
        // resource or resource-group ARM path.  For subscription-scope we emit
        // the relationship with the ARM scope string as metadata only.
        const scopeEntityId = isScopedToResource(ra.scope)
          ? idUtils.cloudResourceId(tenantId, 'azure', ra.scope)
          : null;

        if (scopeEntityId) {
          // Relationship: (AzureIdentity) -[HAS_ROLE]-> (CloudResource)
          relationships.push(
            makeRelationship(
              identityEntityId,
              scopeEntityId,
              'HAS_ROLE',
              tenantId,
              now,
              {
                roleName: ra.roleName,
                roleDefinitionId: ra.roleDefinitionId,
                principalId: ra.principalId,
                principalType: ra.principalType,
                roleAssignmentId: ra.roleAssignmentId,
                scope: ra.scope,
              },
            ),
          );
        }
      }
    }
  }

  // Deduplicate relationships by (source, target, type) keeping first-seen
  const deduplicatedRels = deduplicateRelationships(relationships);

  return {
    identities: Array.from(identityMap.values()),
    roleAssignments: Array.from(roleAssignmentMap.values()),
    relationships: deduplicatedRels,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Extract a system-assigned managed identity from a resource's `identity` block.
 *
 * Azure Resource Graph returns the `identity` column as a top-level sibling of
 * `properties` (never nested inside it).  The shape is:
 *   { "type": "SystemAssigned", "principalId": "<guid>", "tenantId": "<guid>" }
 *
 * We only create an entity when `principalId` is present (identity is active).
 */
function extractSystemAssignedIdentity(
  resource: AzureResource,
  tenantId: TenantId,
  now: string,
  idUtils: EntityIdUtils,
): AzureIdentity | null {
  // `identity` is a top-level ARG column projected alongside `properties`.
  // Never nested inside `properties` in real ARM responses.
  const identityBlock: any = resource.identity;

  if (!identityBlock) return null;

  // Normalise: "SystemAssigned", "systemassigned", "SystemAssigned, UserAssigned"
  const identityType: string = (identityBlock.type ?? '').replace(/\s/g, '').toLowerCase();
  if (!identityType.includes('systemassigned')) return null;

  const principalId: string | undefined = identityBlock.principalId;
  // System-assigned identities carry tenantId (the AAD tenant), not clientId.
  // clientId may be present on combined SystemAssigned+UserAssigned resources.
  const aadTenantId: string | undefined = identityBlock.tenantId;
  const clientId: string | undefined = identityBlock.clientId;

  if (!principalId) return null; // identity declared but not yet provisioned

  const entityId = idUtils.azureIdentityId(tenantId, principalId);

  return {
    id: entityId,
    tenantId,
    entityType: 'azure_identity',
    identityKind: 'system_assigned',
    name: `${resource.name}/system-assigned`,
    principalId,
    clientId,
    resourceId: resource.id,
    cloudProvider: 'azure',
    region: resource.location,
    createdAt: now,
    updatedAt: now,
    confidence: 'deterministic',
    metadata: {
      aadTenantId,                       // AAD tenant that owns this identity
      parentResourceType: resource.type,
      parentResourceName: resource.name,
      parentArmId: resource.id,
      resourceGroup: resource.resourceGroup,
      // Security governance: these GUIDs uniquely identify service principals
      // in the AAD tenant — treat as internal/confidential.
      dataClassification: 'confidential',
    },
  };
}

/**
 * Extract user-assigned identities from a resource's `identity.userAssignedIdentities`
 * map. Each key is the ARM resource ID of the user-assigned identity; the value
 * contains `principalId` and `clientId`.
 */
function extractUserAssignedIdentities(
  resource: AzureResource,
  tenantId: TenantId,
  now: string,
  idUtils: EntityIdUtils,
): Array<{ identity: AzureIdentity; armId: string }> {
  // `identity` is a top-level ARG column — never inside `properties`
  const identityBlock: any = resource.identity;

  if (!identityBlock) return [];

  const uaMap: Record<string, { principalId?: string; clientId?: string }> =
    identityBlock.userAssignedIdentities ?? {};

  const results: Array<{ identity: AzureIdentity; armId: string }> = [];

  for (const [armId, ua] of Object.entries(uaMap)) {
    if (!ua.principalId) continue; // skip if not yet provisioned

    const entityId = idUtils.azureIdentityId(tenantId, ua.principalId);
    const identityName = armId.split('/').pop() ?? armId;

    results.push({
      armId,
      identity: {
        id: entityId,
        tenantId,
        entityType: 'azure_identity',
        identityKind: 'user_assigned',
        name: identityName,
        principalId: ua.principalId,
        clientId: ua.clientId,
        resourceId: armId,
        cloudProvider: 'azure',
        createdAt: now,
        updatedAt: now,
        confidence: 'deterministic',
        metadata: {
          attachedToResourceArmId: resource.id,
          attachedToResourceType: resource.type,
          resourceGroup: resource.resourceGroup,
          dataClassification: 'confidential',
        },
      },
    });
  }

  return results;
}

/**
 * Build a canonical AzureIdentity from a user-assigned managed identity resource
 * (Microsoft.ManagedIdentity/userAssignedIdentities).
 */
function extractUserAssignedIdentityResource(
  resource: AzureResource,
  tenantId: TenantId,
  now: string,
  idUtils: EntityIdUtils,
): AzureIdentity | null {
  const props = resource.properties ?? {};
  const principalId: string | undefined = props.principalId;
  const clientId: string | undefined = props.clientId;

  if (!principalId) return null;

  const entityId = idUtils.azureIdentityId(tenantId, principalId);

  return {
    id: entityId,
    tenantId,
    entityType: 'azure_identity',
    identityKind: 'user_assigned',
    name: resource.name,
    principalId,
    clientId,
    resourceId: resource.id,
    cloudProvider: 'azure',
    region: resource.location,
    createdAt: now,
    updatedAt: now,
    confidence: 'deterministic',
    metadata: {
      resourceGroup: resource.resourceGroup,
      tags: resource.tags ?? {},
      dataClassification: 'confidential',
    },
  };
}

/**
 * Build a canonical IamRoleAssignment from a
 * Microsoft.Authorization/roleAssignments resource.
 */
function extractRoleAssignment(
  resource: AzureResource,
  tenantId: TenantId,
  now: string,
  idUtils: EntityIdUtils,
): IamRoleAssignment | null {
  const props = resource.properties ?? {};

  const roleDefinitionId: string | undefined = props.roleDefinitionId;
  const scope: string | undefined = props.scope;
  const principalId: string | undefined = props.principalId;
  const principalType: string | undefined = props.principalType;

  if (!principalId || !scope) return null;

  // Derive role name from the roleDefinitionId GUID (last segment) or
  // from props.roleName when available.
  const roleName: string =
    props.roleName ??
    (roleDefinitionId ? deriveRoleNameFromId(roleDefinitionId) : 'Unknown');

  const roleAssignmentId = resource.id;
  const entityId = idUtils.iamRoleAssignmentId(tenantId, roleAssignmentId);

  return {
    id: entityId,
    tenantId,
    entityType: 'iam_role_assignment',
    roleAssignmentId,
    roleName,
    roleDefinitionId,
    scope,
    principalId,
    principalType,
    createdAt: now,
    updatedAt: now,
    confidence: 'deterministic',
    metadata: {
      resourceGroup: resource.resourceGroup,
      // Role assignments define who can do what on which resource
      // — treat as confidential security-governance data.
      dataClassification: 'confidential',
    },
  };
}

/**
 * Return true when the scope is a resource or resource-group level ARM path.
 * We can link this to a CloudResource entity in the graph.
 * Subscription-scope (/subscriptions/{id}) is intentionally excluded because
 * there is no matching CloudResource entity for the subscription itself.
 */
function isScopedToResource(scope: string): boolean {
  if (typeof scope !== 'string') return false;
  const lower = scope.toLowerCase();
  // Must start with /subscriptions/ and contain more than just the subscription
  return lower.startsWith('/subscriptions/') && lower.includes('/resourcegroups/');
}

/**
 * Map a well-known Azure built-in role definition GUID to a human-readable name.
 * Falls back to the last segment of the definition ID path.
 */
function deriveRoleNameFromId(roleDefinitionId: string): string {
  const knownRoles: Record<string, string> = {
    '8e3af657-a8ff-443c-a75c-2fe8c4bcb635': 'Owner',
    'b24988ac-6180-42a0-ab88-20f7382dd24c': 'Contributor',
    'acdd72a7-3385-48ef-bd42-f606fba81ae7': 'Reader',
    '7f951dda-4ed3-4680-a7ca-43fe172d538d': 'AcrPull',
    '8311e382-0749-4cb8-b61a-304f252e4539': 'AcrPush',
    '17d1049b-9a84-46fb-8f53-869881c3d3ab': 'Storage Account Contributor',
    '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1': 'Storage Blob Data Reader',
    'ba92f5b4-2d11-453d-a403-e96b0029c9fe': 'Storage Blob Data Contributor',
    '974c5e8b-45b9-4653-ba55-5f855dd0fb88': 'Storage Queue Data Contributor',
    '4633458b-17de-408a-b874-0445c86b69e6': 'Key Vault Secrets User',
    'b86a8fe4-44ce-4948-aee5-eccb2c155cd7': 'Key Vault Secrets Officer',
    '21090545-7ca7-4776-b22c-e363652d74d2': 'Key Vault Reader',
    'f25e0fa2-a7c8-4377-a976-54943a77a395': 'Key Vault Administrator',
    '18d7d88d-d35e-4fb5-a5c3-7773c20a72d9': 'User Access Administrator',
    'b1ff04bb-8a4e-4dc4-8eb5-8693973ce19b': 'Azure Kubernetes Service Cluster Admin Role',
    '0ab0b1a8-8aac-4efd-b8c2-3ee1fb270be8': 'Azure Kubernetes Service Cluster User Role',
  };

  // Check if the last segment is a known GUID
  const parts = roleDefinitionId.split('/');
  const guid = parts[parts.length - 1]?.toLowerCase() ?? '';
  return knownRoles[guid] ?? guid;
}

/**
 * Build a canonical Relationship edge.
 */
function makeRelationship(
  sourceId: string,
  targetId: string,
  type: 'ASSIGNED_TO' | 'HAS_ROLE',
  tenantId: TenantId,
  validFrom: string,
  metadata: Record<string, any>,
): Relationship {
  const input = `${tenantId}:${type}:${sourceId}:${targetId}:${validFrom}`;
  const id = crypto.createHash('sha256').update(input).digest('hex');

  return {
    id,
    tenantId,
    type,
    sourceId,
    targetId,
    validFrom,
    confidence: 'deterministic',
    metadata,
  };
}

/**
 * Deduplicate relationships by (sourceId, targetId, type).
 * First occurrence wins.
 */
function deduplicateRelationships(relationships: Relationship[]): Relationship[] {
  const seen = new Set<string>();
  const result: Relationship[] = [];

  for (const rel of relationships) {
    const key = `${rel.sourceId}|${rel.targetId}|${rel.type}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(rel);
    }
  }

  return result;
}
