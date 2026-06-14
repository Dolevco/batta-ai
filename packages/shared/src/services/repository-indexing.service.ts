import { randomUUID } from 'crypto';
import type { PostgresDataAdapter } from '../persistence/data-adapter';
import type { PostgresGraphAdapter } from '../persistence/graph-adapter';
import type { IIndexingRunRepository } from '../persistence/interfaces';
import type { IndexingRun } from '../types/canonical.types';
import type {
  RepositoryIndexingRequest,
  RepositoryIndexingResponse,
  RepositoryIndexingStatusResponse,
  RepositoryIndexingRunMetadata,
  RepositoryIndexingSubmission,
} from '../types/repository-indexing.types';
import { STAGE_DEFINITIONS, nextStage } from './repository-indexing/stage-definitions';
import { validateSubmission } from './repository-indexing/validators';
import {
  persistInventory,
  persistServices,
  persistFeatureWithDfd,
  persistThreatModels,
  persistRelationships,
} from './repository-indexing/persistence';
import { computeCoverage, computeGaps, meetsMinimumBar } from './repository-indexing/coverage';

export class RepositoryIndexingService {
  constructor(
    private readonly indexingRunRepository: IIndexingRunRepository,
    private readonly dataAdapter: PostgresDataAdapter,
    private readonly graphAdapter: PostgresGraphAdapter,
  ) {}

  async startOrContinue(
    tenantId: string,
    repository: string | undefined,
    request: RepositoryIndexingRequest,
  ): Promise<RepositoryIndexingResponse> {
    let run: IndexingRun | null = null;

    if (request.sessionId && !request.forceNewSession) {
      run = await this.indexingRunRepository.getById(request.sessionId, tenantId);
    }

    if (!run || request.forceNewSession) {
      // Find existing active MCP indexing run for this tenant+repo
      if (!request.forceNewSession) {
        const allRuns = await this.indexingRunRepository.getAll(tenantId);
        run = allRuns.find(r => {
          const meta = (r.metadata as any)?.repositoryIndexing as RepositoryIndexingRunMetadata | undefined;
          if (!meta || meta.indexer !== 'mcp_agent') return false;
          if (r.status !== 'running') return false;
          if (repository && meta.repository !== repository) return false;
          return true;
        }) ?? null;
      }

      if (!run) {
        run = await this.createNewRun(tenantId, repository);
      }
    }

    const meta = this.getMeta(run);

    if (!request.submission) {
      return this.buildResponse(run, meta, []);
    }

    return this.processSubmission(run, meta, request.submission, tenantId, repository);
  }

