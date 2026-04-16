/**
 * Repository Task Processor
 *
 * Orchestrates repository indexing through 6 sequential stages:
 *
 *   Stage 1 – EXTRACT_TRANSFORM       Extract code entities, transform, persist to Qdrant + Neo4j
 *   Stage 2 – CLOUD_DISCOVERY         Discover Azure resources, identities, IAM assignments
 *   Stage 3 – SEMANTIC_ANALYSIS       (reserved for future use)
 *   Stage 4 – LLM_CORRELATION         SRE Steps 0–7: analysis, correlation, threat model
 *   Stage 5 – FEATURE_EXTRACTION      DFD + per-feature threat model + service-level threat model
 *   Stage 6 – EXPLOITABILITY_ANALYSIS Graph-based exploitability using unified security context
 *                                     (sees both cloud-graph TM from Stage 4 and DFD TM from Stage 5)
 *
 * Each stage saves a checkpoint so the task can resume after failure.
 */

import * as crypto from 'crypto';
import simpleGit from 'simple-git';
import { TenantId, CanonicalEntity, Relationship, Evidence, SemanticDocument } from '@ai-agent/shared';
import { createIndexingRunRepository } from '@ai-agent/shared';
import type { IIndexingRunRepository } from '@ai-agent/shared';
import type { IndexingRun } from '@ai-agent/shared';
import {
  IndexRepositoryTask,
  IndexingDomain,
  TaskCheckpoint,
  TaskStage,
  TaskResult,
} from '../types/queue.types';
import { EntityIdUtils } from '../utils/id-generator';
import { CodeExtractionStage } from '../connectors/stages/extraction.stage';
import { CodeTransformationStage } from '../connectors/stages/transformation.stage';
import { CodePersistenceStage } from '../connectors/stages/persistence.stage';
import { CloudDiscoveryStage } from './cloud-discovery.stage';
import { BusinessFeatureExtractor } from './business-feature-extractor';
import { ServiceRelationshipsExtractor } from './service-relationships-extractor/index';
import { RepositoryResponsibilityCalculator } from './repository-responsibility-calculator';
import { RepositoryBriefingService } from './repository-briefing';
import { CheckpointManager } from './checkpoint-manager';
import { IntegrationFetcher } from './integration-fetcher';
import { RepositorySetup } from './repository-setup';
import { CloudResourceRepository } from './cloud-resource-repository';
import type { CodeIndexerConfig } from '../connectors/stages/discovery.stage';
import type { CodeService, DeploymentArtifact, BuildArtifact, RepositoryBriefing } from '@ai-agent/shared';
import { createDataIndexerRegistry } from '../agents';
import { cloudGraphToQdrantEntities } from '../utils/cloud-graph-to-qdrant';

export interface TaskProcessorConfig extends CodeIndexerConfig {
  checkpointManager: CheckpointManager;
  integrationFetcher?: IntegrationFetcher;
  /** Optional: if provided, IndexingRun audit records are persisted. */
  indexingRunRepository?: IIndexingRunRepository;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Resolve the repository path from the task and config, preferring the
 * cloned path set during repository setup.
 */
function resolveRepositoryPath(
  task: IndexRepositoryTask,
  config: TaskProcessorConfig,
): string | undefined {
  return task.repository.clonePath || config.localPath || config.cloneDir;
}

/**
 * Merge an in-memory entity on top of a DB entity.
 * In-memory fields always win over stale DB data so newly extracted values
 * are never discarded.
 */
function mergeWithDb(
  inMemory: CanonicalEntity,
  dbEntityMap: Map<string, CanonicalEntity>,
): CanonicalEntity {
  const dbEntity = dbEntityMap.get(inMemory.id);
  return dbEntity ? { ...dbEntity, ...inMemory } : inMemory;
}

/**
 * Patch updated entities back into the master entity list (in-place).
 * Entities not found in the list (e.g. new cloud resources) are ignored here —
 * they live in their own slices.
 */
function patchEntities(entities: CanonicalEntity[], updated: CanonicalEntity[]): void {
  updated.forEach((u) => {
    const idx = entities.findIndex((e) => e.id === u.id);
    if (idx !== -1) entities[idx] = u;
  });
}

// ── RepositoryTaskProcessor ────────────────────────────────────────────────────

/**
 * Processes a single repository indexing task with checkpointing.
 */
export class RepositoryTaskProcessor {
  private config: TaskProcessorConfig;
  private idUtils: EntityIdUtils;
  private extractionStage: CodeExtractionStage;
  private transformationStage: CodeTransformationStage;
  private persistenceStage: CodePersistenceStage;
  private cloudDiscoveryStage?: CloudDiscoveryStage;
  private businessFeatureExtractor: BusinessFeatureExtractor;
  private serviceRelationshipsExtractor: ServiceRelationshipsExtractor;
  private repositoryResponsibilityCalculator: RepositoryResponsibilityCalculator;
  private repositoryBriefingService: RepositoryBriefingService;
  private checkpointManager: CheckpointManager;
  private integrationFetcher: IntegrationFetcher;
  private repositorySetup: RepositorySetup;
  private tenantId: TenantId;
  private indexingRunRepository?: IIndexingRunRepository;

