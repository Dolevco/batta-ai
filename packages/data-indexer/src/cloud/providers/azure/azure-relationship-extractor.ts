/**
 * Azure Relationship Extractor
 * 
 * Extracts relationships between Azure resources by inspecting resource properties.
 * Uses deterministic rules based on known Azure schemas.
 * 
 * CONSTRAINT: Only emit relationships based on known Azure patterns.
 * DO NOT attempt generic or heuristic relationship discovery.
 */

import { Relationship, RelationshipType, TenantId, EntityId } from '@batta/shared';
import { AzureResource } from './azure-resource-graph.connector';
import * as crypto from 'crypto';
import { EntityIdUtils } from '../../../utils/id-generator';

/**
 * Azure relationship types mapped to canonical RelationshipType
 */
const AZURE_RELATIONSHIP_TYPES: Record<string, RelationshipType> = {
  ATTACHED_TO: 'USES',      // VM → NIC, Disk → VM
  CONNECTED_TO: 'USES',     // NIC → Subnet
  PART_OF: 'CONTAINS',      // Subnet → VNet, Resource → RG → Subscription
  EXPOSES: 'USES',          // Public IP → Resource
  RUNS_ON: 'USES',          // App Service → App Service Plan
  USES_ENV: 'USES',         // Container App / Job → Managed Environment
  LOGS_TO: 'USES',          // Managed Environment → Log Analytics Workspace
  PULLS_FROM: 'USES',       // Container App / Job → Container Registry
  MOUNTS: 'USES',           // Container App → Storage Account (AzureFile volume)
};

interface ExtractedRelationship {
  sourceId: string;
  targetId: string;
  relationshipType: string;
  /** Optional human-readable label stored in metadata */
  label?: string;
}

/**
 * Extract all relationships from Azure resources
 */
export function extractAzureRelationships(
  resources: AzureResource[],
  tenantId: TenantId,
  idUtils?: EntityIdUtils
): Relationship[] {
  const extractedRelationships: ExtractedRelationship[] = [];
  const now = new Date().toISOString();
  const _idUtils = idUtils ?? new EntityIdUtils();

  // Build resource lookup for fast access (by lower-cased ARM id)
  const resourceMap = new Map<string, AzureResource>();
  for (const resource of resources) {
    resourceMap.set(resource.id.toLowerCase(), resource);
  }

  // Extract relationships from each resource
  for (const resource of resources) {
    const resourceType = resource.type.toLowerCase();

    // 1. Containment relationships (Subscription → RG → Resource)
    extractedRelationships.push(...extractContainmentRelationships(resource));

    // 2. VM → Network Interface
    if (resourceType === 'microsoft.compute/virtualmachines') {
      extractedRelationships.push(...extractVmToNicRelationships(resource));
    }

    // 3. Network Interface → Subnet
    if (resourceType === 'microsoft.network/networkinterfaces') {
      extractedRelationships.push(...extractNicToSubnetRelationships(resource));
    }

    // 4. Subnet → Virtual Network
    if (resourceType === 'microsoft.network/virtualnetworks') {
      extractedRelationships.push(...extractSubnetToVnetRelationships(resource));
    }

    // 5. Public IP → Resource
    if (resourceType === 'microsoft.network/publicipaddresses') {
      extractedRelationships.push(...extractPublicIpRelationships(resource));
    }

    // 6. Disk → Compute Resource
    if (resourceType.endsWith('/disks')) {
      extractedRelationships.push(...extractDiskRelationships(resource));
    }

    // 7. App Service / Function App → App Service Plan
    if (resourceType === 'microsoft.web/sites') {
      extractedRelationships.push(...extractAppServiceRelationships(resource));
    }

    // 8. Container App / Job → Managed Environment
    if (
      resourceType === 'microsoft.app/containerapps' ||
      resourceType === 'microsoft.app/jobs'
    ) {
      extractedRelationships.push(...extractContainerAppToEnvRelationships(resource));
    }

    // 9. Container App → Container Registry (via registries config)
    if (
      resourceType === 'microsoft.app/containerapps' ||
      resourceType === 'microsoft.app/jobs'
    ) {
      extractedRelationships.push(
        ...extractContainerAppToRegistryRelationships(resource, resourceMap),
      );
    }

    // 10. Container App → Storage Account (via AzureFile volume mounts)
    if (resourceType === 'microsoft.app/containerapps') {
      extractedRelationships.push(
        ...extractContainerAppToStorageRelationships(resource, resourceMap),
      );
    }

    // 11. Managed Environment → Log Analytics Workspace
    if (resourceType === 'microsoft.app/managedenvironments') {
      extractedRelationships.push(
        ...extractManagedEnvToLogAnalyticsRelationships(resource, resourceMap),
      );
    }

    // 12. Cognitive Services / AI Foundry → (referenced projects / hubs)
    if (resourceType === 'microsoft.cognitiveservices/accounts/projects') {
      extractedRelationships.push(...extractCognitiveProjectToAccountRelationships(resource));
    }
  }

  // Deduplicate and validate relationships
  const validRelationships = deduplicateAndValidate(extractedRelationships, resourceMap);

  // Transform to canonical Relationship type, mapping ARM IDs → deterministic entity IDs
  return validRelationships.map(rel => toCanonicalRelationship(rel, tenantId, now, _idUtils));
}

