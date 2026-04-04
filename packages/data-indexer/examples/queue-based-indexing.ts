/**
 * Production Queue-Based Indexing Example
 * 
 * Demonstrates how to use the queue-based indexing system for production scale.
 * Integrations (GitHub and Microsoft Defender) are fetched dynamically from Qdrant
 * based on the tenant ID.
 */

import { 
  CodeIndexingOrchestrator,
  QueueManager,
  IndexingWorker,
  CheckpointManager,
  Neo4jAdapter,
  QdrantAdapter,
} from '../src';
import type { CodeIndexerConfig } from '../src';
import { AzureOpenAIClient, AzureOpenAIEmbeddingClient } from '@ai-agent/core';

async function initializeDatabases() {
    // Configure Neo4j (optional - uses in-memory if not provided)
    const neo4j = process.env.NEO4J_URI ? new Neo4jAdapter({
    uri: process.env.NEO4J_URI,
    username: process.env.NEO4J_USERNAME || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'password',
    }) : undefined;

    if (neo4j) {
    console.log('🔗 Initializing Neo4j connection...');
    await neo4j.initialize();
    console.log('✅ Neo4j connected');
    console.log();
    }

    // Configure Qdrant (optional - for vector search)
    let qdrant;
    if (process.env.QDRANT_URL && process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT) {
        console.log('🔍 Initializing Qdrant connection...');

        const embeddingService = new AzureOpenAIEmbeddingClient({
            endpoint: process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT!,
            apiKey: process.env.AZURE_OPENAI_EMBEDDING_API_KEY!,
            deploymentName: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT!,
            apiVersion: process.env.AZURE_OPENAI_EMBEDDING_API_VERSION,
        });

        qdrant = new QdrantAdapter({
            url: process.env.QDRANT_URL,
            apiKey: process.env.QDRANT_API_KEY,
            collectionPrefix: 'code_indexer',
        }, embeddingService);

        await qdrant.initialize();
        console.log('✅ Qdrant connected');
        console.log();
    }

    const apiClient = new AzureOpenAIClient({
        endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
        apiKey: process.env.AZURE_OPENAI_API_KEY!,
        deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4',
        apiVersion: process.env.AZURE_OPENAI_API_VERSION,
    });

    return { qdrant, neo4j, apiClient }
}

/**
 * Example 1: Orchestrator - Discover and enqueue indexing tasks
 */
async function runOrchestrator() {
  const tenantId = process.env.TENANT_ID || '0361b075-6fe1-44cd-89f2-e9603816fa52';
  
  if (!tenantId) {
    console.error('Error: TENANT_ID environment variable is required');
    process.exit(1);
  }

  // Initialize queue manager
  const queueManager = new QueueManager({
    redisUrl: process.env.REDIS_URL,
    queueName: 'code-indexing',
  });

  // Create orchestrator (integration will be fetched automatically from Qdrant)
  const orchestrator = new CodeIndexingOrchestrator(
    tenantId,
    queueManager,
  );

  try {
    // Discover and enqueue tasks
    const result = await orchestrator.orchestrate(
      {
        repositories: ['ai-agent'], // Empty = all repos
        includeArchived: false,
      },
      {
        enableSemanticAnalysis: true,
        enableVectorIndexing: true,
        enableGraphProjection: true,
        enableCloudDiscovery: true, // Will use Microsoft Defender integration if configured
      }
    );

    console.log('Orchestration Result:', {
      runId: result.runId,
      repositoriesDiscovered: result.repositoriesDiscovered,
      tasksEnqueued: result.tasksEnqueued,
      errors: result.errors,
    });

    // Check queue stats
    const stats = await orchestrator.getQueueStats();
    console.log('Queue Stats:', stats);
  } finally {
    await queueManager.close();
  }
}

/**
 * Example 2: Worker - Process tasks from the queue
 */
async function runWorker() {
  const tenantId = process.env.TENANT_ID!;
  
  if (!tenantId) {
    console.error('Error: TENANT_ID environment variable is required');
    process.exit(1);
  }

  const dbs = await initializeDatabases();
  // Configure worker (integrations will be fetched automatically)
  const config: CodeIndexerConfig = {
    cloneDir: process.env.CLONE_DIR || '/tmp/clones',
    analysisDepth: 'deep',
    enableSemanticAnalysis: true,
    enableVectorIndexing: true,
    enableGraphProjection: true,
    maxConcurrency: 5,
    api: dbs.apiClient, // Replace with your ILLMApiHandler implementation
    neo4j: dbs.neo4j!,
    qdrant: dbs.qdrant!
  };

  // Create worker (no need to pass integration, it will be fetched per task)
  const worker = new IndexingWorker({
    ...config,
    redisUrl: process.env.REDIS_URL,
    queueName: 'code-indexing',
    concurrency: 1 //3, // Process 3 repositories concurrently
  });

  // Start worker
  await worker.start();

  // Handle graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    await worker.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down gracefully...');
    await worker.stop();
    process.exit(0);
  });

  console.log('Worker is running. Press Ctrl+C to stop.');
}

