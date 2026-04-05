/**
 * Code Indexing Pipeline
 * 
 * Agent-native, DB-agnostic code indexer following canonical contract.
 * Implements a 5-stage pipeline:
 * 1. Discovery - Find repositories and artifacts
 * 2. Extraction - Parse code and extract raw facts
 * 3. Transformation - Convert to canonical entities
 * 4. Semantic Analysis - Generate LLM descriptions (cached)
 * 5. Persistence - Project to downstream stores
 */

import type { CodeIntegrationHandler } from '@ai-agent/shared';
import {
  IndexingPipeline,
  IndexingOptions,
  DiscoveryScope,
  SemanticAnalysisOutput,
} from '../types/pipeline.types';
import {
  TenantId,
  IndexingResult,
  CodeService,
  DeploymentArtifact,
  BuildArtifact,
} from '@ai-agent/shared';
import { EntityIdUtils } from '../utils/id-generator';
import { CloudDiscoveryStage, CloudDiscoveryConfig } from '../services/cloud-discovery.stage';
import { ServiceRelationshipsExtractor } from '../services/service-relationships-extractor/index';
import { RepositoryResponsibilityCalculator } from '../services/repository-responsibility-calculator';
import { createDataIndexerRegistry } from '../agents';

// Import stages
import { CodeDiscoveryStage, type CodeIndexerConfig } from './stages/discovery.stage';
import { CodeExtractionStage } from './stages/extraction.stage';
import { CodeTransformationStage } from './stages/transformation.stage';
import { CodeSemanticAnalysisStage } from './stages/semantic-analysis.stage';
import { CodePersistenceStage } from './stages/persistence.stage';

// Re-export config for convenience
export type { CodeIndexerConfig };

/**
 * Main Code Indexing Pipeline
 */
export class CodeIndexingPipeline implements IndexingPipeline {
  private tenantId: TenantId;
  private integrations: CodeIntegrationHandler[];
  private config: CodeIndexerConfig;
  private idUtils: EntityIdUtils;
  
  private discoveryStage: CodeDiscoveryStage;
  private extractionStage: CodeExtractionStage;
  private transformationStage: CodeTransformationStage;
  private semanticStage: CodeSemanticAnalysisStage;
  private persistenceStage: CodePersistenceStage;
  private cloudDiscoveryStage?: CloudDiscoveryStage;
  private serviceRelationshipsExtractor: ServiceRelationshipsExtractor;
  private repositoryResponsibilityCalculator: RepositoryResponsibilityCalculator;

  constructor(
    tenantId: TenantId,
    integrationOrIntegrations: CodeIntegrationHandler | CodeIntegrationHandler[],
    config: CodeIndexerConfig,
  ) {
    this.tenantId = tenantId;
    this.integrations = Array.isArray(integrationOrIntegrations)
      ? integrationOrIntegrations
      : [integrationOrIntegrations];
    this.config = config;
    this.idUtils = new EntityIdUtils();
    
    // Initialize stages
    this.discoveryStage = new CodeDiscoveryStage(this.integrations, config);
    this.extractionStage = new CodeExtractionStage(config);
    this.transformationStage = new CodeTransformationStage(tenantId, this.idUtils);
    
    // Initialize semantic stage with API
    const repositoryPath = config.localPath || config.cloneDir;
    this.semanticStage = new CodeSemanticAnalysisStage(tenantId, this.idUtils, config.api, repositoryPath!);
    
    // Initialize persistence stage with optional Qdrant and Neo4j
    this.persistenceStage = new CodePersistenceStage(config.qdrant, config.neo4j);
    
    // Initialize cloud discovery if configured
    if (config.enableCloudDiscovery && config.cloudDiscovery) {
      this.cloudDiscoveryStage = new CloudDiscoveryStage(config.cloudDiscovery);
    }
    
    // Single pipeline: analysis then correlation, both in the correct order
    const registry = createDataIndexerRegistry(config.api, config.smallApi);
    this.serviceRelationshipsExtractor = new ServiceRelationshipsExtractor(registry, config.neo4j, config.qdrant);
    this.repositoryResponsibilityCalculator = new RepositoryResponsibilityCalculator(config.api, config.qdrant, config.neo4j);
  }

