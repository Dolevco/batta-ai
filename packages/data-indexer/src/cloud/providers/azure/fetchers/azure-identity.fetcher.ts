/**
 * Azure Identity Fetcher
 *
 * Fetches:
 *  - User-assigned managed identities (standalone ARM resources)
 *  - Resources with system-assigned identities
 *  - RBAC role assignments
 *
 * Role name resolution: in-memory map of known built-in role GUIDs → friendly names.
 * Unknown GUIDs are stored as-is (resolvable via ARM if needed).
 *
 * Security:
 *  - Principal IDs are infrastructure metadata, not user PII.
 *  - Raw ARM errors never propagated; only HTTP status codes.
 */

import {
  IdentityGraph,
  RawIdentityResource,
  RawSystemIdentityResource,
  RawRoleAssignment,
} from '@batta/shared';
import { CloudGraphFetchError } from './azure-ingress.fetcher';

type AnyRecord = Record<string, any>;

// ============================================================================
// Built-in role name lookup (most common roles)
// ============================================================================

const BUILT_IN_ROLES: Record<string, string> = {
  '8e3af657-a8ff-443c-a75c-2fe8c4bcb635': 'Owner',
  'b24988ac-6180-42a0-ab88-20f7382dd24c': 'Contributor',
  'acdd72a7-3385-48ef-bd42-f606fba81ae7': 'Reader',
  'ba92f5b4-2d11-453d-a403-e96b0029c9fe': 'Storage Blob Data Contributor',
  '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1': 'Storage Blob Data Reader',
  'b7e6dc6d-f1e8-4753-8033-0f276bb0955b': 'Storage Blob Data Owner',
  '4633458b-17de-408a-b874-0445c86b69e6': 'Key Vault Secrets User',
  'b86a8fe4-44ce-4948-aee5-eccb2c155cd7': 'Key Vault Secrets Officer',
  '14b46e9e-c2b7-41b4-b07b-48a6ebf60603': 'Key Vault Crypto Officer',
  '12338af0-0e69-4776-bea7-57ae8d297424': 'Key Vault Crypto User',
  'e147488a-f6f5-4113-8e2d-b22465e65bf6': 'Key Vault Crypto Service Encryption User',
  '7f951dda-4ed3-4680-a7ca-43fe172d538d': 'AcrPull',
  '8311e382-0749-4cb8-b61a-304f252e45ec': 'AcrPush',
  '090c5cfd-751d-490a-894a-3ce6f1109419': 'Azure Service Bus Data Owner',
  '4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0': 'Azure Service Bus Data Receiver',
  '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39': 'Azure Service Bus Data Sender',
  'a638d3c7-ab3a-418d-83e6-5f17a39d4fde': 'Log Analytics Reader',
  '92aaf0da-9dab-42b6-94a3-d43ce8d16293': 'Log Analytics Contributor',
};

function resolveRoleName(roleDefinitionId: string): string {
  const guid = roleDefinitionId.split('/').pop() ?? roleDefinitionId;
  return BUILT_IN_ROLES[guid.toLowerCase()] ?? guid;
}

// ============================================================================
// Public surface
// ============================================================================

export async function fetchAzureIdentityGraph(
  token: string,
  subscriptionIds: string[],
): Promise<IdentityGraph> {
  const [userAssigned, systemAssigned, roleAssignments] = await Promise.all([
    fetchUserAssignedIdentities(token, subscriptionIds),
    fetchSystemAssignedIdentities(token, subscriptionIds),
    fetchRoleAssignments(token, subscriptionIds),
  ]);

  const result: IdentityGraph = {
    userAssignedIdentities: userAssigned,
    systemAssignedIdentities: systemAssigned,
    roleAssignments: roleAssignments.map(ra => ({
      ...ra,
      // Resolve role name from definition ID for display
      _resolvedRoleName: resolveRoleName(ra.roleDefinitionId),
    } as RawRoleAssignment)),
  };
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
    throw new CloudGraphFetchError('azure', 'identityGraph', `HTTP_${response.status}`);
  }
  const data = await response.json() as { data: AnyRecord[] };
  return data.data ?? [];
}

// ============================================================================
// Fetchers
// ============================================================================

async function fetchUserAssignedIdentities(
  token: string,
  subscriptionIds: string[],
): Promise<RawIdentityResource[]> {
  const query = `
    resources
    | where type =~ 'microsoft.managedidentity/userassignedidentities'
    | project id, name, resourceGroup, location,
        principalId = properties.principalId,
        clientId    = properties.clientId,
        tenantId    = properties.tenantId
  `;
  const rows = await argQuery(token, subscriptionIds, query);
  return rows.map(row => ({
    id: row.id ?? '',
    name: row.name ?? '',
    resourceGroup: row.resourceGroup ?? '',
    location: row.location ?? '',
    principalId: row.principalId ?? '',
    clientId: row.clientId ?? '',
    tenantId: row.tenantId ?? '',
  } satisfies RawIdentityResource));
}

async function fetchSystemAssignedIdentities(
  token: string,
  subscriptionIds: string[],
): Promise<RawSystemIdentityResource[]> {
  const query = `
    resources
    | where isnotnull(identity.principalId)
    | project
        resourceId   = id,
        resourceType = type,
        resourceName = name,
        principalId  = identity.principalId,
        identityType = identity.type
  `;
  const rows = await argQuery(token, subscriptionIds, query);
  return rows.map(row => ({
    resourceId: row.resourceId ?? '',
    resourceType: row.resourceType ?? '',
    resourceName: row.resourceName ?? '',
    principalId: row.principalId ?? '',
    identityType: row.identityType ?? 'SystemAssigned',
  } satisfies RawSystemIdentityResource));
}

async function fetchRoleAssignments(
  token: string,
  subscriptionIds: string[],
): Promise<RawRoleAssignment[]> {
  const query = `
    authorizationresources
    | where type =~ 'microsoft.authorization/roleassignments'
    | project
        id,
        roleDefinitionId = properties.roleDefinitionId,
        principalId      = properties.principalId,
        principalType    = properties.principalType,
        scope            = properties.scope,
        createdAt        = properties.createdOn
  `;
  const rows = await argQuery(token, subscriptionIds, query);
  return rows.map(row => ({
    id: row.id ?? '',
    roleDefinitionId: row.roleDefinitionId ?? '',
    principalId: row.principalId ?? '',
    principalType: row.principalType ?? '',
    scope: row.scope ?? '',
    createdAt: row.createdAt ?? new Date().toISOString(),
  } satisfies RawRoleAssignment));
}

// Re-export resolveRoleName for use in the transformer
export { resolveRoleName };
