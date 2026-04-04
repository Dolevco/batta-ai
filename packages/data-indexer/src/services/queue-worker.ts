/**
 * Queue Worker
 * 
 * Worker process that consumes tasks from the queue and processes them
 */

import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { GitHubIntegration, createIndexingRunRepository } from '@ai-agent/shared';
import type { IIndexingRunRepository } from '@ai-agent/shared';
import { IndexRepositoryTask, TaskType, TaskResult } from '../types/queue.types';
import { RepositoryTaskProcessor, TaskProcessorConfig } from './task-processor';
import { CheckpointManager } from './checkpoint-manager';
import { IntegrationFetcher } from './integration-fetcher';
import type { CodeIndexerConfig } from '../connectors/stages/discovery.stage';

export interface WorkerConfig extends CodeIndexerConfig {
  redisUrl?: string;
  queueName?: string;
  concurrency?: number;
  checkpointManager?: CheckpointManager;
  integrationFetcher?: IntegrationFetcher;
}

export class IndexingWorker {
  private worker: Worker;
  private connection: Redis;
  private integration?: GitHubIntegration;
  private config: WorkerConfig;
  private checkpointManager: CheckpointManager;
  private integrationFetcher: IntegrationFetcher;
  private indexingRunRepository?: IIndexingRunRepository;

  constructor(config: WorkerConfig, integration?: GitHubIntegration) {
    this.integration = integration;
    this.config = config;
    
    const url = config.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';
    
    // Create Redis connection
    this.connection = new Redis(url, {
      maxRetriesPerRequest: null,
    });

    // Initialize checkpoint manager
    this.checkpointManager = config.checkpointManager || new CheckpointManager({ redisUrl: url });
    
    // Initialize integration fetcher
    this.integrationFetcher = config.integrationFetcher || new IntegrationFetcher();

    // Initialize indexing run repository for incremental run tracking.
    // Uses the same Qdrant instance as the rest of the pipeline (env vars).
    // If Qdrant is not configured the processor falls back to full runs silently.
    if (config.qdrant) {
      this.indexingRunRepository = createIndexingRunRepository({
        qdrantUrl: process.env.QDRANT_URL,
        qdrantApiKey: process.env.QDRANT_API_KEY,
      });
    }

    const queueName = config.queueName || 'code-indexing';

    // Create worker
    this.worker = new Worker(
      queueName,
      async (job: Job) => this.processJob(job),
      {
        connection: this.connection,
        lockDuration: 600000, // 10 minutes
        concurrency: config.concurrency || 1,
        autorun: false, // Don't start automatically
      }
    );

    // Setup event handlers
    this.setupEventHandlers();
  }

  /**
   * Process a job from the queue
   */
  private async processJob(job: Job): Promise<TaskResult> {
    const task = job.data as IndexRepositoryTask;
    
    console.log(`[Worker] Processing job ${job.id} for repository: ${task.repository.name}`);

    // Create processor with checkpoint manager, integration fetcher, and run repository
    const processorConfig: TaskProcessorConfig = {
      ...this.config,
      checkpointManager: this.checkpointManager,
      integrationFetcher: this.integrationFetcher,
      indexingRunRepository: this.indexingRunRepository,
    };
    
    const processor = new RepositoryTaskProcessor(task.tenantId, processorConfig);
    
    // Process the task
    const result = await processor.processTask(task);
    
    return result;
  }

  /**
   * Setup event handlers for monitoring
   */
  private setupEventHandlers(): void {
    this.worker.on('completed', (job: Job, result: TaskResult) => {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`[Worker] ✅ Job ${job.id} completed successfully`);
      console.log(`${'='.repeat(80)}`);
      console.log(`📦 Repository: ${result.repositoryName}`);
      console.log(`⏱️  Total Duration: ${result.duration}ms (${(result.duration / 1000).toFixed(2)}s)`);
      console.log(`\n📊 Summary:`);
      console.log(`   - Entities Created: ${result.summary.entitiesCreated}`);
      console.log(`   - Relationships Created: ${result.summary.relationshipsCreated}`);
      console.log(`   - Evidence Items: ${result.summary.evidenceCreated}`);
      console.log(`   - Semantic Documents: ${result.summary.semanticDocumentsCreated}`);
      
      if (Object.keys(result.stages).length > 0) {
        console.log(`\n⏱️  Stage Breakdown:`);
        for (const [stage, info] of Object.entries(result.stages)) {
          console.log(`   - ${stage}: ${info.duration}ms (${info.itemsProcessed} items processed)`);
        }
      }
      
      if (result.summary.errors.length > 0) {
        console.log(`\n⚠️  Errors: ${result.summary.errors.length}`);
        result.summary.errors.slice(0, 5).forEach(err => console.log(`   - ${err}`));
        if (result.summary.errors.length > 5) {
          console.log(`   ... and ${result.summary.errors.length - 5} more`);
        }
      }
      console.log(`${'='.repeat(80)}\n`);
    });

    this.worker.on('failed', (job: Job | undefined, err: Error) => {
      console.error(`[Worker] Job ${job?.id} failed:`, err.message);
    });

    this.worker.on('error', (err: Error) => {
      console.error('[Worker] Worker error:', err);
    });

    this.worker.on('stalled', (jobId: string) => {
      console.warn(`[Worker] Job ${jobId} stalled`);
    });
  }

  /**
   * Start the worker
   */
  async start(): Promise<void> {
    console.log('[Worker] Starting indexing worker...');
    await this.worker.run();
    console.log('[Worker] Worker started and listening for jobs');
  }

  /**
   * Stop the worker
   */
  async stop(): Promise<void> {
    console.log('[Worker] Stopping worker...');
    await this.worker.close();
    await this.connection.quit();
    await this.checkpointManager.close();
    console.log('[Worker] Worker stopped');
  }

  /**
   * Get worker instance
   */
  getWorker(): Worker {
    return this.worker;
  }
}