/**
 * Example 3: Check task checkpoint status
 */
async function checkTaskStatus() {
  const checkpointManager = new CheckpointManager({
    redisUrl: process.env.REDIS_URL,
  });

  try {
    const taskId = process.argv[3] || 'some-task-id';
    const checkpoint = await checkpointManager.getCheckpoint(taskId);
    
    if (checkpoint) {
      console.log('Task Status:', {
        taskId: checkpoint.taskId,
        stage: checkpoint.stage,
        timestamp: checkpoint.timestamp,
        entitiesProcessed: checkpoint.data.entities?.length || 0,
        relationshipsProcessed: checkpoint.data.relationships?.length || 0,
      });
    } else {
      console.log('No checkpoint found for task:', taskId);
    }
  } finally {
    await checkpointManager.close();
  }
}

/**
 * Example 4: Full flow - Run orchestrator, worker, and status check
 * This runs the complete indexing pipeline and cleans up on completion
 */
async function runFullFlow() {
  const tenantId = process.env.TENANT_ID || '0361b075-6fe1-44cd-89f2-e9603816fa52';
  
  if (!tenantId) {
    console.error('Error: TENANT_ID environment variable is required');
    process.exit(1);
  }

  let queueManager: QueueManager | null = null;
  let worker: IndexingWorker | null = null;
  let checkpointManager: CheckpointManager | null = null;
  let runId: string | undefined;

  // Cleanup function to remove tasks and close connections
  const cleanup = async () => {
    console.log('\n[Cleanup] Starting cleanup process...');
    
    try {
      if (worker) {
        console.log('[Cleanup] Stopping worker...');
        await worker.stop();
      }

      if (queueManager) {
        const queue = queueManager.getQueue();
        
        // Drain the queue (remove all waiting/delayed jobs)
        console.log('[Cleanup] Draining queue...');
        await queue.drain();
        
        // Clean all jobs (completed, failed, etc.)
        console.log('[Cleanup] Cleaning all jobs...');
        await queue.obliterate({ force: true });
        
        console.log('[Cleanup] Closing queue manager...');
        await queueManager.close();
      }

      if (checkpointManager) {
        console.log('[Cleanup] Closing checkpoint manager...');
        await checkpointManager.close();
      }

      console.log('[Cleanup] Cleanup completed successfully');
    } catch (error) {
      console.error('[Cleanup] Error during cleanup:', error);
    }
  };

  // Register cleanup handlers
  process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM, cleaning up...');
    await cleanup();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT, cleaning up...');
    await cleanup();
    process.exit(0);
  });

  process.on('uncaughtException', async (error) => {
    console.error('\nUncaught exception:', error);
    await cleanup();
    process.exit(1);
  });

  try {
    // Step 1: Run Orchestrator
    console.log('\n=== Step 1: Running Orchestrator ===\n');
    
    queueManager = new QueueManager({
      redisUrl: process.env.REDIS_URL,
      queueName: 'code-indexing',
    });

    const orchestrator = new CodeIndexingOrchestrator(
      tenantId,
      queueManager,
    );

    const result = await orchestrator.orchestrate(
      {
        repositories: ['ai-agent'], // Empty = all repos
        includeArchived: false,
      },
      {
        enableSemanticAnalysis: true,
        enableVectorIndexing: true,
        enableGraphProjection: true,
        enableCloudDiscovery: true,
      }
    );

    runId = result.runId;

    console.log('Orchestration Result:', {
      runId: result.runId,
      repositoriesDiscovered: result.repositoriesDiscovered,
      tasksEnqueued: result.tasksEnqueued,
      errors: result.errors,
    });

    const stats = await orchestrator.getQueueStats();
    console.log('Queue Stats:', stats);

    if (result.tasksEnqueued === 0) {
      console.log('\nNo tasks to process. Exiting...');
      await cleanup();
      return;
    }

    // Step 2: Run Worker
    console.log('\n=== Step 2: Starting Worker ===\n');

    const dbs = await initializeDatabases();

    const config: CodeIndexerConfig = {
      cloneDir: process.env.CLONE_DIR || '/tmp/clones',
      analysisDepth: 'deep',
      enableSemanticAnalysis: true,
      enableVectorIndexing: true,
      enableGraphProjection: true,
      maxConcurrency: 5,
      api: dbs.apiClient,
      neo4j: dbs.neo4j!,
      qdrant: dbs.qdrant!
    };

    worker = new IndexingWorker({
      ...config,
      redisUrl: process.env.REDIS_URL,
      queueName: 'code-indexing',
      concurrency: 1,
    });

    await worker.start();

    // Monitor queue until all jobs are completed
    console.log('\n[Worker] Processing jobs...');
    
    let allJobsCompleted = false;
    while (!allJobsCompleted) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Check every 5 seconds
      
      const currentStats = await orchestrator.getQueueStats();
      console.log('[Monitor] Queue Stats:', {
        waiting: currentStats.waiting,
        active: currentStats.active,
        completed: currentStats.completed,
        failed: currentStats.failed,
      });

      // Check if all jobs are done (none waiting or active)
      if (currentStats.waiting === 0 && currentStats.active === 0) {
        allJobsCompleted = true;
        console.log('\n[Monitor] All jobs completed!');
      }
    }

    // Step 3: Check Status
    console.log('\n=== Step 3: Checking Task Status ===\n');

    checkpointManager = new CheckpointManager({
      redisUrl: process.env.REDIS_URL,
    });

    // Get all completed jobs and show their status
    const queue = queueManager.getQueue();
    const completedJobs = await queue.getCompleted(0, 100);
    
    console.log(`\nFound ${completedJobs.length} completed jobs:`);
    
    for (const job of completedJobs) {
      const checkpoint = await checkpointManager.getCheckpoint(job.data.taskId);
      
      if (checkpoint) {
        console.log(`\nTask: ${job.data.repository.name}`);
        console.log('  Task ID:', checkpoint.taskId);
        console.log('  Stage:', checkpoint.stage);
        console.log('  Timestamp:', new Date(checkpoint.timestamp).toISOString());
        console.log('  Entities Processed:', checkpoint.data.entities?.length || 0);
        console.log('  Relationships Processed:', checkpoint.data.relationships?.length || 0);
      }
    }

    // Show failed jobs if any
    const failedJobs = await queue.getFailed(0, 100);
    if (failedJobs.length > 0) {
      console.log(`\n\nFound ${failedJobs.length} failed jobs:`);
      for (const job of failedJobs) {
        console.log(`\nFailed Task: ${job.data.repository.name}`);
        console.log('  Error:', job.failedReason);
      }
    }

    console.log('\n=== Full Flow Completed Successfully ===\n');

  } catch (error) {
    console.error('\n[Error] Error during full flow execution:', error);
    throw error;
  } finally {
    // Always cleanup
    await cleanup();
  }
}