  constructor(tenantId: TenantId, config: TaskProcessorConfig) {
    this.tenantId = tenantId;
    this.config = config;
    this.idUtils = new EntityIdUtils();

    this.extractionStage = new CodeExtractionStage(config);
    this.transformationStage = new CodeTransformationStage(tenantId, this.idUtils);
    this.persistenceStage = new CodePersistenceStage(config.qdrant, config.neo4j);

    if (config.enableCloudDiscovery && config.cloudDiscovery) {
      this.cloudDiscoveryStage = new CloudDiscoveryStage(config.cloudDiscovery);
    }

    // ServiceRelationshipsExtractor runs Steps 0–7 (analysis + correlation + threat model).
    // Exploitability (Step 8) is exposed separately so Stage 6 can call it after
    // feature extraction, giving it access to the DFD-based threat model.
    const registry = createDataIndexerRegistry(config.api, config.smallApi);
    this.serviceRelationshipsExtractor = new ServiceRelationshipsExtractor(registry, config.neo4j, config.qdrant);
    this.repositoryResponsibilityCalculator = new RepositoryResponsibilityCalculator(config.api, config.qdrant, config.neo4j);
    this.repositoryBriefingService = new RepositoryBriefingService(registry, config.qdrant, config.neo4j);
    this.businessFeatureExtractor = new BusinessFeatureExtractor(registry, config.qdrant, config.neo4j);
    this.checkpointManager = config.checkpointManager;

    this.integrationFetcher = config.integrationFetcher || new IntegrationFetcher();
    this.repositorySetup = new RepositorySetup({
      cloneDir: config.cloneDir || '/tmp/clones',
    });

    this.indexingRunRepository = config.indexingRunRepository;
  }