  async getStatus(
    tenantId: string,
    repository: string | undefined,
    sessionId?: string,
  ): Promise<RepositoryIndexingStatusResponse> {
    let run: IndexingRun | null = null;

    if (sessionId) {
      run = await this.indexingRunRepository.getById(sessionId, tenantId);
    } else {
      const allRuns = await this.indexingRunRepository.getAll(tenantId);
      run = allRuns.find(r => {
        const meta = (r.metadata as any)?.repositoryIndexing as RepositoryIndexingRunMetadata | undefined;
        if (!meta || meta.indexer !== 'mcp_agent') return false;
        if (repository && meta.repository !== repository) return false;
        return true;
      }) ?? null;
    }

    if (!run) {
      return {
        repository,
        stage: 'repository_inventory',
        status: 'not_started',
        coverage: { hasRepository: false, serviceCount: 0, featureCount: 0, servicesWithDfd: 0, featuresWithThreatModel: 0, overallPercent: 0 },
        gaps: [],
        completedStages: [],
      };
    }

    const meta = this.getMeta(run);
    const coverage = computeCoverage(meta);
    const gaps = computeGaps(meta);

    return {
      sessionId: run.id,
      repository: meta.repository,
      stage: meta.currentStage,
      status: run.status as 'running' | 'completed' | 'failed',
      coverage,
      gaps,
      lastUpdated: run.completedAt ?? run.startedAt,
      completedStages: meta.completedStages,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async createNewRun(tenantId: string, repository: string | undefined): Promise<IndexingRun> {
    const initialMeta: RepositoryIndexingRunMetadata = {
      indexer: 'mcp_agent',
      repository,
      currentStage: 'repository_inventory',
      completedStages: [],
      stageVersions: {},
      coverage: { hasRepository: false, serviceCount: 0, featureCount: 0, servicesWithDfd: 0, featuresWithThreatModel: 0, overallPercent: 0 },
      gaps: [],
      drafts: {},
      validationHistory: [],
      persistedIds: {},
    };

    const run: IndexingRun = {
      id: randomUUID(),
      tenantId,
      runType: 'full',
      status: 'running',
      startedAt: new Date().toISOString(),
      scope: { repositories: repository ? [repository] : [] },
      entitiesCreated: 0,
      entitiesUpdated: 0,
      relationshipsCreated: 0,
      evidenceCreated: 0,
      semanticDocumentsCreated: 0,
      errors: [],
      metadata: { repositoryIndexing: initialMeta },
    };

    return this.indexingRunRepository.create(run);
  }

  private getMeta(run: IndexingRun): RepositoryIndexingRunMetadata {
    return (run.metadata as any).repositoryIndexing as RepositoryIndexingRunMetadata;
  }

  private async processSubmission(
    run: IndexingRun,
    meta: RepositoryIndexingRunMetadata,
    submission: RepositoryIndexingSubmission,
    tenantId: string,
    repository: string | undefined,
  ): Promise<RepositoryIndexingResponse> {
    const errors = validateSubmission(submission, meta.currentStage, meta);

    if (errors.length > 0) {
      // Record validation failure
      meta.validationHistory.push({
        stage: meta.currentStage,
        timestamp: new Date().toISOString(),
        errors,
      });
      await this.saveMeta(run, meta);

      return this.buildResponse(run, meta, errors);
    }

    try {
      await this.persistStage(tenantId, repository, meta, submission);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ...this.buildResponse(run, meta, []),
        validationErrors: [{ path: 'persistence', message: `Persistence error: ${msg}`, severity: 'error' }],
        nextAction: 'An internal error occurred. Retry with the same sessionId.',
      };
    }

    // Advance stage
    const completedStage = meta.currentStage;
    if (!meta.completedStages.includes(completedStage)) {
      meta.completedStages.push(completedStage);
    }
    meta.stageVersions[completedStage] = (meta.stageVersions[completedStage] ?? 0) + 1;
    meta.coverage = computeCoverage(meta);
    meta.gaps = computeGaps(meta);

    if (completedStage === 'completeness_check') {
      if (meetsMinimumBar(meta)) {
        meta.currentStage = 'completed';
        meta.completedStages.push('completed');
        await this.saveMeta(run, meta, 'completed');
      } else {
        // Stay at completeness_check with gaps
        meta.gaps = computeGaps(meta);
        await this.saveMeta(run, meta);
      }
    } else {
      meta.currentStage = nextStage(completedStage);
      await this.saveMeta(run, meta);
    }

    run = await this.indexingRunRepository.getById(run.id, tenantId) ?? run;
    return this.buildResponse(run, meta, []);
  }

  private async persistStage(
    tenantId: string,
    repository: string | undefined,
    meta: RepositoryIndexingRunMetadata,
    submission: RepositoryIndexingSubmission,
  ): Promise<void> {
    switch (submission.stage) {
      case 'repository_inventory': {
        const repoId = await persistInventory(tenantId, submission.inventory, this.dataAdapter, this.graphAdapter);
        meta.persistedIds = { ...meta.persistedIds, repositoryId: repoId };
        meta.drafts.inventory = submission.inventory;
        break;
      }

      case 'service_extraction': {
        const repoId = meta.persistedIds?.repositoryId;
        if (!repoId) throw new Error('Repository must be indexed before services');
        const serviceIds = await persistServices(tenantId, repoId, submission.services, this.dataAdapter, this.graphAdapter);
        meta.persistedIds = {
          ...meta.persistedIds,
          serviceIds: { ...(meta.persistedIds?.serviceIds ?? {}), ...serviceIds },
        };
        break;
      }

      case 'feature_extraction': {
        // Store as drafts; full persistence happens in dfd_creation
        meta.drafts.features = submission.features;
        break;
      }

      case 'dfd_creation': {
        const repoId = meta.persistedIds?.repositoryId;
        if (!repoId) throw new Error('Repository must be indexed before DFDs');
        const serviceIdMap = meta.persistedIds?.serviceIds ?? {};
        const featureIdMap: Record<string, string> = {};
        const repoName = meta.drafts.inventory?.url ?? meta.drafts.inventory?.name ?? repository ?? repoId;

        for (const dfd of submission.dfds) {
          const featureDraft = (meta.drafts.features ?? []).find(f => f.name === dfd.featureName);
          if (!featureDraft) continue;
          const featId = await persistFeatureWithDfd(
            tenantId, repoId, repoName, featureDraft, dfd, serviceIdMap, this.dataAdapter, this.graphAdapter,
          );
          featureIdMap[dfd.featureName] = featId;
        }

        meta.persistedIds = {
          ...meta.persistedIds,
          featureIds: { ...(meta.persistedIds?.featureIds ?? {}), ...featureIdMap },
        };
        break;
      }

      case 'threat_model_creation': {
        const serviceIdMap = meta.persistedIds?.serviceIds ?? {};
        const featureIdMap = meta.persistedIds?.featureIds ?? {};
        const tmResult = await persistThreatModels(tenantId, submission.threatModels, featureIdMap, serviceIdMap, this.dataAdapter, this.graphAdapter);
        meta.persistedIds = {
          ...meta.persistedIds,
          servicesWithDfd: tmResult.servicesWithDfdWritten,
          featuresWithThreatModel: tmResult.featuresWritten,
        };
        break;
      }

      case 'relationship_correlation': {
        const serviceIdMap = meta.persistedIds?.serviceIds ?? {};
        const featureIdMap = meta.persistedIds?.featureIds ?? {};
        await persistRelationships(tenantId, submission.relationships, serviceIdMap, featureIdMap, this.dataAdapter, this.graphAdapter);
        break;
      }

      case 'completeness_check':
        break;
    }
  }

  private async saveMeta(
    run: IndexingRun,
    meta: RepositoryIndexingRunMetadata,
    status?: 'running' | 'completed' | 'failed',
  ): Promise<void> {
    const updates: Partial<IndexingRun> = {
      metadata: { ...run.metadata, repositoryIndexing: meta },
      status: status ?? run.status,
    };
    if (status === 'completed') {
      updates.completedAt = new Date().toISOString();
    }
    await this.indexingRunRepository.update(run.id, run.tenantId, updates);
  }

  private buildResponse(
    run: IndexingRun,
    meta: RepositoryIndexingRunMetadata,
    validationErrors: Array<{ path: string; message: string; severity: 'error' | 'warning' }>,
  ): RepositoryIndexingResponse {
    const stage = meta.currentStage;
    const def = STAGE_DEFINITIONS[stage];
    const coverage = computeCoverage(meta);
    const gaps = computeGaps(meta);

    const serviceNames = Object.keys(meta.persistedIds?.serviceIds ?? {});
    const featureNames = Object.keys(meta.persistedIds?.featureIds ?? {});
    // During dfd_creation, features aren't persisted yet — use drafts
    const draftFeatureNames = (meta.drafts?.features ?? []).map(f => f.name).filter(Boolean);
    const effectiveFeatureNames = featureNames.length > 0 ? featureNames : draftFeatureNames;

    const knownContext: Record<string, unknown> = {
      repositoryId: meta.persistedIds?.repositoryId,
      serviceCount: serviceNames.length,
      serviceNames,
      featureCount: featureNames.length || draftFeatureNames.length,
      featureNames: effectiveFeatureNames,
      completedStages: meta.completedStages,
    };

    // Append exact-name constraints to instructions for stages that do cross-reference lookups
    let instructions = def.instructions;
    if (stage === 'dfd_creation' && effectiveFeatureNames.length > 0) {
      instructions += `\n\n**IMPORTANT — exact names required:** The \`featureName\` in each DFD entry must exactly match one of the indexed feature names (case-sensitive): ${effectiveFeatureNames.map(n => `\`${n}\``).join(', ')}.`;
    }
    if (stage === 'feature_extraction' && serviceNames.length > 0) {
      instructions += `\n\n**IMPORTANT — exact names required:** Each \`sourceServiceNames\` entry must exactly match one of the indexed service names (case-sensitive): ${serviceNames.map(n => `\`${n}\``).join(', ')}.`;
    }
    if (stage === 'threat_model_creation') {
      if (effectiveFeatureNames.length > 0) {
        instructions += `\n\n**IMPORTANT — exact names required:** The \`featureName\` in each threat model entry must exactly match one of the indexed feature names (case-sensitive): ${effectiveFeatureNames.map(n => `\`${n}\``).join(', ')}.`;
      }
      if (serviceNames.length > 0) {
        instructions += `\n\nThe \`serviceName\` in each \`serviceThreatModels\` entry must exactly match one of the indexed service names (case-sensitive): ${serviceNames.map(n => `\`${n}\``).join(', ')}. Every non-library service must have an entry — submissions with unknown service names will be rejected.`;
      }
    }

    const isCompleted = stage === 'completed';
    const hasErrors = validationErrors.length > 0;

    let nextAction: string;
    if (isCompleted) {
      nextAction = 'Indexing is complete. You can now start a security review with start_security_review.';
    } else if (hasErrors) {
      nextAction = `Fix the ${validationErrors.length} validation error(s) and call index_repository again with the same sessionId and a corrected submission.`;
    } else {
      nextAction = `Read the inspect targets and answer the questions, then call index_repository with sessionId="${run.id}" and a submission for stage "${stage}".`;
    }

    const confidence = deriveConfidence(meta, gaps);
    const suggestedNextQueries = isCompleted ? SUGGESTED_NEXT_QUERIES : undefined;

    return {
      sessionId: run.id,
      repository: meta.repository,
      stage,
      status: run.status as 'running' | 'completed' | 'failed',
      knownContext,
      coverage,
      gaps,
      questions: def.questions,
      inspect: def.inspect,
      instructions,
      requiredOutputSchema: isCompleted ? undefined : def.requiredOutputSchema,
      validationErrors: hasErrors ? validationErrors : undefined,
      nextAction,
      missingContext: gaps,
      confidence,
      staleness: { stale: false },
      suggestedNextQueries,
    };
  }
}

function deriveConfidence(
  meta: RepositoryIndexingRunMetadata,
  gaps: ReturnType<typeof computeGaps>,
): 'high' | 'medium' | 'low' {
  if (!meta.persistedIds?.repositoryId) return 'low';
  if (Object.keys(meta.persistedIds?.serviceIds ?? {}).length === 0) return 'low';
  const hasHighGap = gaps.some(g => g.severity === 'high');
  const hasDfds = meta.completedStages.includes('dfd_creation');
  if (meta.currentStage === 'completed' && !hasHighGap) return 'high';
  if (hasDfds) return 'medium';
  return 'low';
}

const SUGGESTED_NEXT_QUERIES = [
  'Which features process restricted data?',
  'Which flows cross INTERNET trust boundaries?',
  'Which services have external dependencies?',
  'Which features have high or critical threats?',
  'Which features are missing encryption on sensitive flows?',
];