// Run based on command line argument
const command = process.argv[2];

if (command === 'orchestrator') {
  runOrchestrator().catch(console.error);
} else if (command === 'worker') {
  runWorker().catch(console.error);
} else if (command === 'status') {
  checkTaskStatus().catch(console.error);
} else if (command === 'full' || command === 'debug') {
  runFullFlow().catch((error) => {
    console.error('Full flow failed:', error);
    process.exit(1);
  });
} else {
  console.log('Usage: tsx examples/queue-based-indexing.ts [orchestrator|worker|status|full] [taskId]');
  console.log('');
  console.log('Commands:');
  console.log('  orchestrator - Discover repos and enqueue indexing tasks');
  console.log('  worker       - Start a worker to process tasks from the queue');
  console.log('  status       - Check the status of a task (provide taskId as 3rd arg)');
  console.log('  full/debug   - Run the complete flow: orchestrator → worker → status → cleanup');
  console.log('');
  console.log('Environment Variables:');
  console.log('  TENANT_ID    - Tenant identifier (REQUIRED)');
  console.log('  REDIS_URL    - Redis connection URL (default: redis://localhost:6379)');
  console.log('  QDRANT_URL   - Qdrant URL (default: http://localhost:6333)');
  console.log('  CLONE_DIR    - Directory for cloning repos (default: /tmp/clones)');
  console.log('');
  console.log('Prerequisites:');
  console.log('  - Code integration (GitHub) must be configured in Qdrant for the tenant');
  console.log('  - Custom integration (Microsoft Defender) optional for cloud discovery');
  console.log('');
  console.log('Examples:');
  console.log('  tsx examples/queue-based-indexing.ts full');
  console.log('  tsx examples/queue-based-indexing.ts debug');
}