  /**
   * Process a repository indexing task through all 6 stages with checkpointing.
   * @param onStageChange Optional callback invoked at the start and end of each stage.
   */
  async processTask(
    task: IndexRepositoryTask,
    onStageChange?: (stage: TaskStage, status: 'running' | 'completed' | 'failed', itemsProcessed?: number) => void,
  ): Promise<TaskResult> {
    const startTime = Date.now();
    const result: TaskResult = {
      taskId: task.taskId,
      tenantId: task.tenantId,
      repositoryName: task.repository.name,
      success: false,
      duration: 0,
      stages: {},
      summary: {
        entitiesCreated: 0,
        relationshipsCreated: 0,
        evidenceCreated: 0,
        semanticDocumentsCreated: 0,
        errors: [],
      },
    };

    console.log(`[${task.taskId}] Processing repository: ${task.repository.name}`);

    let indexingRun: IndexingRun | undefined;
    let headCommitSha: string | undefined;

    try {
      // ── Setup: integrations ─────────────────────────────────────────────
      console.log(`[${task.taskId}] Fetching integrations for tenant ${task.tenantId}`);
      await this.integrationFetcher.initialize();
      const integrations = await this.integrationFetcher.fetchIntegrations(task.tenantId);

      // ── Setup cloud discovery from fetched integration ───────────────────
      this.setupCloudDiscovery(task, integrations);

      // ── Cloud-only path: skip code extraction entirely ───────────────────
      // When scope='cloud' we only need cloud discovery — no repo clone needed.
      if (task.options.scope === 'cloud') {
        if (!this.cloudDiscoveryStage) {
          throw new Error(`Cloud-only scan requested but no cloud integration found for tenant ${task.tenantId}`);
        }
        const { resolvedRunType } = await this.resolveRunType(task);
        indexingRun = await this.createIndexingRun(task, resolvedRunType, undefined);

        const entities: CanonicalEntity[] = [];
        const relationships: Relationship[] = [];
        await this.runCloudDiscoveryStage(task, entities, relationships, result, onStageChange);

        result.summary.entitiesCreated = entities.length;
        result.summary.relationshipsCreated = relationships.length;
        result.summary.runType = resolvedRunType;
        result.success = true;
        result.duration = Date.now() - startTime;
        await this.completeIndexingRun(task, indexingRun, undefined, result);
        console.log(`[${task.taskId}] Cloud-only task completed in ${result.duration}ms`);
        return result;
      }

      if (!integrations.codeIntegrations.length) {
        throw new Error(`No code integration found for tenant ${task.tenantId}`);
      }

      // Pick the best integration for this specific repository.
      // Prefer the one whose base URL host matches the repo URL host; fall back to first.
      const repoHost = (() => {
        try { return new URL(task.repository.url).hostname; } catch { return ''; }
      })();
      const chosenIntegration = integrations.codeIntegrations.find((ci) => {
        try {
          const defaultBaseUrl = (ci as any).id === 'gitlab' ? 'https://gitlab.com' : 'https://github.com';
          return new URL((ci as any).config?.baseUrl ?? defaultBaseUrl).hostname === repoHost;
        } catch { return false; }
      }) ?? integrations.codeIntegrations[0];

      console.log(`[${task.taskId}] Setting up repository ${task.repository.name}`);
      const repositoryPath = await this.repositorySetup.ensureRepository(
        task.repository,
        chosenIntegration,
      );
      task.repository.clonePath = repositoryPath;

      // ── Resolve HEAD commit SHA (used as sinceCommit for the next run) ───
      // Security: read-only git command on local clone; not user-controlled.
      headCommitSha = await this.resolveHeadCommit(task.taskId, repositoryPath);

      // ── Resolve run type + sinceCommit ───────────────────────────────────
      const { resolvedRunType, resolvedSinceCommit } = await this.resolveRunType(task);

      // ── Create IndexingRun audit record ──────────────────────────────────
      // Security: tenantId comes from the task (set by API from JWT), not user input.
      indexingRun = await this.createIndexingRun(task, resolvedRunType, resolvedSinceCommit);

      // ── Checkpoint resume ────────────────────────────────────────────────
      const checkpoint = await this.checkpointManager.getCheckpoint(task.taskId);
      let currentStage = checkpoint?.stage || TaskStage.EXTRACT_TRANSFORM;

      // ── Stage 1: Extract + Transform + Persist ───────────────────────────
      let entities: CanonicalEntity[];
      let relationships: Relationship[];
      let evidence: Evidence[];

      if (currentStage === TaskStage.EXTRACT_TRANSFORM) {
        const stageResult = await this.runExtractTransformStage(task, resolvedSinceCommit, headCommitSha, result, indexingRun, startTime, onStageChange);
        if (stageResult.skipped) return stageResult.result!;
        entities = stageResult.entities!;
        relationships = stageResult.relationships!;
        evidence = stageResult.evidence!;

        await this.saveCheckpoint(task, TaskStage.CLOUD_DISCOVERY, { entities, relationships, evidence });
        currentStage = TaskStage.CLOUD_DISCOVERY;
      } else {
        entities = checkpoint!.data.entities!;
        relationships = checkpoint!.data.relationships!;
        evidence = checkpoint!.data.evidence!;
        console.log(`[${task.taskId}] Resumed from checkpoint at stage: ${currentStage}`);
      }

      // ── Stage 2: Cloud Discovery (optional) ─────────────────────────────
      if (currentStage === TaskStage.CLOUD_DISCOVERY && this.cloudDiscoveryStage && task.options.enableCloudDiscovery) {
        await this.runCloudDiscoveryStage(task, entities, relationships, result, onStageChange);
        await this.saveCheckpoint(task, TaskStage.SEMANTIC_ANALYSIS, { entities, relationships, evidence });
      }
      currentStage = TaskStage.SEMANTIC_ANALYSIS;

      // ── Stage 3: Semantic Analysis (reserved, currently skipped) ─────────
      // Responsibility fields are derived in ServiceRelationshipsExtractor (Stage 4).
      const semanticDocuments: SemanticDocument[] = checkpoint?.data.semanticDocuments || [];
      currentStage = TaskStage.LLM_CORRELATION;

      // ── Domain filtering helpers ─────────────────────────────────────────
      // undefined domains means "run everything" (default full scan).
      const domains = task.options.domains;
      const domainEnabled = (d: IndexingDomain) => !domains || domains.includes(d);
      const runLLMCorrelation = domainEnabled('iac') || domainEnabled('services') || domainEnabled('service_relationships');
      const runFeatures = domainEnabled('features');

      // ── Stage 4: LLM Correlation (SRE Steps 0–7) ─────────────────────────
      let repositoryBriefing: RepositoryBriefing | undefined;
      if (currentStage === TaskStage.LLM_CORRELATION) {
        if (runLLMCorrelation) {
          repositoryBriefing = await this.runLLMCorrelationStage(task, entities, relationships, resolvedRunType, result, onStageChange);
        } else {
          onStageChange?.(TaskStage.LLM_CORRELATION, 'completed', 0);
        }
      }

      // ── Stage 5: Feature Extraction ──────────────────────────────────────
      // Must complete before Stage 6 so exploitability sees the DFD-based threat model.
      // The repository briefing from Stage 4 is forwarded so feature-extraction agents
      // immediately have context about the repository structure and can plan exploration.
      if (runFeatures) {
        await this.runFeatureExtractionStage(task, entities, resolvedRunType, result, onStageChange, repositoryBriefing);
      } else {
        onStageChange?.(TaskStage.FEATURE_EXTRACTION, 'completed', 0);
      }

      // ── Stage 6: Exploitability Analysis ─────────────────────────────────
      // Runs after feature extraction to use the unified security context:
      //   - cloud-graph threat model (from Stage 4 / SRE Step 7)
      //   - DFD-based service threat model (from Stage 5 / BusinessFeatureExtractor)
      //   - cloud relationships (in Neo4j)
      if (runFeatures) {
        await this.runExploitabilityStage(task, entities, resolvedRunType, result, onStageChange);
      } else {
        onStageChange?.(TaskStage.EXPLOITABILITY_ANALYSIS, 'completed', 0);
      }

      // ── Finalize ─────────────────────────────────────────────────────────
      result.summary.entitiesCreated = entities.length;
      result.summary.relationshipsCreated = relationships.length;
      result.summary.evidenceCreated = evidence.length;
      result.summary.semanticDocumentsCreated = semanticDocuments.length;
      result.summary.runType = resolvedRunType;
      result.success = true;
      result.duration = Date.now() - startTime;

      await this.checkpointManager.deleteCheckpoint(task.taskId);
      await this.completeIndexingRun(task, indexingRun, headCommitSha, result);

      console.log(`[${task.taskId}] Task completed successfully in ${result.duration}ms`);
      return result;

    } catch (error: any) {
      result.success = false;
      result.duration = Date.now() - startTime;
      result.summary.errors.push(`Task failed: ${error.message}`);
      console.error(`[${task.taskId}] Task failed:`, error);

      if (indexingRun && this.indexingRunRepository) {
        await this.indexingRunRepository.update(indexingRun.id, task.tenantId, {
          status: 'failed',
          completedAt: new Date().toISOString(),
          errors: [{ timestamp: new Date().toISOString(), message: error?.message ?? String(error) }],
        }).catch((updateErr: any) => {
          console.warn(`[${task.taskId}] Failed to update IndexingRun to failed: ${updateErr?.message}`);
        });
      }

      throw error;
    }
  }

  // ── Stage implementations ─────────────────────────────────────────────────

