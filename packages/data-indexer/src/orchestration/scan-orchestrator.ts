/**
 * Scan Service
 *
 * Manages asset scan lifecycle by running the data-indexer in process,
 * tracking scan progress, and surfacing status to API consumers.
 *
 * Security:
 * - All scan operations are tenant-scoped. Scan records are stored in-process
 *   memory (Map) keyed by tenant + scanId so one tenant can never read another's
 *   scan state.
 * - No secret material is stored in scan records.
 * - Internal errors are logged server-side; only generic messages reach clients
 *   (OWASP A05 – Security Misconfiguration / information leakage prevention).
 * - Input validation (allow-list, type coercion, length/char limits) is enforced
 *   in scanController.ts before reaching this service.
 * - Data written by the pipeline uses the existing persistence
 *   layer which scopes all writes to tenantId.
 */

import { createEmbeddingClientFromEnv, createLlmClientFromEnv } from '@batta/core';
import { createIndexingRunRepository, createPostgresDataAdapter, createPostgresGraphAdapter } from '@batta/shared';
import { CheckpointManager } from '../pipeline/checkpoint-manager';
import { IntegrationFetcher } from '../integrations/integration-fetcher';
import { RepositoryTaskProcessor } from '../pipeline/repository-task-processor';
import { CodeDiscoveryStage } from '../pipeline/stages/code-discovery.stage';
import { TaskType } from '../pipeline/indexing-task.types';
import { InMemoryScanStore, type ScanStore } from './scan-store';
import {
  cloneScanRecord,
  createScanRecord,
  type ScanOptions,
  type ScanRecord,
  type ScanStageInfo,
} from './scan-types';

export type { ScanDomain, ScanOptions, ScanRecord } from './scan-types';

export interface ScanOrchestratorDependencies {
  scanStore?: ScanStore;
}

const defaultScanStore = new InMemoryScanStore();

/**
 * Create a new scan record and start orchestration asynchronously.
 * Returns immediately; progress is tracked in-memory.
 */
export async function startScan(
  tenantId: string,
  options: ScanOptions
): Promise<{ scanId: string; alreadyRunning: boolean }> {
  return defaultScanOrchestrator.startScan(tenantId, options);
}

async function startScanWithStore(
  scanStore: ScanStore,
  tenantId: string,
  options: ScanOptions
): Promise<{ scanId: string; alreadyRunning: boolean }> {
  const active = scanStore.getActiveScan(tenantId);
  if (active) {
    return { scanId: active.scanId, alreadyRunning: true };
  }

  const scanId = crypto.randomUUID();
  const record = createScanRecord(tenantId, scanId, options);
  scanStore.setRecord(tenantId, record);

  runOrchestration(scanStore, tenantId, scanId, options).catch(err => {
    console.error(`[ScanService] Unhandled error for scan ${scanId}:`, err);
    const rec = scanStore.getRecord(tenantId, scanId);
    if (rec && rec.status !== 'completed') {
      rec.status = 'failed';
      rec.completedAt = new Date().toISOString();
      rec.error = 'Scan failed due to an internal error.';
    }
  });

  return { scanId, alreadyRunning: false };
}

export function getScan(tenantId: string, scanId: string): ScanRecord | undefined {
  return defaultScanOrchestrator.getScan(tenantId, scanId);
}

export function listScans(tenantId: string): ScanRecord[] {
  return defaultScanOrchestrator.listScans(tenantId);
}

export class ScanOrchestrator {
  private readonly scanStore: ScanStore;

  constructor(dependencies: ScanOrchestratorDependencies = {}) {
    this.scanStore = dependencies.scanStore ?? defaultScanStore;
  }

  discoverRepositories(tenantId: string): Promise<Array<{ name: string; url: string; defaultBranch: string }>> {
    return discoverRepositories(tenantId);
  }

