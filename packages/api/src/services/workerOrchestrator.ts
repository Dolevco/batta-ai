import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { ContainerAppsAPIClient } from '@azure/arm-appcontainers';
import { DefaultAzureCredential } from '@azure/identity';
import { 
  createTaskRepository, 
  createTaskRunRepository, 
  createMCPIntegrationRepository,
  createCustomIntegrationRepository,
  getDatabaseConfig, 
  RedisEventPublisher,
  initializePlannedTask,
  cleanupPlannedTask,
  WorkerQueue
} from '@ai-agent/shared';

const execAsync = promisify(exec);

export interface WorkerSpawnConfig {
  taskId: string;
  runId: string;
  tenantId: string;
  environment: 'local' | 'azure' | 'debug';
}

export class WorkerOrchestrator {
  private containerPrefix = 'ai-agent-worker';
  private workerQueue: WorkerQueue;
  // Track in-process debug executions so they can be cancelled
  private debugOperations: Map<string, { controller: AbortController; plannedTask?: any }>;
  
  constructor() {
    this.workerQueue = new WorkerQueue(process.env.REDIS_URL);
    this.debugOperations = new Map();
  }
  
  /**
   * Spawn a worker container to execute a task run
   */
  async spawnWorker(config: WorkerSpawnConfig): Promise<string> {
    const { taskId, runId, tenantId, environment } = config;
    
    // For debug mode, execute directly without Redis queue
    if (environment === 'debug') {
      return this.executeDebug(config);
    }
    
    // Enqueue the task to Redis for container-based workers
    await this.workerQueue.enqueue({ taskId, runId, tenantId }, 60);
    
    if (environment === 'azure') {
      return this.spawnAzureContainerJob(config);
    } else {
      return this.spawnDockerContainer(config);
    }
  }
  
  /**
   * Execute task directly in debug mode (no container)
   */
  private async executeDebug(config: WorkerSpawnConfig): Promise<string> {
    const { taskId, runId, tenantId } = config;
    
    console.log('🔍 Debug mode: Executing task directly in-process...');
    
    // Execute asynchronously, don't block
    // create an AbortController so this execution can be cancelled
    const controller = new AbortController();
    this.debugOperations.set(runId, { controller });

    this.executeDebugAsync(config, controller).catch(error => {
      console.error('❌ Debug execution failed:', error);
    });
    
    return `debug-${runId}`;
  }
  