/**
 * 1️⃣ Extract containment relationships (Subscription → RG → Resource)
 */
function extractContainmentRelationships(resource: AzureResource): ExtractedRelationship[] {
  const relationships: ExtractedRelationship[] = [];

  // Parse resource ID: /subscriptions/{sub}/resourceGroups/{rg}/providers/{provider}/{type}/{name}
  const parts = resource.id.split('/');
  if (parts.length < 5) return relationships;

  const subscriptionIndex = parts.indexOf('subscriptions');
  const rgIndex = parts.indexOf('resourceGroups');

  if (subscriptionIndex !== -1 && subscriptionIndex + 1 < parts.length) {
    const subscriptionId = `/subscriptions/${parts[subscriptionIndex + 1]}`;

    if (rgIndex !== -1 && rgIndex + 1 < parts.length) {
      const resourceGroupId = `${subscriptionId}/resourceGroups/${parts[rgIndex + 1]}`;

      // Subscription → Resource Group
      relationships.push({
        sourceId: subscriptionId,
        targetId: resourceGroupId,
        relationshipType: 'PART_OF',
      });

      // Resource Group → Resource
      relationships.push({
        sourceId: resourceGroupId,
        targetId: resource.id,
        relationshipType: 'PART_OF',
      });
    }
  }

  return relationships;
}

/**
 * 2️⃣ VM → Network Interface
 */
function extractVmToNicRelationships(resource: AzureResource): ExtractedRelationship[] {
  const relationships: ExtractedRelationship[] = [];

  const networkProfile = resource.properties?.networkProfile;
  if (!networkProfile?.networkInterfaces) return relationships;

  for (const nic of networkProfile.networkInterfaces) {
    const nicId = nic.id || nic;
    if (isValidResourceId(nicId)) {
      relationships.push({
        sourceId: resource.id,
        targetId: nicId,
        relationshipType: 'ATTACHED_TO',
      });
    }
  }

  return relationships;
}

/**
 * 3️⃣ Network Interface → Subnet
 */
function extractNicToSubnetRelationships(resource: AzureResource): ExtractedRelationship[] {
  const relationships: ExtractedRelationship[] = [];

  const ipConfigurations = resource.properties?.ipConfigurations;
  if (!ipConfigurations) return relationships;

  for (const ipConfig of ipConfigurations) {
    const subnetId = ipConfig.properties?.subnet?.id;
    if (isValidResourceId(subnetId)) {
      relationships.push({
        sourceId: resource.id,
        targetId: subnetId,
        relationshipType: 'CONNECTED_TO',
      });
    }
  }

  return relationships;
}

/**
 * 4️⃣ Subnet → Virtual Network
 */
function extractSubnetToVnetRelationships(resource: AzureResource): ExtractedRelationship[] {
  const relationships: ExtractedRelationship[] = [];

  const subnets = resource.properties?.subnets;
  if (!subnets) return relationships;

  for (const subnet of subnets) {
    const subnetId = subnet.id;
    if (isValidResourceId(subnetId)) {
      relationships.push({
        sourceId: subnetId,
        targetId: resource.id,
        relationshipType: 'PART_OF',
      });
    }
  }

  return relationships;
}

/**
 * 5️⃣ Public IP → Resource
 */
function extractPublicIpRelationships(resource: AzureResource): ExtractedRelationship[] {
  const relationships: ExtractedRelationship[] = [];

  const ipConfiguration = resource.properties?.ipConfiguration;
  if (!ipConfiguration?.id) return relationships;

  const targetId = ipConfiguration.id;
  if (isValidResourceId(targetId)) {
    relationships.push({
      sourceId: resource.id,
      targetId,
      relationshipType: 'EXPOSES',
    });
  }

  return relationships;
}

/**
 * 6️⃣ Disk → Compute Resource
 */
function extractDiskRelationships(resource: AzureResource): ExtractedRelationship[] {
  const relationships: ExtractedRelationship[] = [];

  const managedBy = resource.properties?.managedBy;
  if (isValidResourceId(managedBy)) {
    relationships.push({
      sourceId: resource.id,
      targetId: managedBy,
      relationshipType: 'ATTACHED_TO',
    });
  }

  return relationships;
}