  private async runExtractTransformStage(
    task: IndexRepositoryTask,
    resolvedSinceCommit: string | undefined,
    headCommitSha: string | undefined,
    result: TaskResult,
    indexingRun: IndexingRun | undefined,
    startTime: number,
    onStageChange?: (stage: TaskStage, status: 'running' | 'completed' | 'failed', itemsProcessed?: number) => void,
  ): Promise<{ skipped: boolean; result?: TaskResult; entities?: CanonicalEntity[]; relationships?: Relationship[]; evidence?: Evidence[] }> {
    const stageStart = Date.now();

    onStageChange?.(TaskStage.EXTRACT_TRANSFORM, 'running');
    console.log(`[${task.taskId}] 🔍 Starting extraction stage...`);
    const extraction = await this.extractionStage.extract(task.tenantId, [task.repository], resolvedSinceCommit);

    // Short-circuit: no file changes since last run
    if (extraction.skippedDueToNoChanges) {
      console.log(`[${task.taskId}] ✅ Skipped: no file changes since ${resolvedSinceCommit}`);
      result.summary.skippedDueToNoChanges = true;
      result.summary.runType = (task.options.runType ?? 'full');
      result.success = true;
      result.duration = Date.now() - startTime;
      result.stages[TaskStage.EXTRACT_TRANSFORM] = { completed: true, duration: Date.now() - stageStart, itemsProcessed: 0 };
      onStageChange?.(TaskStage.EXTRACT_TRANSFORM, 'completed', 0);

      await this.checkpointManager.deleteCheckpoint(task.taskId);
      if (indexingRun && this.indexingRunRepository) {
        await this.indexingRunRepository.update(indexingRun.id, task.tenantId, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          // Advance sinceCommit to current HEAD so the next incremental run diffs
          // from the right baseline even after multiple consecutive no-op runs.
          scope: { repositories: [task.repository.url], sinceCommit: headCommitSha },
          metadata: { skippedDueToNoChanges: true },
        }).catch(() => {});
      }
      return { skipped: true, result };
    }

    console.log(`[${task.taskId}] ✅ Extraction complete: ${extraction.services.length} services, ${extraction.modules.length} modules, ${extraction.buildArtifacts.length} build artifacts, ${extraction.deploymentArtifacts.length} deployment artifacts`);

    console.log(`[${task.taskId}] 🔄 Starting transformation stage...`);
    const transformation = await this.transformationStage.transform(task.tenantId, extraction);
    console.log(`[${task.taskId}] ✅ Transformation complete: ${transformation.entities.length} entities, ${transformation.relationships.length} relationships, ${transformation.evidence.length} evidence items`);

    console.log(`[${task.taskId}] 💾 Persisting entities and evidence...`);
    const persistResult = await this.persistenceStage.persistEntities(task.tenantId, transformation.entities, transformation.evidence);
    console.log(`[${task.taskId}] ✅ Persistence complete: ${persistResult.entitiesWritten} entities, ${persistResult.evidenceWritten} evidence items written`);

    // Persist transformation relationships (CONTAINS repo→service, DEPENDS_ON service→service, etc.)
    // Must run after persistEntities so Neo4j MATCH can find the source/target nodes.
    let transformRelPersistErrors: string[] = [];
    if (transformation.relationships.length > 0) {
      console.log(`[${task.taskId}] 💾 Persisting ${transformation.relationships.length} transformation relationships...`);
      const relPersistResult = await this.persistenceStage.persistRelationships(task.tenantId, transformation.relationships);
      console.log(`[${task.taskId}] ✅ Transformation relationships persisted: ${relPersistResult.relationshipsWritten} written`);
      transformRelPersistErrors = relPersistResult.errors.map(e => e.message);
    }

    const errors = [
      ...extraction.errors.map(e => e.message),
      ...transformation.errors.map(e => e.message),
      ...persistResult.errors.map(e => e.message),
      ...transformRelPersistErrors,
    ];
    result.stages[TaskStage.EXTRACT_TRANSFORM] = {
      completed: true,
      duration: Date.now() - stageStart,
      itemsProcessed: transformation.entities.length,
      errors,
    };
    result.summary.errors.push(...errors);
    onStageChange?.(TaskStage.EXTRACT_TRANSFORM, 'completed', transformation.entities.length);

    return {
      skipped: false,
      entities: transformation.entities,
      relationships: transformation.relationships,
      evidence: transformation.evidence,
    };
  }

