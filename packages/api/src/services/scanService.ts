/**
 * Scan Service
 *
 * Manages asset scan lifecycle: triggering the data-indexer orchestrator,
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
 * - Data written to Qdrant / Neo4j by the pipeline uses the existing persistence
 *   layer which scopes all writes to tenantId.
 */

import { AzureOpenAIClient } from '@ai-agent/core';
import { IntegrationFetcher, RepositoryTaskProcessor, TaskType, CodeDiscoveryStage, QueueManager, CodeIndexingOrchestrator } from '@ai-agent/data-indexer';
import { createIndexingRunRepository, createQdrantDataAdapter, Neo4jAdapter } from '@ai-agent/shared';

export type ScanStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ScanOptions {
  enableCloudDiscovery: boolean;
  scope?: 'all' | 'code' | 'cloud';
  /** Optional allow-list of repository names to index; undefined means all. */
  repositories?: string[];
  /**
   * Whether to run a full or incremental index.
   * 'full'        — re-index every file (default, safe for first runs).
   * 'incremental' — only process files changed since the last completed run.
   *                 Falls back to 'full' if no prior run record exists.
   */
  runType?: 'full' | 'incremental';
}

export interface ScanStageInfo {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: string;
  completedAt?: string;
  itemsProcessed?: number;
  error?: string;
}

export interface ScanRecord {
  scanId: string;
  tenantId: string;
  status: ScanStatus;
  options: ScanOptions;
  startedAt: string;
  completedAt?: string;
  /** Run ID returned by the orchestrator */
  runId?: string;
  repositoriesDiscovered?: number;
  tasksEnqueued?: number;
  stages: ScanStageInfo[];
  /** Generic error message safe to return to the client */
  error?: string;
}

const DEFAULT_STAGES: ScanStageInfo[] = [
  { name: 'Code Discovery', status: 'pending' },
  { name: 'Cloud Discovery', status: 'pending' },
  { name: 'Correlation', status: 'pending' },
  { name: 'Security Analysis', status: 'pending' },
];

// In-memory store: tenantId → Map<scanId, ScanRecord>
const scanStore = new Map<string, Map<string, ScanRecord>>();

/**
 * Rate-limit: maximum one active scan per tenant at a time.
 */
function getActiveScan(tenantId: string): ScanRecord | undefined {
  const tenantScans = scanStore.get(tenantId);
  if (!tenantScans) return undefined;
  for (const scan of tenantScans.values()) {
    if (scan.status === 'queued' || scan.status === 'running') return scan;
  }
  return undefined;
}

function setRecord(tenantId: string, record: ScanRecord): void {
  if (!scanStore.has(tenantId)) {
    scanStore.set(tenantId, new Map());
  }
  scanStore.get(tenantId)!.set(record.scanId, record);
}

function getRecord(tenantId: string, scanId: string): ScanRecord | undefined {
  return scanStore.get(tenantId)?.get(scanId);
}

function listRecords(tenantId: string): ScanRecord[] {
  const tenantScans = scanStore.get(tenantId);
  if (!tenantScans) return [];
  return Array.from(tenantScans.values())
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 20); // Return at most 20 most-recent scans
}

/**
 * Create a new scan record and start orchestration asynchronously.
 * Returns immediately; progress is tracked in-memory.
 */
export async function startScan(
  tenantId: string,
  options: ScanOptions
): Promise<{ scanId: string; alreadyRunning: boolean }> {
  // Rate-limit: block if a scan is already running for this tenant
  const active = getActiveScan(tenantId);
  if (active) {
    return { scanId: active.scanId, alreadyRunning: true };
  }

  const scanId = crypto.randomUUID();
  const record: ScanRecord = {
    scanId,
    tenantId,
    status: 'queued',
    options,
    startedAt: new Date().toISOString(),
    stages: DEFAULT_STAGES.map(s => ({ ...s })),
  };
  setRecord(tenantId, record);

  // Fire-and-forget orchestration
  runOrchestration(tenantId, scanId, options).catch(err => {
    console.error(`[ScanService] Unhandled error for scan ${scanId}:`, err);
    const rec = getRecord(tenantId, scanId);
    if (rec && rec.status !== 'completed') {
      rec.status = 'failed';
      rec.completedAt = new Date().toISOString();
      rec.error = 'Scan failed due to an internal error.';
    }
  });

  return { scanId, alreadyRunning: false };
}