  /**
   * Execute task directly (async implementation)
   */
  private async executeDebugAsync(config: WorkerSpawnConfig, controller?: AbortController): Promise<void> {
    const { taskId, runId, tenantId } = config;
    
    try {
      console.log('📡 Fetching task and run details from database...');
      
      // Create repository instances
      const dbConfig = getDatabaseConfig();
      const taskRepository = createTaskRepository({
        qdrantUrl: dbConfig.qdrantUrl,
        qdrantApiKey: dbConfig.qdrantApiKey,
        collectionName: dbConfig.taskCollectionName,
      });
      const taskRunRepository = createTaskRunRepository({
        qdrantUrl: dbConfig.qdrantUrl,
        qdrantApiKey: dbConfig.qdrantApiKey,
        collectionName: 'task_runs',
      });
      
      // Fetch task details from DB
      const task = await taskRepository.getById(taskId);
      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }
      
      console.log(`📝 Task: ${task.description}`);
      console.log(`🔧 Tools: ${task.tools?.join(', ') || 'none'}`);
      
      // Fetch run details from DB
      const taskRun = await taskRunRepository.getById(runId, tenantId);
      if (!taskRun) {
        throw new Error(`Task run ${runId} not found`);
      }
      
      console.log(`⏰ Run started at: ${taskRun.startedAt}`);
      
      // Update run status to running
      await taskRunRepository.update(runId, {
        status: 'running',
        tenantId,
      });
      
      // Set up Redis publisher for streaming if configured
      let redisPublisher: RedisEventPublisher | undefined;
      const redisUrl = process.env.REDIS_URL;
      
      if (redisUrl) {
        const pubsubChannel = `${tenantId}:${runId}`;
        redisPublisher = new RedisEventPublisher(pubsubChannel, redisUrl);
        await redisPublisher.connect();
        console.log(`📡 Redis publisher connected: ${pubsubChannel}`);
      }
      
      // Check if task has a plan
      if (!task.plan) {
        throw new Error('Task has no plan to execute');
      }
      
      // Initialize chain of thoughts
      const chainOfThoughts: any[] = [];
      
      // Load MCP integrations if task has tools
      let mcpIntegrations: any[] = [];
      if (task.tools && task.tools.length > 0) {
        try {
          const mcpIntegrationRepository = createMCPIntegrationRepository();
          const allMcpIntegrations = await mcpIntegrationRepository.getAll(tenantId, true);
          
          mcpIntegrations = allMcpIntegrations.filter(
            (integration: any) => integration.enabled && task.tools!.includes(integration.id)
          );
          
          console.log(`📦 Loaded ${mcpIntegrations.length} MCP integrations`);
        } catch (error) {
          console.warn('⚠️  Failed to load MCP integrations:', error);
        }
      }
      
      // Prepare Redis channel if configured
      const redisChannel = redisPublisher ? `${tenantId}:${taskRun.id}` : undefined;
      
      // Initialize PlannedTask with all dependencies using the shared factory
      const customIntegrationRepository = createCustomIntegrationRepository();
      const result = await initializePlannedTask({
        usePlanningAssistantMode: false,
        mcpIntegrations,
        customIntegrationRepository,
        tenantId,
        toolsFilter: task.tools,
        redisUrl,
        redisChannel,
        enableChainOfThoughts: true,
      });
      
      const { plannedTask } = result;

      // If this is a debug run tracked by controller, attach plannedTask reference so it can be cancelled
      if (controller) {
        const entry = this.debugOperations.get(runId);
        if (entry) {
          entry.plannedTask = plannedTask;

          // If the controller is aborted later, ensure plannedTask is notified
          try {
            controller.signal.addEventListener('abort', () => {
              try {
                (entry.plannedTask as any).cancel?.();
              } catch (e) { /* ignore */ }
              try { (entry.plannedTask as any).events?.emit?.('abort', { message: 'Cancelled by user' }); } catch (e) { /* ignore */ }
            });
          } catch (e) {
            // ignore
          }
        }
      }
       
      // Store chain of thoughts reference if enabled
      if (result.chainOfThoughts) {
        chainOfThoughts.push(...result.chainOfThoughts);
      }
      
      let executionResult: any;
      try {
        // Execute the plan
        console.log(`🎯 Executing plan with ${task.plan.subTasks.length} steps...`);
        executionResult = await plannedTask.executePlan(task.plan);
        
        // Update run with success
        const finalStatus = executionResult.success ? 'completed' : 'failed';
        await taskRunRepository.update(runId, {
          status: finalStatus,
          tenantId,
          completedAt: new Date().toISOString(),
          result: executionResult,
          chainOfThoughts: result.chainOfThoughts
        });
        
        console.log(`✅ Task execution ${finalStatus}`);
      } catch (error: any) {
        console.error('❌ Task execution failed:', error);
        
        // Update run with failure
        await taskRunRepository.update(runId, {
          status: 'failed',
          tenantId,
          completedAt: new Date().toISOString(),
          error: error?.message || 'Execution failed',
          chainOfThoughts: result.chainOfThoughts
        });
        
        throw error;
      } finally {
        redisPublisher?.publish('done', executionResult);
        // Cleanup resources
        await cleanupPlannedTask(result);
        
        // Disconnect Redis publisher
        if (redisPublisher) {
          await redisPublisher.close();
        }
        // Remove debug operation entry if present
        try { this.debugOperations.delete(runId); } catch (e) { /* ignore */ }
      }
    } catch (error: any) {
      console.error('❌ Debug execution error:', error);
      throw error;
    }
  }
  
  /**
   * Spawn a Docker container locally
   */
  private async spawnDockerContainer(config: WorkerSpawnConfig): Promise<string> {
    const { runId } = config;
    const containerName = `${this.containerPrefix}-${runId}`;

    // Build environment variables (exclude TASK_ID, RUN_ID, TENANT_ID - now in Redis queue)
    const envObj: Record<string, string | undefined> = {
      REDIS_URL: 'redis://127.0.0.1:6379',
      QDRANT_URL: 'http://127.0.0.1:6333',
      QDRANT_API_KEY: process.env.QDRANT_API_KEY,
      AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT,
      AZURE_OPENAI_API_KEY: process.env.AZURE_OPENAI_API_KEY,
      AZURE_OPENAI_DEPLOYMENT: process.env.AZURE_OPENAI_DEPLOYMENT,
      AZURE_OPENAI_API_VERSION: process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview',

      // Optional embedding config
      AZURE_OPENAI_EMBEDDING_ENDPOINT: process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT,
      AZURE_OPENAI_EMBEDDING_API_KEY: process.env.AZURE_OPENAI_EMBEDDING_API_KEY,
      AZURE_OPENAI_EMBEDDING_DEPLOYMENT: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
      AZURE_OPENAI_EMBEDDING_API_VERSION: process.env.AZURE_OPENAI_EMBEDDING_API_VERSION,

      // Git / GitHub
      GIT_ACCESS_TOKEN: process.env.GIT_ACCESS_TOKEN,
      GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG,
      GITHUB_APP_ID: process.env.GITHUB_APP_ID,
      GITHUB_REDIRECT_URI: process.env.GITHUB_REDIRECT_URI,
      GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,

      // Slack
      SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID,
      SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET,
      SLACK_REDIRECT_URI: process.env.SLACK_REDIRECT_URI,

      // UI / misc
      UI_BASE_URL: process.env.UI_BASE_URL,
    };

    // If the host env points services at localhost, replace them with container service names
    const normalizeLocalhost = (key: string, value?: string) => {
      if (!value) return value;
      const lowered = value.toLowerCase();
      // If value targets localhost or loopback, map to container host
      if (lowered.includes('localhost') || lowered.includes('127.0.0.1') || lowered.includes('[::1]') || lowered.includes('::1')) {
        if (key === 'QDRANT_URL') return 'http://127.0.0.1:6333';
        if (key === 'REDIS_URL') return 'redis://127.0.0.1:6379';
      }
      return value;
    };

    const normalizedEnvObj: Record<string, string | undefined> = Object.fromEntries(
      Object.entries(envObj).map(([k, v]) => [k, normalizeLocalhost(k, v)])
    );

    const envVars: string[] = Object.entries(normalizedEnvObj)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `-e ${k}=${this.shellQuote(v)}`);

    // Docker run command with auto-remove and network
    const dockerCommand = [
      'docker run',
      '-d',
      `--name ${containerName}`,
      '--network host',
      ...envVars,
      'ai-agent-worker:latest'
    ].join(' ');

    console.log(`🐳 Spawning Docker container: ${containerName}`);

    try {
      const { stdout, stderr } = await execAsync(dockerCommand);
      const containerId = stdout.trim();
      
      if (stderr) {
        console.warn(`Docker spawn warning: ${stderr}`);
      }
      
      console.log(`✅ Container spawned: ${containerId.substring(0, 12)}`);
      return containerId;
    } catch (error: any) {
      console.error('Failed to spawn Docker container:', error);
      throw new Error(`Failed to spawn worker container: ${error.message}`);
    }
  }
  
  /**
   * Spawn an Azure Container Apps Job
   */
  private async spawnAzureContainerJob(config: WorkerSpawnConfig): Promise<string> {
    const { runId } = config;
    
    // Azure Container Apps Job configuration
    const resourceGroup = process.env.AZURE_RESOURCE_GROUP;
    const jobName = process.env.AZURE_CONTAINER_JOB_NAME || 'ai-agent-worker';
    const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
    
    if (!resourceGroup || !subscriptionId) {
      throw new Error('Missing Azure configuration: AZURE_RESOURCE_GROUP and AZURE_SUBSCRIPTION_ID required');
    }
    
    console.log(`☁️  Spawning Azure Container Job: ${jobName} for run ${runId}`);
    
    try {
      // Initialize Azure SDK client with managed identity
      const credential = new DefaultAzureCredential();
      const client = new ContainerAppsAPIClient(credential, subscriptionId);
      
      // Start job execution using Azure SDK
      const execution = await client.jobs.beginStart(
        resourceGroup,
        jobName
      );
      
      const result = await execution.pollUntilDone();
      const executionName = result.name || runId;
      
      console.log(`✅ Azure job execution started: ${executionName}`);
      return executionName;
    } catch (error: any) {
      console.error('Failed to spawn Azure Container Job:', error);
      throw new Error(`Failed to spawn Azure worker job: ${error.message}`);
    }
  }
  
  /**
   * Terminate a running worker container or job
   */
   async terminateWorker(workerId: string, environment: 'local' | 'azure' | 'debug'): Promise<boolean> {
    if (environment === 'debug') {
      return this.terminateLocalRun(workerId);
    }
    
    if (environment === 'azure') {
      return this.terminateAzureContainerJob(workerId);
    } 
      
    return this.terminateDockerContainer(workerId);
   }

  private async terminateLocalRun(workerId: string) {
    // workerId for debug runs is returned as `debug-<runId>` from spawnWorker
      const runId = workerId && workerId.startsWith('debug-') ? workerId.replace(/^debug-/, '') : workerId;
      const entry = this.debugOperations.get(runId);
      if (!entry) {
        console.log(`🔍 Debug mode: No in-process operation found for run ${runId}`);
        return true;
      }

      try {
        // Abort the controller which will trigger plannedTask cancellation if attached
        entry.controller.abort();

        // Best-effort attempt to call cancel/abort on plannedTask
        if (entry.plannedTask) {
          try { (entry.plannedTask as any).cancel?.(); } catch (e) { /* ignore */ }
          try { (entry.plannedTask as any).events?.emit?.('abort', { message: 'Cancelled by user' }); } catch (e) { /* ignore */ }
        }
      } catch (e) {
        console.error('Failed to terminate debug worker:', e);
      } finally {
        try { this.debugOperations.delete(runId); } catch (e) { /* ignore */ }
      }

      return true;
  }
  
  /**
   * Terminate a Docker container
   */
  private async terminateDockerContainer(containerId: string): Promise<boolean> {
    console.log(`🛑 Terminating Docker container: ${containerId}`);
    
    try {
      // Try to stop the container gracefully first
      await execAsync(`docker stop ${containerId}`);
      console.log(`✅ Container stopped: ${containerId.substring(0, 12)}`);
      
      // Remove the container
      try {
        await execAsync(`docker rm ${containerId}`);
        console.log(`✅ Container removed: ${containerId.substring(0, 12)}`);
      } catch (rmError) {
        // Container might already be removed, ignore
        console.warn(`⚠️  Failed to remove container (may already be removed): ${rmError}`);
      }
      
      return true;
    } catch (error: any) {
      console.error('Failed to terminate Docker container:', error);
      
      // Try force kill as fallback
      try {
        await execAsync(`docker kill ${containerId}`);
        await execAsync(`docker rm ${containerId}`);
        console.log(`✅ Container force-killed and removed: ${containerId.substring(0, 12)}`);
        return true;
      } catch (killError) {
        console.error('Failed to force-kill Docker container:', killError);
        return false;
      }
    }
  }
  
  /**
   * Terminate an Azure Container Apps Job execution
   */
  private async terminateAzureContainerJob(executionName: string): Promise<boolean> {
    console.log(`🛑 Terminating Azure Container Job execution: ${executionName}`);
    
    const resourceGroup = process.env.AZURE_RESOURCE_GROUP;
    const jobName = process.env.AZURE_CONTAINER_JOB_NAME || 'ai-agent-worker';
    const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
    
    if (!resourceGroup || !subscriptionId) {
      console.error('Missing Azure configuration for termination');
      return false;
    }
    
    try {
      const credential = new DefaultAzureCredential();
      const client = new ContainerAppsAPIClient(credential, subscriptionId);
      await client.jobs.beginStopExecutionAndWait(
        resourceGroup,
        jobName,
        executionName
      );
      // Azure Container Apps Jobs don't have a direct stop API for executions
      // The execution will check for cancelled status in the task run and stop itself
      // This is a placeholder that could be extended if Azure adds stop capabilities
      console.log(`⚠️  Azure Container Apps Jobs cannot be stopped directly. Worker will check task run status.`);
      return true;
    } catch (error: any) {
      console.error('Failed to terminate Azure Container Job:', error);
      return false;
    }
  }

  /**
   * Check if a worker container is still running
   */
  async isWorkerRunning(containerId: string, environment: 'local' | 'azure' | 'debug'): Promise<boolean> {
    if (environment === 'azure' || environment === 'debug') {
      // Azure Container Apps Jobs and debug mode don't need to be monitored - they auto-cleanup
      return false;
    }
    
    try {
      const { stdout } = await execAsync(`docker ps -q -f id=${containerId}`);
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  // Ensure the worker Docker image is available locally; build if missing
  /*private async ensureWorkerImageBuilt(): Promise<void> {
    try {
      const { stdout } = await execAsync('docker images -q ai-agent-worker:latest');
      if (stdout && stdout.trim()) {
        console.log('🧩 Worker Docker image found locally.');
        return;
      }

      // Determine build context: allow override via env, otherwise try common paths
      const candidatePaths = [
        process.env.WORKER_DOCKER_BUILD_CONTEXT,
        path.resolve(__dirname, '../../../worker'),
      ].filter(Boolean) as string[];

      const contextPath = candidatePaths.find(p => p && fs.existsSync(path.join(p, 'Dockerfile')));

      if (!contextPath) {
        console.warn('⚠️ Could not find worker Dockerfile in expected locations. Skipping build.');
        return;
      }

      console.log(`🔨 Building worker Docker image from context: ${contextPath}`);
      const buildCmd = `docker build -t ai-agent-worker:latest ${this.shellQuote(contextPath)}`;
      const buildResult = await execAsync(buildCmd);

      if (buildResult.stderr) {
        console.warn(`Docker build warnings: ${buildResult.stderr}`);
      }

      console.log('✅ Worker Docker image built successfully.');
    } catch (err: any) {
      console.error('Failed to build worker Docker image:', err);
      // Allow spawn to continue — throw would prevent running; choose to throw to surface error
      throw new Error(`Failed to build worker Docker image: ${err.message}`);
    }
  }*/

  // Helper to safely quote values for shell (single-quote style)
  private shellQuote(value?: string): string {
    if (value === undefined || value === null) return "''";
    return `'${String(value).replace(/'/g, "'\\''")}'`;
  }
}