  private async runCloudDiscoveryStage(
    task: IndexRepositoryTask,
    entities: CanonicalEntity[],
    relationships: Relationship[],
    result: TaskResult,
    onStageChange?: (stage: TaskStage, status: 'running' | 'completed' | 'failed', itemsProcessed?: number) => void,
  ): Promise<void> {
    const stageStart = Date.now();
    onStageChange?.(TaskStage.CLOUD_DISCOVERY, 'running');
    console.log(`[${task.taskId}] ☁️  Starting cloud discovery stage...`);

    const cloudDiscovery = await this.cloudDiscoveryStage!.discover(task.tenantId);
    entities.push(...cloudDiscovery.resources);

    const entityPersistTasks: Promise<void>[] = [];

    if (cloudDiscovery.resources.length > 0) {
      console.log(`[${task.taskId}] 💾 Persisting ${cloudDiscovery.resources.length} cloud resources...`);
      entityPersistTasks.push(
        this.persistenceStage.persistEntities(task.tenantId, cloudDiscovery.resources, [])
          .then(r => { result.summary.errors.push(...r.errors.map(e => e.message)); })
      );
    }
    if (cloudDiscovery.identities.length > 0) {
      console.log(`[${task.taskId}] 💾 Persisting ${cloudDiscovery.identities.length} Azure identities...`);
      entityPersistTasks.push(
        this.persistenceStage.persistEntities(task.tenantId, cloudDiscovery.identities as any[], [])
          .then(r => { result.summary.errors.push(...r.errors.map(e => e.message)); })
      );
    }
    if (cloudDiscovery.iamRoleAssignments.length > 0) {
      console.log(`[${task.taskId}] 💾 Persisting ${cloudDiscovery.iamRoleAssignments.length} IAM role assignments...`);
      entityPersistTasks.push(
        this.persistenceStage.persistEntities(task.tenantId, cloudDiscovery.iamRoleAssignments as any[], [])
          .then(r => { result.summary.errors.push(...r.errors.map(e => e.message)); })
      );
    }

    // Persist all entity nodes first — relationships use MATCH which requires the
    // nodes to already exist. Running relationships in parallel with entity persist
    // caused ASSIGNED_TO / HAS_ROLE edges to be silently dropped on the first scan.
    await Promise.all(entityPersistTasks);

    if (cloudDiscovery.relationships.length > 0) {
      console.log(`[${task.taskId}] 💾 Persisting ${cloudDiscovery.relationships.length} cloud relationships...`);
      const r = await this.persistenceStage.persistRelationships(task.tenantId, cloudDiscovery.relationships);
      relationships.push(...cloudDiscovery.relationships);
      result.summary.errors.push(...r.errors.map(e => e.message));
    }

    if (!cloudDiscovery.cloudGraph) {
      console.warn(`[${task.taskId}] ⚠️  No cloud graph produced — graph topology will not be available. Errors: ${cloudDiscovery.errors.join('; ') || 'none'}`);
    } else if (!this.config.neo4j) {
      console.warn(`[${task.taskId}] ⚠️  Cloud graph produced but Neo4j is not configured — graph topology will not be persisted.`);
    } else {
      console.log(`[${task.taskId}] 💾 Persisting cloud graph — ${cloudDiscovery.cloudGraph.nodes.length} nodes, ${cloudDiscovery.cloudGraph.relationships.length} edges...`);
      try {
        await this.config.neo4j.storeCloudGraph(cloudDiscovery.cloudGraph);

        // Write cloud graph topology nodes to Qdrant so the SecurityQueryTools BFS
        // can traverse them. Uses the same 16-char hex IDs stored in Neo4j.
        // Classification: CONFIDENTIAL — infrastructure topology; tenantId-isolated.
        const cloudGraphEntities = cloudGraphToQdrantEntities(cloudDiscovery.cloudGraph);
        if (cloudGraphEntities.length > 0) {
          console.log(`[${task.taskId}] 💾 Persisting ${cloudGraphEntities.length} cloud graph topology nodes to Qdrant...`);
          await this.config.qdrant.storeEntities(cloudGraphEntities);
        }
      } catch (graphPersistErr: any) {
        result.summary.errors.push(`Cloud graph persist failed: ${graphPersistErr.message}`);
      }
    }

    const totalCloudItems = cloudDiscovery.totalResources + cloudDiscovery.totalIdentities + cloudDiscovery.totalRoleAssignments;
    console.log(`[${task.taskId}] ✅ Cloud discovery complete: ${cloudDiscovery.totalResources} resources, ${cloudDiscovery.totalIdentities} identities, ${cloudDiscovery.totalRoleAssignments} IAM assignments, ${cloudDiscovery.relationships.length} relationships`);

    result.stages[TaskStage.CLOUD_DISCOVERY] = {
      completed: true,
      duration: Date.now() - stageStart,
      itemsProcessed: totalCloudItems,
      errors: cloudDiscovery.errors,
    };
    result.summary.errors.push(...cloudDiscovery.errors);
    onStageChange?.(TaskStage.CLOUD_DISCOVERY, 'completed', totalCloudItems);
  }

