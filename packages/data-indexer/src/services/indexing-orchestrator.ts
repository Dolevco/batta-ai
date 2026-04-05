/**
 * Queue-based Code Indexing Orchestrator
 * 
 * Production-ready orchestrator that discovers repositories and enqueues
 * indexing tasks to a Redis queue for distributed processing
 */

import type { CodeIntegrationHandler } from '@ai-agent/shared';
import { TenantId } from '@ai-agent/shared';
import { DiscoveryScope } from '../types/pipeline.types';
import { IndexRepositoryTask, TaskType } from '../types/queue.types';
import { CodeDiscoveryStage, type CodeIndexerConfig } from '../connectors/stages/discovery.stage';
import { QueueManager } from './queue-manager';
import { IntegrationFetcher } from './integration-fetcher';

export interface OrchestrationResult {
  runId: string;
  tenantId: TenantId;
  repositoriesDiscovered: number;
  tasksEnqueued: number;
  taskIds: string[];
  errors: string[];
}

export interface OrchestrationOptions {
  enableCloudDiscovery?: boolean;
  /** 'full' (default) or 'incremental'. Passed through to each IndexRepositoryTask. */
  runType?: 'full' | 'incremental';
}

/**
 * Queue-based Code Indexing Orchestrator
 */
export class CodeIndexingOrchestrator {
  private tenantId: TenantId;
  private integrations: CodeIntegrationHandler[];
  private config: CodeIndexerConfig;
  private discoveryStage?: CodeDiscoveryStage;
  private queueManager: QueueManager;
  private integrationFetcher: IntegrationFetcher;

  constructor(
    tenantId: TenantId,
    queueManager: QueueManager,
    config?: CodeIndexerConfig,
    integration?: CodeIntegrationHandler | CodeIntegrationHandler[],
  ) {
    this.tenantId = tenantId;
    this.integrations = integration
      ? Array.isArray(integration) ? integration : [integration]
      : [];
    this.config = config || {} as CodeIndexerConfig;
    this.queueManager = queueManager;
    this.integrationFetcher = new IntegrationFetcher();
    
    if (this.integrations.length) {
      this.discoveryStage = new CodeDiscoveryStage(this.integrations, this.config);
    }
  }

  /**
   * Orchestrate indexing by discovering repositories and creating tasks
   */
  async orchestrate(
    scope: DiscoveryScope,
    options: OrchestrationOptions = {}
  ): Promise<OrchestrationResult> {
    const runId = crypto.randomUUID();
    const errors: string[] = [];
    const taskIds: string[] = [];

    console.log(`[${runId}] Starting orchestration for tenant ${this.tenantId}`);

    try {
      // Fetch integrations if not provided
      if (!this.integrations.length) {
        console.log(`[${runId}] Fetching code integrations for tenant ${this.tenantId}`);
        await this.integrationFetcher.initialize();
        const fetched = await this.integrationFetcher.fetchIntegrations(this.tenantId);
        
        if (!fetched.codeIntegrations.length) {
          throw new Error(`No code integration found for tenant ${this.tenantId}`);
        }
        
        this.integrations = fetched.codeIntegrations;
        this.discoveryStage = new CodeDiscoveryStage(this.integrations, this.config);
      }

      // Stage 1: Discovery
      console.log(`[${runId}] Discovering repositories...`);
      const discovery = await this.discoveryStage!.discover(this.tenantId, scope);
      console.log(`[${runId}] Discovered ${discovery.repositories.length} repositories`);

      // Stage 2: Enqueue tasks
      console.log(`[${runId}] Enqueueing indexing tasks...`);
      for (const repository of discovery.repositories) {
        try {
          const task: IndexRepositoryTask = {
            type: TaskType.INDEX_REPOSITORY,
            tenantId: this.tenantId,
            taskId: `${runId}-${repository.name}`,
            createdAt: new Date().toISOString(),
            repository,
            options: {
              enableCloudDiscovery: options.enableCloudDiscovery ?? this.config.enableCloudDiscovery,
              // Pass runType through; sinceCommit is resolved at execution time by task-processor
              runType: options.runType ?? 'full',
            },
          };

          const jobId = await this.queueManager.enqueueIndexRepository(task);
          taskIds.push(task.taskId);
          console.log(`[${runId}] Enqueued task ${task.taskId} for repository ${repository.name} (job: ${jobId})`);
        } catch (error: any) {
          const errorMsg = `Failed to enqueue task for ${repository.name}: ${error.message}`;
          errors.push(errorMsg);
          console.error(`[${runId}] ${errorMsg}`);
        }
      }

      console.log(`[${runId}] Orchestration completed: ${taskIds.length} tasks enqueued`);

      return {
        runId,
        tenantId: this.tenantId,
        repositoriesDiscovered: discovery.repositories.length,
        tasksEnqueued: taskIds.length,
        taskIds,
        errors,
      };
    } catch (error: any) {
      errors.push(`Orchestration failed: ${error.message}`);
      console.error(`[${runId}] Orchestration failed:`, error);
      throw error;
    }
  }

  /**
   * Get current queue statistics
   */
  async getQueueStats() {
    return this.queueManager.getQueueStats();
  }
}
