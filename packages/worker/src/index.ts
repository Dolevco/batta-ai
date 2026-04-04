import { initializeWorker } from './worker';
import { WorkerQueue } from '@ai-agent/shared';

async function main() {
  try {
    console.log('🚀 Worker starting...');
    
    // Initialize Redis queue
    const workerQueue = new WorkerQueue(process.env.REDIS_URL);
    await workerQueue.connect();
    
    console.log('📡 Waiting for task from Redis queue...');
    
    // Dequeue task from Redis
    const task = await workerQueue.dequeue();
    
    if (!task) {
      console.log('⏱️  No task received within timeout, exiting...');
      await workerQueue.close();
      process.exit(0);
    }
    
    const { taskId, runId, tenantId } = task;
    
    console.log(`📋 Task ID: ${taskId}`);
    console.log(`🔄 Run ID: ${runId}`);
    console.log(`🏢 Tenant ID: ${tenantId}`);
    
    // Close queue connection before starting execution
    await workerQueue.close();
    
    await initializeWorker({ taskId, runId, tenantId });
    
    console.log('✅ Worker completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Worker failed:', error);
    process.exit(1);
  }
}

main();