  async run(
    tenantId: TenantId,
    scope: DiscoveryScope,
    options?: IndexingOptions
  ): Promise<IndexingResult> {
    const runId = crypto.randomUUID();
    const startTime = Date.now();
    const errors: string[] = [];
    const warnings: string[] = [];

    console.log(`[${runId}] Starting code indexing for tenant ${tenantId}`);

    try {
      // Stage 1: Discovery
      console.log(`[${runId}] Stage 1: Discovery`);
      const discovery = await this.discoveryStage.discover(tenantId, scope);
      console.log(`[${runId}] Discovered ${discovery.repositories.length} repositories`);

      // Stage 2: Extraction
      console.log(`[${runId}] Stage 2: Extraction`);
      const extraction = await this.extractionStage.extract(tenantId, discovery.repositories);
      console.log(
        `[${runId}] Extracted ${extraction.repositories.length} repositories, ` +
        `${extraction.services.length} services, ` +
        `${extraction.modules.length} modules, ` +
        `${extraction.buildArtifacts.length} build artifacts, ` +
        `${extraction.deploymentArtifacts.length} deployment artifacts, ` +
        `${extraction.dependencies.length} dependencies, ` +
        `${extraction.commits.length} commits`
      );
      errors.push(...extraction.errors.map(e => e.message));

      // Stage 3: Transformation
      console.log(`[${runId}] Stage 3: Transformation`);
      const transformation = await this.transformationStage.transform(tenantId, extraction);
      console.log(
        `[${runId}] Transformed to ${transformation.entities.length} entities, ` +
        `${transformation.relationships.length} relationships, ` +
        `${transformation.evidence.length} evidence`
      );
      errors.push(...transformation.errors.map(e => e.message));

      // Stage 3.5: Cloud Discovery (optional)
      if (this.cloudDiscoveryStage) {
        console.log(`[${runId}] Stage 3.5: Cloud Discovery`);
        const cloudDiscovery = await this.cloudDiscoveryStage.discover(tenantId);
        console.log(
          `[${runId}] Discovered ${cloudDiscovery.totalResources} cloud resources, ` +
          `${cloudDiscovery.totalIdentities} identities, ` +
          `${cloudDiscovery.totalRoleAssignments} role assignments, ` +
          `${cloudDiscovery.totalRelationships} relationships`
        );
        
        // Add cloud resources, identities, and role assignments to entities
        transformation.entities.push(...cloudDiscovery.resources);
        transformation.entities.push(...cloudDiscovery.identities);
        transformation.entities.push(...cloudDiscovery.iamRoleAssignments);

        // Add cloud resource relationships (topology + IAM)
        transformation.relationships.push(...cloudDiscovery.relationships);
        
        errors.push(...cloudDiscovery.errors);
      }

      // Stage 4: Semantic Analysis (optional)
      let semantic: SemanticAnalysisOutput = {
        documents: [],
        cacheHits: 0,
        cacheMisses: 0,
        errors: [],
      };
      
      // Stage 4: Semantic Analysis (build + deployment artifacts only)
      // NOTE: code_service entities are skipped here; their responsibility is
      // derived from the skeleton output of the 3-pass ServiceAnalyzer in Stage 4.5
      // and a dedicated semantic doc is generated below after SRE completes.
      console.log(`[${runId}] Stage 4: Semantic Analysis (build/deployment artifacts)`);
      semantic = await this.semanticStage.analyze(
        tenantId,
        transformation.entities,
        extraction
      );
      console.log(
        `[${runId}] Generated ${semantic.documents.length} semantic documents ` +
        `(${semantic.cacheHits} cache hits, ${semantic.cacheMisses} cache misses)`
      );
      errors.push(...semantic.errors.map(e => e.message));

      // Stage 4.5: Analysis + Correlation (analysis first, then correlation with enriched context)
      console.log(`[${runId}] Stage 4.5: Analysis + Correlation`);
      const services = transformation.entities.filter(e => e.entityType === 'code_service') as CodeService[];
      const buildArtifacts = transformation.entities.filter(e => e.entityType === 'build_artifact') as BuildArtifact[];
      const deploymentArtifacts = transformation.entities.filter(e => e.entityType === 'deployment_artifact') as DeploymentArtifact[];
      const cloudResources = transformation.entities.filter(e => e.entityType === 'cloud_resource');
      
      if (discovery.repositories.length > 0) {
        const repository = discovery.repositories[0];
        const repositoryPath = this.config.localPath || repository.clonePath || this.config.cloneDir;
        const repositoryEntity = transformation.entities.find(e => e.entityType === 'code_repository');
        
        if (repositoryPath && repositoryEntity) {
          const sreResult = await this.serviceRelationshipsExtractor.extract({
            tenantId,
            repositoryPath,
            services,
            buildArtifacts,
            deploymentArtifacts,
            cloudResources: cloudResources as any[],
          });

          // Merge enriched entities back
          const merge = (updated: any[]) => updated.forEach((u) => {
            const idx = transformation.entities.findIndex((e) => e.id === u.id);
            if (idx !== -1) transformation.entities[idx] = u;
          });
          merge(sreResult.updatedServices);
          merge(sreResult.updatedDeploymentArtifacts);
          merge(sreResult.updatedBuildArtifacts);

          transformation.relationships.push(...sreResult.relationships);
          console.log(`[${runId}] Analysis + Correlation complete: ${sreResult.relationships.length} relationships discovered`);

          // Stage 4.5.1: Generate service semantic docs from skeleton-derived responsibility.
          // This replaces the old CodeSemanticAnalysisStage service pass (15-iter LLM call per service).
          // The skeleton produced by the 3-pass ServiceAnalyzer has already set service.responsibility
          // on each enriched service entity; we convert that to SemanticDocument objects here.
          const enrichedServices = sreResult.updatedServices.filter(
            s => s.entityType === 'code_service' && s.responsibility
          ) as CodeService[];
          if (enrichedServices.length > 0) {
            const serviceDocs = enrichedServices.map(s =>
              this.semanticStage.buildServiceSemanticDoc(tenantId, s)
            );
            semantic.documents.push(...serviceDocs);
            console.log(
              `[${runId}] Generated ${serviceDocs.length} skeleton-derived service semantic doc(s)`
            );
          }

          // Calculate repository-level responsibility from enriched child responsibilities
          console.log(`[${runId}] Stage 4.6: Repository Responsibility`);
          await this.repositoryResponsibilityCalculator.calculate(tenantId, transformation.entities);
          console.log(`[${runId}] Repository responsibility calculated`);
        }
      }

      // Stage 5: Persistence
      console.log(`[${runId}] Stage 5: Persistence`);
      const persistence = await this.persistenceStage.persist(
        tenantId,
        transformation,
        semantic
      );
      console.log(
        `[${runId}] Persisted ${persistence.relational.entitiesWritten} entities, ` +
        `${persistence.relational.relationshipsWritten} relationships, ` +
        `${persistence.relational.evidenceWritten} evidence`
      );
      errors.push(...persistence.errors.map(e => e.message));

      const duration = Date.now() - startTime;
      console.log(`[${runId}] Indexing completed in ${duration}ms`);

      return {
        runId,
        tenantId,
        entities: transformation.entities,
        relationships: transformation.relationships,
        evidence: transformation.evidence,
        semanticDocuments: semantic.documents,
        summary: {
          duration,
          entitiesDiscovered: transformation.entities.length,
          relationshipsDiscovered: transformation.relationships.length,
          evidenceCreated: transformation.evidence.length,
          semanticDocumentsCreated: semantic.documents.length,
          errors,
          warnings,
        },
      };
    } catch (error: any) {
      errors.push(`Pipeline failed: ${error.message}`);
      throw error;
    }
  }
}