  startScan(
    tenantId: string,
    options: ScanOptions
  ): Promise<{ scanId: string; alreadyRunning: boolean }> {
    return startScanWithStore(this.scanStore, tenantId, options);
  }

  streamScan(
    tenantId: string,
    options: ScanOptions,
    onUpdate: (record: ScanRecord) => void
  ): Promise<void> {
    return startScanStreamWithStore(this.scanStore, tenantId, options, onUpdate);
  }

  getScan(tenantId: string, scanId: string): ScanRecord | undefined {
    const record = this.scanStore.getRecord(tenantId, scanId);
    return record ? cloneScanRecord(record) : undefined;
  }

  listScans(tenantId: string): ScanRecord[] {
    return this.scanStore.listRecords(tenantId).map(cloneScanRecord);
  }
}

const defaultScanOrchestrator = new ScanOrchestrator({ scanStore: defaultScanStore });

/**
 * Discover available repositories for a tenant without starting a scan.
 * Returns a lightweight list suitable for the repository-selection UI.
 */
export async function discoverRepositories(
  tenantId: string
): Promise<Array<{ name: string; url: string; defaultBranch: string }>> {
  try {
    const fetcher = new IntegrationFetcher();
    await fetcher.initialize();
    const integrations = await fetcher.fetchIntegrations(tenantId);

    if (!integrations.codeIntegrations.length) return [];

    const discoveryStage = new CodeDiscoveryStage(integrations.codeIntegrations, {} as any);
    const result = await discoveryStage.discover(tenantId, {});

    return result.repositories.map((r: any) => ({
      name: r.name,
      url: r.url,
      defaultBranch: r.defaultBranch,
    }));
  } catch (err) {
    console.error('[ScanService] discoverRepositories error:', err);
    return [];
  }
}

/**
 * Start a scan and stream progress updates via the provided callback.
 * Runs the full indexing pipeline in-process (discovery + all indexing stages).
 * Emits a ScanRecord snapshot on every stage transition so callers can push
 * updates to the client in real-time.
 *
 * Security:
 * - tenantId is always passed from the verified JWT claim (never from user input).
 * - options are pre-validated by the controller before reaching this function.
 * - Internal errors are caught and only a generic message is emitted to the callback.
 * - All data written is scoped to tenantId by the persistence layer.
 */
export async function startScanStream(
  tenantId: string,
  options: ScanOptions,
  onUpdate: (record: ScanRecord) => void
): Promise<void> {
  return defaultScanOrchestrator.streamScan(tenantId, options, onUpdate);
}

async function startScanStreamWithStore(
  scanStore: ScanStore,
  tenantId: string,
  options: ScanOptions,
  onUpdate: (record: ScanRecord) => void
): Promise<void> {
  const active = scanStore.getActiveScan(tenantId);
  if (active) {
    onUpdate(cloneScanRecord(active));
    return;
  }

  const scanId = crypto.randomUUID();
  const record = createScanRecord(tenantId, scanId, options);
  scanStore.setRecord(tenantId, record);

  const emit = () => onUpdate(cloneScanRecord(record));
  emit();

  await runOrchestrationStream(tenantId, scanId, options, record, emit);
}

// ---------------------------------------------------------------------------
// Stage name mapping (TaskStage → ScanStageInfo.name)
// ---------------------------------------------------------------------------

/** Maps data-indexer TaskStage values to the stage names shown in the UI. */
const TASK_STAGE_TO_UI_STAGE: Record<string, string> = {
  extract_transform: 'Code Discovery',
  cloud_discovery: 'Cloud Discovery',
  semantic_analysis: 'Security Analysis',
  llm_correlation: 'Correlation',
  feature_extraction: 'Security Analysis',
};

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Run the full indexing pipeline in-process with real-time stage streaming.
 *
 * Flow:
 *   1. Discovery  – enumerate repositories
 *   2. Per-repository RepositoryTaskProcessor:
 *        a. Extraction & Transformation  (+ persist entities/evidence)
 *        b. Cloud Discovery              (optional, + persist cloud entities)
 *        c. Semantic Analysis            (optional, + persist vector docs)
 *        d. LLM Correlation              (+ persist relationships)
 *   3. Mark overall scan completed / failed
 *
 * Security:
 * - All stage errors are logged in detail server-side.
 * - Only generic messages are exposed via rec.error (returned to the client).
 * - No user-supplied data is interpolated into shell commands or queries in this
 *   function; that is the responsibility of the pipeline stages themselves.
 */