  private async runLLMCorrelationStage(
    task: IndexRepositoryTask,
    entities: CanonicalEntity[],
    relationships: Relationship[],
    resolvedRunType: 'full' | 'incremental',
    result: TaskResult,
    onStageChange?: (stage: TaskStage, status: 'running' | 'completed' | 'failed', itemsProcessed?: number) => void,
  ): Promise<RepositoryBriefing | undefined> {
    const stageStart = Date.now();
    onStageChange?.(TaskStage.LLM_CORRELATION, 'running');

    const repositoryPath = resolveRepositoryPath(task, this.config);
    const repositoryEntity = entities.find(e => e.entityType === 'code_repository');
    if (!repositoryPath || !repositoryEntity) return;

    // Fetch all relevant entity types from DB — they may carry enriched fields
    // from previous runs (e.g. iacAnalysis, buildArtifactAnalysis, externalDeps).
    console.log(`[${task.taskId}] 🔎 Fetching entities from DB to use as source of truth...`);
    const dbEntityMap = await this.fetchDbEntities(task);

    // For incremental runs, only re-analyse the services/artifacts that were
    // actually extracted (i.e. had file changes). For full runs, use everything
    // from the DB so all enriched fields (iacAnalysis, externalDeps, etc.) are present.
    let services: CodeService[];
    let buildArtifacts: BuildArtifact[];
    let deploymentArtifacts: DeploymentArtifact[];

    if (resolvedRunType === 'incremental') {
      // Only pass changed entities to the LLM extractor — unchanged ones already
      // have up-to-date analysis in the DB and the extractor reads graph context
      // from Neo4j/Qdrant directly.
      services = entities.filter(e => e.entityType === 'code_service')
        .map(e => mergeWithDb(e, dbEntityMap)) as CodeService[];
      buildArtifacts = entities.filter(e => e.entityType === 'build_artifact')
        .map(e => mergeWithDb(e, dbEntityMap)) as BuildArtifact[];
      deploymentArtifacts = entities.filter(e => e.entityType === 'deployment_artifact')
        .map(e => mergeWithDb(e, dbEntityMap)) as DeploymentArtifact[];
      console.log(`[${task.taskId}] Incremental LLM correlation: ${services.length} changed service(s), ${buildArtifacts.length} changed build(s), ${deploymentArtifacts.length} changed deployment(s)`);
    } else {
      services = entities.filter(e => e.entityType === 'code_service')
        .map(e => mergeWithDb(e, dbEntityMap)) as CodeService[];
      buildArtifacts = entities.filter(e => e.entityType === 'build_artifact')
        .map(e => mergeWithDb(e, dbEntityMap)) as BuildArtifact[];
      deploymentArtifacts = entities.filter(e => e.entityType === 'deployment_artifact')
        .map(e => mergeWithDb(e, dbEntityMap)) as DeploymentArtifact[];
    }

    // Include cloud resources from DB that aren't in the current in-memory list
    // (e.g. discovered in a prior run's cloud discovery stage).
    const inMemoryCloudIds = new Set(entities.filter(e => e.entityType === 'cloud_resource').map(e => e.id));
    const cloudResourcesList = [
      ...entities.filter(e => e.entityType === 'cloud_resource').map(e => mergeWithDb(e, dbEntityMap)),
      ...[...dbEntityMap.values()].filter(e => e.entityType === 'cloud_resource' && !inMemoryCloudIds.has(e.id)),
    ];

    // ── CloudResourceRepository ────────────────────────────────────────────
    // Build the bounded in-memory store once here and pass to the SRE.
    // Security: repository enforces maxResults on every query so no correlator
    //           can accidentally receive an unbounded resource context window.
    const cloudRepository = new CloudResourceRepository(cloudResourcesList as any[]);

    console.log(`[${task.taskId}] 🤖 Starting analysis + correlation stage (Steps 0–7)...`);
    console.log(`[${task.taskId}] 📊 ${services.length} services, ${buildArtifacts.length} builds, ${deploymentArtifacts.length} deployments, ${cloudRepository.totalCount} cloud resources`);
    if (cloudRepository.totalCount > 0) {
      console.log(`[${task.taskId}]    Resource groups: ${cloudRepository.listResourceGroups().join(', ') || '(none)'}`);
    }

    // ── Repository Briefing ─────────────────────────────────────────────────
    // Produce a structured RepositoryBriefing from top-level manifest and config
    // files before running service analysis. The briefing is injected as shared
    // orientation context into Step 2 (ServiceAnalyzer) so every service agent
    // starts with a consistent picture of the repository.
    // Security: output is sanitized by RepositoryBriefingService before storage;
    //           failure is non-fatal — downstream steps degrade gracefully.
    console.log(`[${task.taskId}] 📄 Producing repository briefing…`);
    const repositoryBriefing = await this.repositoryBriefingService.produce(
      task.tenantId,
      entities,
      repositoryPath,
    );
    if (repositoryBriefing) {
      console.log(`[${task.taskId}] ✅ Repository briefing ready`);
    } else {
      console.warn(`[${task.taskId}] ⚠️  Repository briefing unavailable — downstream agents will use reduced context`);
    }

    // Translate task-level domains to the subset that the SRE understands.
    // 'features' is handled by a later stage (BusinessFeatureExtractor), not the SRE.
    const sreDomains = task.options.domains?.filter(
      (d): d is 'iac' | 'services' | 'service_relationships' => d !== 'features',
    );

    const sreResult = await this.serviceRelationshipsExtractor.extract({
      tenantId: task.tenantId,
      repositoryPath,
      services,
      buildArtifacts,
      deploymentArtifacts,
      cloudRepository,
      repositoryBriefing,
      domains: sreDomains?.length ? sreDomains : undefined,
    });

    patchEntities(entities, sreResult.updatedServices);
    patchEntities(entities, sreResult.updatedDeploymentArtifacts);
    patchEntities(entities, sreResult.updatedBuildArtifacts);
    relationships.push(...sreResult.relationships);

    console.log(`[${task.taskId}] ✅ Analysis + correlation complete: ${sreResult.relationships.length} relationships discovered`);

    console.log(`[${task.taskId}] 📋 Calculating repository responsibility...`);
    await this.repositoryResponsibilityCalculator.calculate(task.tenantId, entities, repositoryBriefing);
    console.log(`[${task.taskId}] ✅ Repository responsibility calculated`);

    if (sreResult.relationships.length > 0) {
      console.log(`[${task.taskId}] 💾 Persisting ${sreResult.relationships.length} relationships to graph database...`);
      const persistResult = await this.persistenceStage.persistRelationships(task.tenantId, sreResult.relationships);
      console.log(`[${task.taskId}] ✅ Relationships persisted: ${persistResult.relationshipsWritten} written`);
      result.summary.errors.push(...persistResult.errors.map(e => e.message));
    }

    result.stages[TaskStage.LLM_CORRELATION] = {
      completed: true,
      duration: Date.now() - stageStart,
      itemsProcessed: sreResult.relationships.length,
    };
    onStageChange?.(TaskStage.LLM_CORRELATION, 'completed', sreResult.relationships.length);

    // Return the briefing so Stage 5 can inject it into feature-extraction agent prompts.
    return repositoryBriefing;
  }

