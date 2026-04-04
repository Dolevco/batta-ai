import 'dotenv/config';
import { v4 as uuidv4 } from 'uuid';
import { createTaskRepository, createTaskRunRepository } from '@ai-agent/shared';
import type { StoredPlan } from '@ai-agent/core';
import { initializeWorker } from '../src/worker';

/**
 * Example script to create a task and execute it with the worker
 * 
 * This demonstrates the complete task execution flow:
 * 1. Create a task with a plan in the database
 * 2. Create a task run to track execution
 * 3. Execute the task using the worker
 * 4. Verify the results were stored correctly
 * 
 * Prerequisites:
 * - Qdrant running at QDRANT_URL (default: http://localhost:6333)
 * - Redis running at REDIS_URL (optional, for streaming)
 * - Valid API keys configured in .env (copies from packages/api/.env)
 * 
 * Usage:
 *   cd packages/worker
 *   pnpm example
 * 
 * The example creates a simple greeting task with one step that uses
 * natural language generation (no special tools required).
 */
async function main() {
  console.log('🚀 Starting example task creation and execution...\n');

  // Generate IDs
  const taskId = uuidv4();
  const runId = uuidv4();
  const tenantId = 'example-tenant';

  // Create repositories
  const taskRepository = createTaskRepository();
  const taskRunRepository = createTaskRunRepository();

  // Create a simple task with a plan
  const plan: StoredPlan = {
    task: 'Greet the user',
    description: 'A simple greeting task',
    message: 'I will greet the user warmly',
    subTasks: [
      {
        id: 'step-1',
        name: 'Generate greeting',
        intent: 'Generate a warm greeting message',
        context: 'The user wants a friendly greeting',
        expectedOutput: 'A warm greeting message',
        tools: [],
        dependsOn: [],
        requiredInputs: {},
        reason: 'Simple task that requires no special tools',
        executionPlan: 'Generate a friendly greeting message using natural language'
      }
    ],
    createdAt: new Date().toISOString()
  };

  // Save task to database
  console.log('📝 Creating task in database...');
  await taskRepository.create({
    id: taskId,
    description: 'Greet the user warmly',
    tenantId,
    status: 'pending',
    plan,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  console.log(`✅ Task created: ${taskId}\n`);

  // Create task run
  console.log('📋 Creating task run...');
  await taskRunRepository.create({
    id: runId,
    taskId,
    taskName: 'Greet the user warmly',
    tenantId,
    startedAt: new Date().toISOString(),
    status: 'running',
    chainOfThoughts: []
  });
  console.log(`✅ Task run created: ${runId}\n`);

  // Execute the task using the worker
  console.log('🎯 Executing task with worker...\n');
  try {
    await initializeWorker({ taskId, runId, tenantId });
    
    // Verify the execution by reading back the task run
    console.log('\n📊 Verifying execution results...');
    const completedRun = await taskRunRepository.getById(runId, tenantId);
    
    if (completedRun) {
      console.log(`✅ Task run status: ${completedRun.status}`);
      console.log(`⏱️  Duration: ${completedRun.startedAt} → ${completedRun.completedAt}`);
      console.log(`📝 Chain of thoughts events: ${completedRun.chainOfThoughts?.length || 0}`);
      
      if (completedRun.result?.success && completedRun.result.results?.[0]) {
        console.log(`\n💬 Task output:\n   "${completedRun.result.results[0].result}"`);
      }
    }
    
    console.log('\n✅ Example completed successfully!');
  } catch (error) {
    console.error('\n❌ Example failed:', error);
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