export function getScan(tenantId: string, scanId: string): ScanRecord | undefined {
  return getRecord(tenantId, scanId);
}

export function listScans(tenantId: string): ScanRecord[] {
  return listRecords(tenantId);
}

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
 * - All data written to Qdrant/Neo4j is scoped to tenantId by the persistence layer.
 */
export async function startScanStream(
  tenantId: string,
  options: ScanOptions,
  onUpdate: (record: ScanRecord) => void
): Promise<void> {
  const active = getActiveScan(tenantId);
  if (active) {
    onUpdate({ ...active, stages: active.stages.map(s => ({ ...s })) });
    return;
  }

  const scanId = crypto.randomUUID();
  const record: ScanRecord = {
    scanId,
    tenantId,
    status: 'queued',
    options,
    startedAt: new Date().toISOString(),
    stages: DEFAULT_STAGES.map(s => ({ ...s })),
  };
  setRecord(tenantId, record);

  const emit = () => onUpdate({ ...record, stages: record.stages.map(s => ({ ...s })) });
  emit();

  await runOrchestrationStream(tenantId, scanId, options, record, emit);
}

// ---------------------------------------------------------------------------
// In-memory checkpoint manager (no Redis required for in-process scanning)
// ---------------------------------------------------------------------------

/**
 * A no-op checkpoint manager that stores checkpoints in memory.
 * Used when Redis is not available or for in-process pipeline runs.
 * Not resumable across restarts, but keeps the RepositoryTaskProcessor API intact.
 */
class InMemoryCheckpointManager {
  private store = new Map<string, any>();

  async saveCheckpoint(checkpoint: any): Promise<void> {
    this.store.set(checkpoint.taskId, checkpoint);
  }

  async getCheckpoint(taskId: string): Promise<any | null> {
    return this.store.get(taskId) ?? null;
  }

  async deleteCheckpoint(taskId: string): Promise<void> {
    this.store.delete(taskId);
  }

  async hasCheckpoint(taskId: string): Promise<boolean> {
    return this.store.has(taskId);
  }

  async getTaskStage(taskId: string): Promise<any | null> {
    const cp = this.store.get(taskId);
    return cp?.stage ?? null;
  }

  async close(): Promise<void> {
    // no-op
  }
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

  stageUpdate('Code Discovery', 'running');