  private async runFeatureExtractionStage(
    task: IndexRepositoryTask,
    entities: CanonicalEntity[],
    resolvedRunType: 'full' | 'incremental',
    result: TaskResult,
    onStageChange?: (stage: TaskStage, status: 'running' | 'completed' | 'failed', itemsProcessed?: number) => void,
    repositoryBriefing?: RepositoryBriefing,
  ): Promise<void> {
    const stageStart = Date.now();
    onStageChange?.(TaskStage.FEATURE_EXTRACTION, 'running');

    const repositoryPath = resolveRepositoryPath(task, this.config);
    // For incremental runs, entities only contains services whose files changed —
    // unchanged services are already up-to-date in the DB and don't need re-analysis.
    const services = entities.filter(e => e.entityType === 'code_service') as CodeService[];
    const cloudResources = entities.filter(e => e.entityType === 'cloud_resource') as any[];
    console.log(`[${task.taskId}] 🏗️  Starting feature extraction stage (${services.length} service(s)${resolvedRunType === 'incremental' ? ' changed' : ''})...`);

    let featuresTotal = 0;
    for (const service of services) {
      try {
        // Fetch cloud topology for this service so Step 5 (unified threat model)
        // sees both the DFD/business context and the deployment reality.
        const cloudCtx = await this.serviceRelationshipsExtractor.getCloudContextForService(
          task.tenantId,
          service.id,
        );

        const features = await this.businessFeatureExtractor.extractFeaturesForService(
          task.tenantId,
          service,
          repositoryPath ?? '',
          { cloudResources, ...cloudCtx },
          task.repository.name,
          repositoryBriefing,
        );
        featuresTotal += features.length;

        // Re-read the service from Qdrant — Step 5 persisted serviceDfd + serviceThreatModel
        // (and the projected threatModel) onto it. Stage 6 needs the latest version.
        const updatedService = await this.config.qdrant?.getEntity(task.tenantId, service.id);
        if (updatedService) {
          patchEntities(entities, [updatedService]);
        }
      } catch (err: any) {
        console.error(`[${task.taskId}] Feature extraction failed for service "${service.name}":`, err?.message ?? err);
        result.summary.errors.push(`Feature extraction error for ${service.name}: ${err?.message ?? String(err)}`);
      }
    }

    console.log(`[${task.taskId}] ✅ Feature extraction complete: ${featuresTotal} business features extracted`);
    result.stages[TaskStage.FEATURE_EXTRACTION] = {
      completed: true,
      duration: Date.now() - stageStart,
      itemsProcessed: featuresTotal,
    };
    onStageChange?.(TaskStage.FEATURE_EXTRACTION, 'completed', featuresTotal);
  }

  private async runExploitabilityStage(
    task: IndexRepositoryTask,
    entities: CanonicalEntity[],
    resolvedRunType: 'full' | 'incremental',
    result: TaskResult,
    onStageChange?: (stage: TaskStage, status: 'running' | 'completed' | 'failed', itemsProcessed?: number) => void,
  ): Promise<void> {
    const stageStart = Date.now();
    onStageChange?.(TaskStage.EXPLOITABILITY_ANALYSIS, 'running');

    // Re-read services from entities list — they were patched in Stage 5 with
    // serviceDfd + serviceThreatModel from BusinessFeatureExtractor.
    // For incremental runs, entities only contains changed services.
    const services = entities.filter(e => e.entityType === 'code_service') as CodeService[];
    const cloudResources = entities.filter(e => e.entityType === 'cloud_resource') as any[];

    console.log(`[${task.taskId}] 🔐 Starting exploitability analysis (${services.length} service(s)${resolvedRunType === 'incremental' ? ' changed' : ''})...`);
    console.log(`[${task.taskId}]    Context: cloud-graph threat model (Stage 4) + DFD threat model (Stage 5) + cloud relationships`);

    let exploitableCount = 0;
    try {
      const updatedServices = await this.serviceRelationshipsExtractor.analyzeExploitability(
        services,
        cloudResources,
        task.tenantId,
      );
      patchEntities(entities, updatedServices);
      exploitableCount = updatedServices.filter(s => s.exploitabilityAnalysis?.results?.some(r => r.isExploitable)).length;
    } catch (err: any) {
      console.error(`[${task.taskId}] Exploitability analysis failed:`, err?.message ?? err);
      result.summary.errors.push(`Exploitability analysis error: ${err?.message ?? String(err)}`);
    }

    console.log(`[${task.taskId}] ✅ Exploitability analysis complete: ${exploitableCount} service(s) with exploitable threats`);
    result.stages[TaskStage.EXPLOITABILITY_ANALYSIS] = {
      completed: true,
      duration: Date.now() - stageStart,
      itemsProcessed: services.length,
    };
    onStageChange?.(TaskStage.EXPLOITABILITY_ANALYSIS, 'completed', services.length);
  }

  // ── Setup helpers ──────────────────────────────────────────────────────────

  private async resolveHeadCommit(taskId: string, repositoryPath: string): Promise<string | undefined> {
    try {
      const git = simpleGit(repositoryPath);
      const log = await git.log(['--max-count=1']);
      const sha = log.latest?.hash?.trim();
      if (sha && /^[0-9a-f]{40}$/i.test(sha)) return sha;
      console.warn(`[${taskId}] HEAD commit SHA has unexpected format — discarding`);
    } catch (err: any) {
      console.warn(`[${taskId}] Could not resolve HEAD commit: ${err?.message}`);
    }
    return undefined;
  }

