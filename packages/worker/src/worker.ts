import { TaskData, TaskExecutionContext } from './types';
import { executeTask } from './executor';
import { createTaskRepository, createTaskRunRepository, getDatabaseConfig, RedisEventPublisher } from '@ai-agent/shared';

interface WorkerConfig {
  taskId: string;
  runId: string;
  tenantId: string;
}

export async function initializeWorker(config: WorkerConfig): Promise<void> {
  const { taskId, runId, tenantId } = config;
  
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
  
  // Build execution context
  const context: TaskExecutionContext = {
    task: task as TaskData,
    taskRun,
    tenantId,
    redisPublisher,
  };
  
  let result: any;
  try {
    // Execute the task
    console.log('🎯 Starting task execution...');
    result = await executeTask(context);
    
    // Update run with success
    const finalStatus = result.success ? 'completed' : 'failed';
    await taskRunRepository.update(runId, {
      status: finalStatus,
      tenantId,
      completedAt: new Date().toISOString(),
      result: result,
      chainOfThoughts: context.chainOfThoughts || []
    });
    
    console.log(`✅ Task execution ${finalStatus}`);
  } catch (error: any) {
    result = error;
    console.error('❌ Task execution failed:', error);
    
    // Update run with failure
    await taskRunRepository.update(runId, {
      status: 'failed',
      tenantId,
      completedAt: new Date().toISOString(),
      error: error?.message || 'Execution failed',
      chainOfThoughts: context.chainOfThoughts || []
    });
    
    throw error;
  } finally {
    redisPublisher?.publish('done', result);
    // Cleanup Redis publisher
    if (redisPublisher) {
      await redisPublisher.close();
      console.log('📡 Redis publisher closed');
    }
  }
}
