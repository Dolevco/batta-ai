import type {
  CodeService,
  BuildArtifact,
  DeploymentArtifact,
  CloudResource,
  Relationship,
  RelationshipType,
  RepositoryBriefing,
} from '@batta/shared';
import type { CloudResourceRepository } from '../../cloud/repository/cloud-resource-repository';

export const VALID_RELATIONSHIP_TYPES: RelationshipType[] = [
  'CONTAINS', 'DEPENDS_ON', 'IMPLEMENTS', 'MODIFIED_BY', 'DEPLOYED_TO',
  'OWNS', 'USES', 'BUILDS', 'DEPLOYS', 'CONNECTS_TO', 'EXPOSED_TO_INTERNET',
  'ASSUMES_ROLE', 'READS_FROM', 'WRITES_TO', 'TRUSTS', 'AUTHENTICATES_WITH',
  'AUTHORIZES_WITH', 'CROSSES_BOUNDARY',
  // Dependency graph relationships (Steps 2.5 and 2.6)
  'CALLS_SERVICE', 'CALLS_API',
  'SUBSCRIBES_TO', 'PUBLISHES_TO',
  'READS_STORAGE', 'WRITES_STORAGE',
];

/**
 * Relationship types that describe how a service is deployed to and interacts
 * with cloud infrastructure at runtime.
 */
export const CLOUD_REL_TYPES: Set<RelationshipType> = new Set([
  'DEPLOYED_TO', 'USES', 'CONNECTS_TO', 'EXPOSED_TO_INTERNET',
  'READS_FROM', 'WRITES_TO', 'AUTHENTICATES_WITH', 'AUTHORIZES_WITH',
  'ASSUMES_ROLE', 'CROSSES_BOUNDARY', 'TRUSTS',
  'ASSIGNED_TO', 'HAS_ROLE',
  // Dependency graph (ExternalDep correlation)
  'CALLS_SERVICE', 'CALLS_API',
  'SUBSCRIBES_TO', 'PUBLISHES_TO',
  'READS_STORAGE', 'WRITES_STORAGE',
]);

export interface ServiceRelationshipsInput {
  tenantId: string;
  repositoryPath: string;
  services: CodeService[];
  buildArtifacts: BuildArtifact[];
  deploymentArtifacts: DeploymentArtifact[];
  /**
   * In-memory indexed store for cloud resources.
   * Replaces the flat `cloudResources: CloudResource[]` to enable
   * scope-aware, bounded queries in Steps 3 and 5.
   *
   * Build it with: `new CloudResourceRepository(cloudOutput.resources)`
   *
   * For backward compatibility, `cloudResources` is also accepted
   * (see ServiceRelationshipsExtractor.extract() for the migration shim).
   */
  cloudRepository?: CloudResourceRepository;
  /**
   * @deprecated Use cloudRepository instead.
   * Kept for backward compatibility — the extractor wraps this in a
   * CloudResourceRepository automatically if cloudRepository is not provided.
   */
  cloudResources?: CloudResource[];
  /**
   * Optional repository briefing produced before the SRE pipeline.
   * Injected as orientation context into Step 1 (Service Analysis) so each
   * service agent starts with a consistent picture of the repository.
   */
  repositoryBriefing?: RepositoryBriefing;
  /**
   * Optional allow-list of analysis domains to run.
   * undefined means all steps run (default full behaviour).
   *
   * 'iac'                   — Steps 0, 0.5 (IaC/script analysis), 5, 6
   * 'services'              — Steps 1, 2, 2.5, 3, 4 (build + service analysis + build→service/deployment)
   * 'service_relationships' — Steps 2.6, 7 (service call correlation + service→cloud)
   */
  domains?: Array<'iac' | 'services' | 'service_relationships'>;
}

export interface ServiceRelationshipsResult {
  relationships: Relationship[];
  updatedServices: CodeService[];
  updatedDeploymentArtifacts: DeploymentArtifact[];
  updatedBuildArtifacts: BuildArtifact[];
}
