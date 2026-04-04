/**
 * LLMCorrelator — thin façade
 *
 * All analysis and correlation logic now lives in ServiceRelationshipsExtractor,
 * which runs the full pipeline in the correct order:
 *   Analysis first  (IaC, build artifacts, services)
 *   Correlation after (with enriched context)
 *
 * This class is retained for backward compatibility with callers that still
 * construct an LLMCorrelator directly (e.g. examples, code.pipeline.ts).
 * It delegates entirely to ServiceRelationshipsExtractor.
 */

import type { ILLMApiHandler } from '@ai-agent/core';
import type {
  BuildArtifact,
  CodeService,
  DeploymentArtifact,
  CloudResource,
  Relationship,
  EntityId,
  TenantId,
} from '@ai-agent/shared';
import { Neo4jAdapter, QdrantAdapter } from '@ai-agent/shared';
import { ServiceRelationshipsExtractor } from './service-relationships-extractor/index';

// ─── Public types (unchanged) ────────────────────────────────────────────────

export interface RepositoryCorrelationInput {
  tenantId: TenantId;
  repositoryId: EntityId;
  repositoryPath: string;
  services: CodeService[];
  buildArtifacts: BuildArtifact[];
  deploymentArtifacts: DeploymentArtifact[];
  cloudResources: CloudResource[];
}

export interface CorrelationResult {
  relationships: Relationship[];
  reasoning: string;
}

// ─── LLMCorrelator ───────────────────────────────────────────────────────────

export class LLMCorrelator {
  private extractor: ServiceRelationshipsExtractor;

  constructor(api: ILLMApiHandler, neo4j?: Neo4jAdapter, qdrant?: QdrantAdapter) {
    this.extractor = new ServiceRelationshipsExtractor(api, neo4j, qdrant);
  }

  /**
   * Run the full analysis + correlation pipeline.
   *
   * Delegates to ServiceRelationshipsExtractor which guarantees:
   *   1. All entity analysis runs first (Steps 0 / 0.5 / 1).
   *   2. All correlations run after (Steps 2–7), using the enriched context.
   */
  async correlateRepository(input: RepositoryCorrelationInput): Promise<CorrelationResult> {
    const result = await this.extractor.extract({
      tenantId: input.tenantId,
      repositoryPath: input.repositoryPath,
      services: input.services,
      buildArtifacts: input.buildArtifacts,
      deploymentArtifacts: input.deploymentArtifacts,
      cloudResources: input.cloudResources,
    });

    return {
      relationships: result.relationships,
      reasoning: result.relationships.length > 0
        ? `${result.relationships.length} relationship(s) found across all entity types`
        : 'No relationships found',
    };
  }
}
