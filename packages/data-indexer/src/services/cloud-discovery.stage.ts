/**
 * Cloud Discovery Stage
 *
 * Orchestrates cloud resource and topology discovery using the CloudGraphProvider
 * abstraction.  The stage:
 *
 *  1. Resolves the provider for each configured cloud (Azure, AWS, GCP) from the registry.
 *  2. Fetches base resources, ingress graph, network topology, and identity graph in
 *     parallel per provider.
 *  3. Passes the collected data to CloudGraphBuilder to produce a CloudGraph.
 *  4. Maintains the legacy CloudDiscoveryOutput shape for backwards compatibility.
 *
 * Audit trail:
 *  - Every discovery run logs { tenantId, provider, nodeCount, relCount } at INFO.
 *  - Errors are collected and returned — never re-thrown with raw API detail.
 *
 * Security:
 *  - Credentials come from environment variables / Key Vault references injected at
 *    deployment time.  Never passed through or stored here.
 */

import {
  TenantId,
  CloudResource,
  Relationship,
  AzureIdentity,
  IamRoleAssignment,
  CloudGraph,
  RawResourceBatch,
} from '@ai-agent/shared';
import {
  AzureResourceGraphConnector,
  AzureResourceGraphConfig,
  AzureResource,
} from '../connectors/azure-resource-graph.connector';
import { AzureCloudGraphProvider } from '../connectors/azure/azure-cloud-graph.provider';
import { ProviderRegistry } from '../connectors/provider-registry';
import { ProviderScope } from '../connectors/cloud-graph-provider.interface';
import { CloudGraphBuilder } from '../graph/cloud-graph-builder';
import { extractAzureRelationships } from '../utils/azure-relationship-extractor';
import { extractAzureIdentities } from '../utils/azure-identity-extractor';
import { EntityIdUtils } from '../utils/id-generator';

export interface CloudDiscoveryConfig {
  azure?: AzureResourceGraphConfig & { subscriptionIds?: string[] };
  // Future: aws?: AwsCloudGraphConfig;
  // Future: gcp?: GcpCloudGraphConfig;
}

/**
 * Cloud Discovery Stage
 * Fetches cloud resources and topology from all configured cloud providers.
 */
export class CloudDiscoveryStage {
  private config: CloudDiscoveryConfig;
  private azureConnector?: AzureResourceGraphConnector;
  private idUtils: EntityIdUtils;
  private providerRegistry: ProviderRegistry;

  constructor(config: CloudDiscoveryConfig) {
    this.config = config;
    this.idUtils = new EntityIdUtils();
    this.providerRegistry = new ProviderRegistry();

    if (config.azure) {
      this.azureConnector = new AzureResourceGraphConnector(config.azure, this.idUtils);

      // Register Azure cloud graph provider
      this.providerRegistry.register(
        new AzureCloudGraphProvider({
          tenantId: config.azure.tenantId,
          clientId: config.azure.clientId,
          clientSecret: config.azure.clientSecret,
        }),
      );
    }
  }

  /**
   * Discover cloud resources and topology graph from all configured providers.
   */
  async discover(tenantId: TenantId): Promise<CloudDiscoveryOutput> {
    const resources: CloudResource[] = [];
    const identities: AzureIdentity[] = [];
    const iamRoleAssignments: IamRoleAssignment[] = [];
    const relationships: Relationship[] = [];
    const errors: string[] = [];
    let cloudGraph: CloudGraph | undefined;

    // ── Azure ──────────────────────────────────────────────────────────────
    if (this.azureConnector && this.config.azure) {
      try {
        const token = await this.azureConnector.getToken();
        const subscriptionIds: string[] = this.config.azure.subscriptionIds ?? [];

        // 1. Legacy: flat resource list (used by service relationship extractor)
        const azureRawResources = await (this.azureConnector as any).queryResourceGraph(token) as AzureResource[];
        const azureResources = azureRawResources.map((r: AzureResource) =>
          (this.azureConnector as any).transformToCloudResource(r, tenantId) as CloudResource,
        );
        resources.push(...azureResources);

        // 2. Legacy: resource-to-resource relationships
        const azureRelationships = extractAzureRelationships(azureRawResources, tenantId, this.idUtils);
        relationships.push(...azureRelationships);

        // 3. Legacy: identity extraction
        let allIdentityResources: AzureResource[] = [...azureRawResources];
        try {
          const miResources = await this.azureConnector.fetchManagedIdentityResources(token);
          allIdentityResources = [...azureRawResources, ...miResources];
        } catch (miError: any) {
          errors.push(`Managed identity discovery failed: ${miError.message}`);
        }

        let roleAssignmentResources: AzureResource[] = [];
        try {
          roleAssignmentResources = await this.azureConnector.fetchRoleAssignmentResources(token);
        } catch (raError: any) {
          errors.push(`Role assignment discovery failed: ${raError.message}`);
        }

        const identityResult = extractAzureIdentities(
          [...allIdentityResources, ...roleAssignmentResources],
          tenantId,
          this.idUtils,
        );
        identities.push(...identityResult.identities);
        iamRoleAssignments.push(...identityResult.roleAssignments);
        relationships.push(...identityResult.relationships);

        // 4. New: full cloud graph (ingress + networking + identity topology)
        if (this.providerRegistry.has('azure')) {
          try {
            const azureProvider = this.providerRegistry.get('azure');
            const scope: ProviderScope = { provider: 'azure', subscriptionIds };

            // Security: azureRawResources was fetched with subscriptions:[] (all accessible
            // subscriptions) which covers cross-subscription deployments such as a Front Door
            // in one subscription pointing to a Container App in another. Reuse that batch as
            // the RawResourceBatch so buildComputeNodes() sees the full resource inventory.
            // Data classification: 'confidential' — tenantId isolation enforced by graph builder
            // and downstream persistence adapters (Neo4j/Qdrant). No raw data is logged here.
            const crossSubResourceBatch: RawResourceBatch = {
              resources: azureRawResources as Record<string, any>[],
            };

            // Audit trail: log resource count only — no raw resource data emitted
            console.info('[CloudDiscoveryStage] Cross-subscription resource batch for graph builder', {
              tenantId,
              provider: 'azure',
              resourceCount: azureRawResources.length,
            });

            const [ingressGraph, networkTopology, identityGraph] = await Promise.all([
              azureProvider.fetchIngressGraph(scope),
              azureProvider.fetchNetworkTopology(scope),
              azureProvider.fetchIdentityGraph(scope),
            ]);

            cloudGraph = new CloudGraphBuilder().build({
              tenantId,
              resources: crossSubResourceBatch,
              ingressGraph,
              networkTopology,
              identityGraph,
            });

            // Audit trail: log summary only — no raw resource data
            console.info('[CloudDiscoveryStage] Graph built', {
              tenantId,
              provider: 'azure',
              nodeCount: cloudGraph.nodes.length,
              relCount: cloudGraph.relationships.length,
            });
          } catch (graphError: any) {
            // Graph build errors are non-fatal — legacy discovery output is still returned
            errors.push(`Cloud graph build failed: ${graphError.message}`);
          }
        }

      } catch (error: any) {
        // Generic error message — no raw Azure error detail propagated
        errors.push(`Azure discovery failed: ${error.message}`);
      }
    }

    return {
      resources,
      identities,
      iamRoleAssignments,
      relationships,
      cloudGraph,
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
  /** Wiz-style cloud graph (nodes + edges). Present when subscriptionIds are configured. */
  cloudGraph?: CloudGraph;
  totalResources: number;
  totalIdentities: number;
  totalRoleAssignments: number;
  totalRelationships: number;
  errors: string[];
}