async function runOrchestrationStream(
  tenantId: string,
  scanId: string,
  options: ScanOptions,
  rec: ScanRecord,
  emit: () => void
): Promise<void> {
  rec.status = 'running';

  const stageUpdate = (
    name: string,
    status: ScanStageInfo['status'],
    itemsProcessed?: number,
    error?: string
  ) => {
    updateStage(rec, name, status, itemsProcessed, error);
    emit();
  };

  const cloudOnly = options.scope === 'cloud';

  if (cloudOnly) {
    stageUpdate('Code Discovery', 'skipped');
  } else {
    stageUpdate('Code Discovery', 'running');
  }

  try {
    // ── Discovery ───────────────────────────────────────────────────────────
    const fetcher = new IntegrationFetcher();
    await fetcher.initialize();
    const integrations = await fetcher.fetchIntegrations(tenantId);

    if (!cloudOnly && !integrations.codeIntegrations.length) {
      throw new Error('No code integration found');
    }

    // ── Build processor config (shared by both cloud-only and code paths) ───
    const dataAdapter = createPostgresDataAdapter(createEmbeddingClientFromEnv());
    const graphAdapter = createPostgresGraphAdapter();

    const llmApi = createLlmClientFromEnv();
    const smallLLMApi = createLlmClientFromEnv({ modelRole: 'small' });

    const checkpointManager = new CheckpointManager();

    const processorConfig = {
      analysisDepth: 'shallow' as const,
      enableCloudDiscovery: options.enableCloudDiscovery,
      cloneDir: process.env.CLONE_DIR || '/tmp/batta-ai-clones',
      api: llmApi,
      smallApi: smallLLMApi,
      dataAdapter,
      graphAdapter,
      checkpointManager,
      indexingRunRepository: createIndexingRunRepository(),
    };

    // ── Cloud-only path: single task, no code discovery needed ──────────────
    if (cloudOnly) {
      if (!integrations.cloudIntegration) {
        stageUpdate('Cloud Discovery', 'failed', undefined, 'No cloud integration configured');
        rec.status = 'failed';
        rec.completedAt = new Date().toISOString();
        rec.error = 'Scan could not be started. Check integrations and try again.';
        emit();
        console.error(`[ScanService] Stream scan ${scanId}: cloud-only scope but no cloud integration for tenant ${tenantId}`);
        return;
      }

      markQueuedStages(rec, options);
      emit();

      const taskId = `${scanId}-cloud`;
      const cloudTask = {
        type: TaskType.INDEX_REPOSITORY,
        tenantId,
        taskId,
        createdAt: new Date().toISOString(),
        repository: { name: 'cloud', url: '', defaultBranch: '' },
        options: {
          enableCloudDiscovery: true,
          scope: 'cloud' as const,
          runType: options.runType ?? 'full',
        },
      };

      const processor = new RepositoryTaskProcessor(tenantId, processorConfig as any);
      try {
        await processor.processTask(cloudTask as any, (taskStage, status, itemsProcessed) => {
          const uiStageName = TASK_STAGE_TO_UI_STAGE[taskStage];
          if (!uiStageName) return;
          if (status === 'running') {
            stageUpdate(uiStageName, 'running');
          } else if (status === 'completed') {
            stageUpdate(uiStageName, 'completed', itemsProcessed);
          } else {
            stageUpdate(uiStageName, 'failed');
          }
        });
      } catch (cloudErr: any) {
        // Security: log full error server-side only; never expose to client
        console.error(`[ScanService] Cloud-only scan ${scanId} failed:`, cloudErr);
        stageUpdate('Cloud Discovery', 'failed', undefined, 'Cloud discovery failed');
        rec.status = 'failed';
        rec.completedAt = new Date().toISOString();
        rec.error = 'Scan could not be started. Check integrations and try again.';
        emit();
        return;
      }

      rec.status = 'completed';
      rec.completedAt = new Date().toISOString();
      emit();
      return;
    }

    // ── Code (or code+cloud) path ────────────────────────────────────────────
    const scope = {
      repositories: options.repositories?.length ? options.repositories : undefined,
    };

    const discoveryStage = new CodeDiscoveryStage(integrations.codeIntegrations, {} as any);
    const discovery = await discoveryStage.discover(tenantId, scope);

    rec.repositoriesDiscovered = discovery.repositories.length;
    rec.tasksEnqueued = discovery.repositories.length;
    // Emit repo count without completing the stage — extract_transform task will complete it
    emit();

    if (discovery.repositories.length === 0) {
      // No repositories to index — complete Code Discovery and skip remaining stages
      stageUpdate('Code Discovery', 'completed', 0);
      markQueuedStages(rec, options);
      emit();
      rec.status = 'completed';
      rec.completedAt = new Date().toISOString();
      emit();
      console.log(`[ScanService] Stream scan ${scanId}: no repositories discovered for tenant ${tenantId}`);
      return;
    }

    // Mark indexing stages as pending (not skipped) now that we know there's work to do
    markQueuedStages(rec, options);
    emit();

    // ── Per-stage aggregate counters (across all repositories) ──────────────
    let totalEntities = 0;
    let totalCloudResources = 0;
    let totalSemanticDocs = 0;
    let totalRelationships = 0;
    let anyRepoFailed = false;

    for (let i = 0; i < discovery.repositories.length; i++) {
      const repository = discovery.repositories[i];
      const repoLabel = discovery.repositories.length > 1
        ? ` (${i + 1}/${discovery.repositories.length})`
        : '';

      console.log(`[ScanService] Processing repository${repoLabel}: ${repository.name}`);

      const taskId = `${scanId}-${repository.name}`;
      const task = {
        type: TaskType.INDEX_REPOSITORY,
        tenantId,
        taskId,
        createdAt: new Date().toISOString(),
        repository,
        options: {
          enableCloudDiscovery: options.enableCloudDiscovery,
          runType: options.runType ?? 'full',
          domains: options.domains,
        },
      };

      const processor = new RepositoryTaskProcessor(tenantId, processorConfig as any);

      try {
        const result = await processor.processTask(task as any, (taskStage, status, itemsProcessed) => {
          // Map TaskStage enum values to UI stage names and emit SSE updates in real-time
          const uiStageName = TASK_STAGE_TO_UI_STAGE[taskStage];
          if (!uiStageName) return;

          if (status === 'running') {
            stageUpdate(uiStageName, 'running');
          } else if (status === 'completed') {
            if (uiStageName === 'Code Discovery') totalEntities += itemsProcessed ?? 0;
            else if (uiStageName === 'Cloud Discovery') totalCloudResources += itemsProcessed ?? 0;
            else if (uiStageName === 'Security Analysis') totalSemanticDocs += itemsProcessed ?? 0;
            else if (uiStageName === 'Correlation') totalRelationships += itemsProcessed ?? 0;

            const count =
              uiStageName === 'Code Discovery' ? totalEntities :
              uiStageName === 'Cloud Discovery' ? totalCloudResources :
              uiStageName === 'Security Analysis' ? totalSemanticDocs :
              uiStageName === 'Correlation' ? totalRelationships :
              itemsProcessed;
            stageUpdate(uiStageName, 'completed', count);
          } else {
            stageUpdate(uiStageName, 'failed');
          }
        });

        // Handle stages that were skipped (not reported via callback)
        const stages = result.stages as Record<string, any>;

        if (options.enableCloudDiscovery && !stages['cloud_discovery']) {
          stageUpdate('Cloud Discovery', 'skipped');
        }
        if (!stages['llm_correlation']) {
          stageUpdate('Correlation', 'completed', 0);
        }

        console.log(`[ScanService] Repository ${repository.name} processed: ` +
          `${result.summary.entitiesCreated} entities, ` +
          `${result.summary.semanticDocumentsCreated} semantic docs, ` +
          `${result.summary.relationshipsCreated} relationships`);

      } catch (repoErr: any) {
        anyRepoFailed = true;
        // Security: log full error server-side only; never expose to client
        console.error(`[ScanService] Repository ${repository.name} processing failed:`, repoErr);

        // Mark remaining pending stages as failed for this repo pass
        for (const stageName of ['Code Discovery', 'Cloud Discovery', 'Correlation', 'Security Analysis']) {
          const stage = rec.stages.find(s => s.name === stageName);
          if (stage && stage.status === 'running') {
            stageUpdate(stageName, 'failed', undefined, 'Processing failed');
          }
        }
      }
    } // end for-each repository

    // ── Final status ────────────────────────────────────────────────────────
    rec.status = anyRepoFailed ? 'failed' : 'completed';
    rec.completedAt = new Date().toISOString();
    if (anyRepoFailed) {
      rec.error = 'One or more repositories could not be fully indexed. Check server logs for details.';
    }
    emit();

    console.log(`[ScanService] Stream scan ${scanId} completed for tenant ${tenantId}: ` +
      `${rec.repositoriesDiscovered} repos, ${totalEntities} entities, ` +
      `${totalSemanticDocs} semantic docs, ${totalRelationships} relationships`);

  } catch (err: any) {
    // Security: log full error server-side; return only a generic message to the client
    console.error(`[ScanService] Stream orchestration error for scan ${scanId}:`, err);
    stageUpdate('Code Discovery', 'failed', undefined, 'Code discovery failed');
    rec.status = 'failed';
    rec.completedAt = new Date().toISOString();
    rec.error = 'Scan could not be started. Check integrations and try again.';
    emit();
  }
}