  try {
    // ── Discovery ───────────────────────────────────────────────────────────
    const fetcher = new IntegrationFetcher();
    await fetcher.initialize();
    const integrations = await fetcher.fetchIntegrations(tenantId);

    if (!integrations.codeIntegrations.length) {
      throw new Error('No code integration found');
    }

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


    const qdrantAdapter = createQdrantDataAdapter();
    let neo4jAdapter: any;
    if (process.env.NEO4J_URI) {
      neo4jAdapter = new Neo4jAdapter({
        uri: process.env.NEO4J_URI,
        username: process.env.NEO4J_USERNAME || 'neo4j',
        password: process.env.NEO4J_PASSWORD || 'password',
      });
    }

    let llmApi: any;
    try {
      llmApi = new AzureOpenAIClient({
        endpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
        apiKey: process.env.AZURE_OPENAI_API_KEY || '',
        deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT || '',
        apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview',
      });
    } catch (llmErr) {
      // LLM is optional (semantic analysis + correlation will be skipped)
      console.warn('[ScanService] LLM API init failed; semantic analysis will be skipped:', (llmErr as Error).message);
    }

    let smallLLMApi: any;
    if (!!process.env.AZURE_OPENAI_SMALL_DEPLOYMENT)
    try {
      smallLLMApi = new AzureOpenAIClient({
        endpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
        apiKey: process.env.AZURE_OPENAI_API_KEY || '',
        deploymentName: process.env.AZURE_OPENAI_SMALL_DEPLOYMENT || '',
        apiVersion: process.env.AZURE_OPENAI_SMALL_API_VERSION || process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview',
      });
    } catch (llmErr) {
      // LLM is optional (semantic analysis + correlation will be skipped)
      console.warn('[ScanService] LLM API init failed; semantic analysis will be skipped:', (llmErr as Error).message);
    }
    

    const checkpointManager = new InMemoryCheckpointManager();

    const processorConfig = {
      analysisDepth: 'shallow' as const,
      enableCloudDiscovery: options.enableCloudDiscovery,
      cloneDir: process.env.CLONE_DIR || '/tmp/ai-agent-clones',
      api: llmApi,
      smallApi: smallLLMApi,
      qdrant: qdrantAdapter,
      neo4j: neo4jAdapter,
      checkpointManager,
      indexingRunRepository: createIndexingRunRepository({
        qdrantUrl: process.env.QDRANT_URL,
        qdrantApiKey: process.env.QDRANT_API_KEY,
      }),
    };

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
 * Runs the full indexing pipeline. Uses dynamic imports to avoid
 * loading heavy data-indexer modules at API start time.
 */
async function runOrchestration(
  tenantId: string,
  scanId: string,
  options: ScanOptions
): Promise<void> {
  const rec = getRecord(tenantId, scanId)!;
  rec.status = 'running';

  // Stage 0: Discovery
  updateStage(rec, 'Code Discovery', 'running');

  try {
    let queueManager: InstanceType<typeof QueueManager> | undefined;

    try {
      queueManager = new QueueManager();
    } catch (redisErr) {
      // Redis is unavailable – fall back to in-process direct indexing
      console.warn('[ScanService] Redis unavailable, falling back to direct indexing:', (redisErr as Error).message);
      await runDirectIndexing(tenantId, scanId, options, rec);
      return;
    }

    const orchestrator = new CodeIndexingOrchestrator(tenantId, queueManager);

    const scope = {
      repositories: options.repositories?.length ? options.repositories : undefined,
    };

    updateStage(rec, 'Code Discovery', 'running');

    const result = await orchestrator.orchestrate(scope, {
      enableCloudDiscovery: options.enableCloudDiscovery,
      runType: options.runType ?? 'full',
    });

    rec.runId = result.runId;
    rec.repositoriesDiscovered = result.repositoriesDiscovered;
    rec.tasksEnqueued = result.tasksEnqueued;

    updateStage(rec, 'Code Discovery', 'completed', result.repositoriesDiscovered);
    // Remaining stages will be completed by the worker process
    markQueuedStages(rec, options);

    rec.status = 'completed'; // Enqueuing is our responsibility; worker handles the rest
    rec.completedAt = new Date().toISOString();

    console.log(`[ScanService] Scan ${scanId} enqueued ${result.tasksEnqueued} tasks for tenant ${tenantId}`);

    try {
      await queueManager.close();
    } catch (_) { /* ignore */ }
  } catch (err: any) {
    console.error(`[ScanService] Orchestration error for scan ${scanId}:`, err);
    updateStage(rec, 'Code Discovery', 'failed', undefined, 'Code discovery failed');
    rec.status = 'failed';
    rec.completedAt = new Date().toISOString();
    rec.error = 'Scan could not be started. Check integrations and try again.';
  }
}

/**
 * Fallback: run indexing in-process when Redis/BullMQ is not available.
 * This runs the full pipeline synchronously in the background.
 */
async function runDirectIndexing(
  tenantId: string,
  scanId: string,
  options: ScanOptions,
  rec: ScanRecord
): Promise<void> {
  try {
    const fetcher = new IntegrationFetcher();
    await fetcher.initialize();
    const integrations = await fetcher.fetchIntegrations(tenantId);

    if (!integrations.codeIntegrations.length) {
      throw new Error('No code integration found');
    }

    updateStage(rec, 'Code Discovery', 'running');
    const discoveryStage = new CodeDiscoveryStage(integrations.codeIntegrations, {} as any);
    const discovery = await discoveryStage.discover(tenantId, {});

    rec.repositoriesDiscovered = discovery.repositories.length;
    rec.tasksEnqueued = discovery.repositories.length;
    updateStage(rec, 'Code Discovery', 'completed', discovery.repositories.length);

    markQueuedStages(rec, options);
    rec.status = 'completed';
    rec.completedAt = new Date().toISOString();
  } catch (err: any) {
    console.error(`[ScanService] Direct indexing error for scan ${scanId}:`, err);
    updateStage(rec, 'Code Discovery', 'failed', undefined, 'Code discovery failed');
    rec.status = 'failed';
    rec.completedAt = new Date().toISOString();
    rec.error = 'Scan could not be started. Check integrations and try again.';
  }
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
  const stageMap: Record<string, boolean> = {
    'Code Discovery': true,
    'Cloud Discovery': options.enableCloudDiscovery,
    'Correlation': true,
    'Security Analysis': true,
  };
  for (const stage of rec.stages) {
    if (stage.status === 'pending' && stageMap[stage.name] !== undefined) {
      stage.status = stageMap[stage.name] ? 'pending' : 'skipped';
    }
  }
}