/**
 * 7️⃣ App Service / Function App → App Service Plan
 */
function extractAppServiceRelationships(resource: AzureResource): ExtractedRelationship[] {
  const relationships: ExtractedRelationship[] = [];

  const serverFarmId = resource.properties?.serverFarmId;
  if (isValidResourceId(serverFarmId)) {
    relationships.push({
      sourceId: resource.id,
      targetId: serverFarmId,
      relationshipType: 'RUNS_ON',
    });
  }

  return relationships;
}

/**
 * 8️⃣ Container App / Job → Managed Environment
 *
 * The Managed Environment ARM id lives in:
 *   properties.managedEnvironmentId  (most container apps)
 *   properties.environmentId         (some revisions / jobs)
 */
function extractContainerAppToEnvRelationships(
  resource: AzureResource,
): ExtractedRelationship[] {
  const relationships: ExtractedRelationship[] = [];
  const props = resource.properties ?? {};

  const envId: string | undefined =
    props.managedEnvironmentId ?? props.environmentId;

  if (isValidResourceId(envId)) {
    relationships.push({
      sourceId: resource.id,
      targetId: envId!,
      relationshipType: 'USES_ENV',
      label: 'runs in managed environment',
    });
  }

  return relationships;
}

/**
 * 9️⃣ Container App / Job → Container Registry
 *
 * Reads `properties.configuration.registries[].server` and matches it against
 * the loginServer of any Microsoft.ContainerRegistry/registries resources in
 * the resourceMap.
 */
function extractContainerAppToRegistryRelationships(
  resource: AzureResource,
  resourceMap: Map<string, AzureResource>,
): ExtractedRelationship[] {
  const relationships: ExtractedRelationship[] = [];
  const registries: any[] =
    resource.properties?.configuration?.registries ?? [];

  for (const reg of registries) {
    const server: string | undefined = reg?.server;
    if (!server) continue;

    // Find the matching ACR resource by loginServer
    for (const [, candidate] of resourceMap) {
      if (
        candidate.type.toLowerCase() ===
          'microsoft.containerregistry/registries' &&
        candidate.properties?.loginServer?.toLowerCase() ===
          server.toLowerCase()
      ) {
        relationships.push({
          sourceId: resource.id,
          targetId: candidate.id,
          relationshipType: 'PULLS_FROM',
          label: `pulls images from ${server}`,
        });
        break;
      }
    }
  }

  return relationships;
}

/**
 * 🔟 Container App → Storage Account (AzureFile volumes)
 *
 * `properties.template.volumes[].storageType === "AzureFile"` means the
 * container app has an Azure File Share volume.  The `storageName` field
 * corresponds to an environment-level storage resource which is backed by a
 * Storage Account. We match the storage account by name prefix heuristic only
 * when the name unambiguously resolves to a known resource in the map.
 */
function extractContainerAppToStorageRelationships(
  resource: AzureResource,
  resourceMap: Map<string, AzureResource>,
): ExtractedRelationship[] {
  const relationships: ExtractedRelationship[] = [];
  const volumes: any[] = resource.properties?.template?.volumes ?? [];

  for (const vol of volumes) {
    if (vol?.storageType !== 'AzureFile') continue;

    const storageName: string | undefined = vol.storageName;
    if (!storageName) continue;

    // Try to find a Storage Account in the same subscription/RG whose name
    // matches the storage name.  Container Apps Environments expose file
    // shares through a storage link whose name typically matches the storage
    // account name (or a prefix).
    for (const [, candidate] of resourceMap) {
      if (
        candidate.type.toLowerCase() === 'microsoft.storage/storageaccounts' &&
        candidate.resourceGroup.toLowerCase() ===
          resource.resourceGroup.toLowerCase() &&
        candidate.name.toLowerCase() === storageName.toLowerCase()
      ) {
        relationships.push({
          sourceId: resource.id,
          targetId: candidate.id,
          relationshipType: 'MOUNTS',
          label: `mounts AzureFile share from ${candidate.name}`,
        });
        break;
      }
    }
  }

  return relationships;
}

/**
 * 1️⃣1️⃣ Managed Environment → Log Analytics Workspace
 *
 * `properties.appLogsConfiguration.logAnalyticsConfiguration.customerId`
 * matches `properties.customerId` on the Log Analytics Workspace.
 */