  private async resolveRunType(task: IndexRepositoryTask): Promise<{
    resolvedRunType: 'full' | 'incremental';
    resolvedSinceCommit: string | undefined;
  }> {
    let resolvedRunType: 'full' | 'incremental' = task.options.runType ?? 'full';
    let resolvedSinceCommit: string | undefined;

    if (resolvedRunType === 'incremental') {
      if (this.indexingRunRepository) {
        try {
          const lastRun = await this.indexingRunRepository.getLatestCompletedForRepository(
            task.tenantId,
            task.repository.url,
          );
          if (lastRun?.scope?.sinceCommit) {
            resolvedSinceCommit = lastRun.scope.sinceCommit;
            console.log(`[${task.taskId}] Incremental run — using sinceCommit ${resolvedSinceCommit}`);
          } else {
            resolvedRunType = 'full';
            console.log(`[${task.taskId}] No previous completed run — falling back to full indexing`);
          }
        } catch (err: any) {
          resolvedRunType = 'full';
          console.warn(`[${task.taskId}] Failed to fetch last IndexingRun: ${err?.message} — falling back to full`);
        }
      } else {
        resolvedRunType = 'full';
        console.log(`[${task.taskId}] No indexingRunRepository configured — falling back to full indexing`);
      }
    }

    return { resolvedRunType, resolvedSinceCommit };
  }

  private async createIndexingRun(
    task: IndexRepositoryTask,
    resolvedRunType: 'full' | 'incremental',
    resolvedSinceCommit: string | undefined,
  ): Promise<IndexingRun | undefined> {
    if (!this.indexingRunRepository) return undefined;
    try {
      const run = await this.indexingRunRepository.create({
        id: crypto.randomUUID(),
        tenantId: task.tenantId,
        runType: resolvedRunType,
        status: 'running',
        startedAt: new Date().toISOString(),
        scope: { repositories: [task.repository.url], sinceCommit: resolvedSinceCommit },
        entitiesCreated: 0,
        entitiesUpdated: 0,
        relationshipsCreated: 0,
        evidenceCreated: 0,
        semanticDocumentsCreated: 0,
        errors: [],
        metadata: {},
      });
      console.log(`[${task.taskId}] IndexingRun created: ${run.id} (type=${resolvedRunType})`);
      return run;
    } catch (err: any) {
      console.warn(`[${task.taskId}] Failed to create IndexingRun: ${err?.message}`);
      return undefined;
    }
  }

  private setupCloudDiscovery(task: IndexRepositoryTask, integrations: any): void {
    if (task.options.enableCloudDiscovery && integrations.cloudIntegration) {
      console.log(`[${task.taskId}] Cloud discovery enabled with Microsoft Defender integration`);
      const defenderConfig = (integrations.cloudIntegration as any).config;
      const subscriptionIds: string[] = defenderConfig.subscriptionIds?.length
        ? defenderConfig.subscriptionIds
        : defenderConfig.subscriptionId
          ? [defenderConfig.subscriptionId]
          : [];
      this.cloudDiscoveryStage = new CloudDiscoveryStage({
        azure: {
          clientId: defenderConfig.clientId,
          clientSecret: defenderConfig.clientSecret,
          tenantId: defenderConfig.tenantId,
          subscriptionId: defenderConfig.subscriptionId || '',
          subscriptionIds,
        },
      });
    } else if (task.options.enableCloudDiscovery) {
      console.log(`[${task.taskId}] Cloud discovery requested but no cloud integration found`);
    }
  }

  private async fetchDbEntities(task: IndexRepositoryTask): Promise<Map<string, CanonicalEntity>> {
    const dbEntityTypes = ['code_service', 'build_artifact', 'deployment_artifact', 'cloud_resource'] as const;
    const dbEntityMap = new Map<string, CanonicalEntity>();

    for (const entityType of dbEntityTypes) {
      try {
        const dbEntities = await this.config.qdrant.listEntities(task.tenantId, entityType, 1000);
        for (const dbEntity of dbEntities) {
          dbEntityMap.set(dbEntity.id, dbEntity);
        }
        console.log(`[${task.taskId}]   ${entityType}: ${dbEntities.length} from DB`);
      } catch (err: any) {
        console.warn(`[${task.taskId}]   Failed to fetch ${entityType} from DB:`, err?.message ?? err);
      }
    }

    return dbEntityMap;
  }

  private async completeIndexingRun(
    task: IndexRepositoryTask,
    indexingRun: IndexingRun | undefined,
    headCommitSha: string | undefined,
    result: TaskResult,
  ): Promise<void> {
    if (!indexingRun || !this.indexingRunRepository) return;
    await this.indexingRunRepository.update(indexingRun.id, task.tenantId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      entitiesCreated: result.summary.entitiesCreated,
      relationshipsCreated: result.summary.relationshipsCreated,
      evidenceCreated: result.summary.evidenceCreated,
      semanticDocumentsCreated: result.summary.semanticDocumentsCreated,
      errors: result.summary.errors.map(msg => ({ timestamp: new Date().toISOString(), message: msg })),
      scope: { repositories: [task.repository.url], sinceCommit: headCommitSha },
    }).catch((err: any) => {
      console.warn(`[${task.taskId}] Failed to update IndexingRun to completed: ${err?.message}`);
    });
    console.log(`[${task.taskId}] IndexingRun ${indexingRun.id} marked completed (HEAD=${headCommitSha ?? 'unknown'})`);
  }

  // ── Checkpoint ─────────────────────────────────────────────────────────────

  private async saveCheckpoint(
    task: IndexRepositoryTask,
    stage: TaskStage,
    data: TaskCheckpoint['data'],
  ): Promise<void> {
    await this.checkpointManager.saveCheckpoint({
      taskId: task.taskId,
      tenantId: task.tenantId,
      stage,
      timestamp: new Date().toISOString(),
      data,
    });
  }
}
