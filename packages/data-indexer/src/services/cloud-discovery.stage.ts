/**
 * Cloud Discovery Stage
 * 
 * Discovers cloud resources from various cloud providers
 */

import { TenantId, CloudResource, Relationship, AzureIdentity, IamRoleAssignment } from '@ai-agent/shared';
import { AzureResourceGraphConnector, AzureResourceGraphConfig, AzureResource } from '../connectors/azure-resource-graph.connector';
import { extractAzureRelationships } from '../utils/azure-relationship-extractor';
import { extractAzureIdentities } from '../utils/azure-identity-extractor';
import { EntityIdUtils } from '../utils/id-generator';

export interface CloudDiscoveryConfig {
  azure?: AzureResourceGraphConfig;
  // Future: AWS, GCP, etc.
}

/**
 * Cloud Discovery Stage
 * Fetches cloud resources from configured cloud providers
 */
export class CloudDiscoveryStage {
  private config: CloudDiscoveryConfig;
  private azureConnector?: AzureResourceGraphConnector;
  private idUtils: EntityIdUtils;

  constructor(config: CloudDiscoveryConfig) {
    this.config = config;
    this.idUtils = new EntityIdUtils();

    if (config.azure) {
      this.azureConnector = new AzureResourceGraphConnector(config.azure, this.idUtils);
    }
  }

  /**
   * Discover cloud resources from all configured providers
   */
  async discover(tenantId: TenantId): Promise<CloudDiscoveryOutput> {
    const resources: CloudResource[] = [];
    const identities: AzureIdentity[] = [];
    const iamRoleAssignments: IamRoleAssignment[] = [];
    const relationships: Relationship[] = [];
    const errors: string[] = [];

    // Discover from Azure
    if (this.azureConnector) {
      try {
        const token = await this.azureConnector.getToken();

        // 1. Fetch all resources (includes identity blocks on each resource)
        const azureRawResources = await (this.azureConnector as any).queryResourceGraph(token) as AzureResource[];
        const azureResources = azureRawResources.map((r: AzureResource) =>
          (this.azureConnector as any).transformToCloudResource(r, tenantId) as CloudResource,
        );
        resources.push(...azureResources);

        // 2. Extract resource-to-resource relationships
        const azureRelationships = extractAzureRelationships(azureRawResources, tenantId, this.idUtils);
        relationships.push(...azureRelationships);

        // 3. Fetch managed identity resources (standalone user-assigned identities)
        let allIdentityResources: AzureResource[] = [...azureRawResources];
        try {
          const miResources = await this.azureConnector.fetchManagedIdentityResources(token);
          allIdentityResources = [...azureRawResources, ...miResources];
        } catch (miError: any) {
          errors.push(`Managed identity discovery failed: ${miError.message}`);
        }

        // 4. Fetch role assignments
        let roleAssignmentResources: AzureResource[] = [];
        try {
          roleAssignmentResources = await this.azureConnector.fetchRoleAssignmentResources(token);
        } catch (raError: any) {
          errors.push(`Role assignment discovery failed: ${raError.message}`);
        }

        // 5. Extract identities and IAM relationships
        const identityResult = extractAzureIdentities(
          [...allIdentityResources, ...roleAssignmentResources],
          tenantId,
          this.idUtils,
        );
        identities.push(...identityResult.identities);
        iamRoleAssignments.push(...identityResult.roleAssignments);
        relationships.push(...identityResult.relationships);

      } catch (error: any) {
        errors.push(`Azure discovery failed: ${error.message}`);
      }
    }

    // Future: Add AWS, GCP, etc.

    return {
      resources,
      identities,
      iamRoleAssignments,
      relationships,
      totalResources: resources.length,
      totalIdentities: identities.length,
      totalRoleAssignments: iamRoleAssignments.length,
      totalRelationships: relationships.length,
      errors,
    };
  }
}

export interface CloudDiscoveryOutput {
  resources: CloudResource[];
  identities: AzureIdentity[];
  iamRoleAssignments: IamRoleAssignment[];
  relationships: Relationship[];
  totalResources: number;
  totalIdentities: number;
  totalRoleAssignments: number;
  totalRelationships: number;
  errors: string[];
}