function extractManagedEnvToLogAnalyticsRelationships(
  resource: AzureResource,
  resourceMap: Map<string, AzureResource>,
): ExtractedRelationship[] {
  const relationships: ExtractedRelationship[] = [];

  const customerId: string | undefined =
    resource.properties?.appLogsConfiguration?.logAnalyticsConfiguration
      ?.customerId;

  if (!customerId) return relationships;

  for (const [, candidate] of resourceMap) {
    if (
      candidate.type.toLowerCase() ===
        'microsoft.operationalinsights/workspaces' &&
      candidate.properties?.customerId?.toLowerCase() ===
        customerId.toLowerCase()
    ) {
      relationships.push({
        sourceId: resource.id,
        targetId: candidate.id,
        relationshipType: 'LOGS_TO',
        label: `sends logs to Log Analytics workspace ${candidate.name}`,
      });
      break;
    }
  }

  return relationships;
}

/**
 * 1️⃣2️⃣ Cognitive Services Project → parent Account
 *
 * Projects have an ARM id of the form:
 *   /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.CognitiveServices/accounts/{account}/projects/{project}
 * We extract the parent account ARM id and emit a CONTAINS relationship.
 */
function extractCognitiveProjectToAccountRelationships(
  resource: AzureResource,
): ExtractedRelationship[] {
  const relationships: ExtractedRelationship[] = [];

  // The parent account ARM id is everything up to (but not including) /projects/…
  const projectsIndex = resource.id.toLowerCase().lastIndexOf('/projects/');
  if (projectsIndex === -1) return relationships;

  const parentAccountId = resource.id.slice(0, projectsIndex);
  if (isValidResourceId(parentAccountId)) {
    relationships.push({
      sourceId: parentAccountId,
      targetId: resource.id,
      relationshipType: 'PART_OF',
      label: 'cognitive services project belongs to account',
    });
  }

  return relationships;
}

/**
 * Validate that a resource ID is non-empty and starts with /subscriptions/
 */
function isValidResourceId(id: any): id is string {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.toLowerCase().startsWith('/subscriptions/')
  );
}

/**
 * Deduplicate and validate relationships.
 * Relationships referencing ARM paths that don't begin with /subscriptions/
 * are also valid (e.g. subscription-scoped paths missing /resourceGroups) –
 * we only drop completely invalid entries.
 */
function deduplicateAndValidate(
  relationships: ExtractedRelationship[],
  _resourceMap: Map<string, AzureResource>
): ExtractedRelationship[] {
  const seen = new Set<string>();
  const valid: ExtractedRelationship[] = [];

  for (const rel of relationships) {
    // Ignore relationships with missing or non-string IDs
    if (
      typeof rel.sourceId !== 'string' || rel.sourceId.length === 0 ||
      typeof rel.targetId !== 'string' || rel.targetId.length === 0
    ) {
      continue;
    }

    // Create unique key for deduplication
    const key = `${rel.sourceId.toLowerCase()}|${rel.targetId.toLowerCase()}|${rel.relationshipType}`;
    if (seen.has(key)) continue;

    seen.add(key);
    valid.push(rel);
  }

  return valid;
}

/**
 * Transform to canonical Relationship type, mapping ARM IDs to deterministic entity IDs
 */
function toCanonicalRelationship(
  extracted: ExtractedRelationship,
  tenantId: TenantId,
  timestamp: string,
  idUtils: EntityIdUtils
): Relationship {
  // Map Azure relationship type to canonical type
  const canonicalType = AZURE_RELATIONSHIP_TYPES[extracted.relationshipType] || 'USES';

  // Map raw ARM resource IDs → deterministic cloud_resource entity IDs (same as the connector)
  const sourceEntityId = idUtils.cloudResourceId(tenantId, 'azure', extracted.sourceId);
  const targetEntityId = idUtils.cloudResourceId(tenantId, 'azure', extracted.targetId);

  // Generate deterministic relationship ID
  const id = generateRelationshipId(tenantId, canonicalType, sourceEntityId, targetEntityId, timestamp);

  return {
    id,
    tenantId,
    type: canonicalType,
    sourceId: sourceEntityId,
    targetId: targetEntityId,
    validFrom: timestamp,
    confidence: 'deterministic',
    metadata: {
      azureRelationshipType: extracted.relationshipType,
      ...(extracted.label ? { label: extracted.label } : {}),
      // Preserve the original ARM IDs for debugging / cross-referencing
      sourceArmId: extracted.sourceId,
      targetArmId: extracted.targetId,
      extractedAt: timestamp,
    },
  };
}

/**
 * Generate deterministic relationship ID.
 * validFrom is excluded so that re-indexing the same logical relationship
 * produces the same ID and results in an upsert rather than a duplicate edge.
 */
function generateRelationshipId(
  tenantId: TenantId,
  type: RelationshipType,
  sourceId: EntityId,
  targetId: EntityId,
  _validFrom?: string
): EntityId {
  const input = `${tenantId}:${type}:${sourceId}:${targetId}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}