/**
 * Runs the full indexing pipeline in-process without SSE updates.
 */
async function runOrchestration(
  scanStore: ScanStore,
  tenantId: string,
  scanId: string,
  options: ScanOptions
): Promise<void> {
  const rec = scanStore.getRecord(tenantId, scanId)!;
  await runOrchestrationStream(tenantId, scanId, options, rec, () => {});
}

function updateStage(
  rec: ScanRecord,
  name: string,
  status: ScanStageInfo['status'],
  itemsProcessed?: number,
  error?: string
): void {
  const stage = rec.stages.find(s => s.name === name);
  if (!stage) return;
  stage.status = status;
  if (status === 'running') stage.startedAt = new Date().toISOString();
  if (status === 'completed' || status === 'failed') stage.completedAt = new Date().toISOString();
  if (itemsProcessed !== undefined) stage.itemsProcessed = itemsProcessed;
  if (error) stage.error = error;
}

function markQueuedStages(rec: ScanRecord, options: ScanOptions): void {
  const codeEnabled = options.scope !== 'cloud';
  const cloudEnabled = options.scope !== 'code' && options.enableCloudDiscovery;
  const stageMap: Record<string, boolean> = {
    'Code Discovery': codeEnabled,
    'Cloud Discovery': cloudEnabled,
    'Correlation': codeEnabled,
    'Security Analysis': codeEnabled,
  };
  for (const stage of rec.stages) {
    if (stage.status === 'pending' && stageMap[stage.name] !== undefined) {
      stage.status = stageMap[stage.name] ? 'pending' : 'skipped';
    }
  }
}
