import { v4 as uuidv4 } from 'uuid';
import type { TaskExecutionContext, ChainThoughtEvent } from './types';
import { 
  createMCPIntegrationRepository, 
  createCustomIntegrationRepository,
  createTaskRunRepository,
  initializePlannedTask,
  cleanupPlannedTask
} from '@ai-agent/shared';
import { executePRValidation } from './prValidationExecutor';
import type { PRValidationPlan } from './prValidationExecutor';

export async function executeTask(context: TaskExecutionContext): Promise<any> {
  const { task, taskRun, tenantId, redisPublisher } = context;
  
  if (!task.plan) {
    throw new Error('Task has no plan to execute');
  }

  // ── PR Validation fast-path ───────────────────────────────────────────────
  // Detected before generic plan execution to avoid MCP/PlannedTask overhead.
  if ((task.plan as any).agentType === 'pr-validation') {
    const plan = task.plan as unknown as PRValidationPlan;

    // Bootstrap LLM client (same env vars as the generic path)
    const result = await initializePlannedTask({
      usePlanningAssistantMode: false,
      mcpIntegrations: [],
      customIntegrationRepository: createCustomIntegrationRepository(),
      tenantId,
      enableChainOfThoughts: false,
    });

    try {
      await executePRValidation(plan, result.apiClient);
      return { success: true };
    } finally {
      await cleanupPlannedTask(result);
    }
  }
  // ─────────────────────────────────────────────────────────────────────────
  const chainOfThoughts: ChainThoughtEvent[] = [];
  context.chainOfThoughts = chainOfThoughts;
  
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
  const redisUrl = redisPublisher ? process.env.REDIS_URL : undefined;
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
  
  // Store chain of thoughts reference if enabled
  if (result.chainOfThoughts) {
    context.chainOfThoughts = result.chainOfThoughts;
  }
  
  // Graceful shutdown via OS signal handler (SIGTERM/SIGINT) instead of DB polling
  let cancelled = false;

  const gracefulShutdownHandler = () => {
    console.log('⚠️  Received termination signal — cancelling task run gracefully');
    cancelled = true;
    // Ask the plannedTask to cancel and emit abort as a best-effort
    try {
      (plannedTask as any).cancel?.();
    } catch (e) { /* ignore */ }
    try {
      (plannedTask as any).events?.emit?.('abort', { message: 'Cancelled by signal' });
    } catch (e) { /* ignore */ }
  };

  process.on('SIGTERM', gracefulShutdownHandler);
  process.on('SIGINT', gracefulShutdownHandler);

  try {
    // Execute the plan
    console.log(`🎯 Executing plan with ${task.plan.subTasks.length} steps...`);
    const executionResult = await plannedTask.executePlan(task.plan);
    
    // Check if cancelled due to signal during execution
    if (cancelled) {
      throw new Error('Task run was cancelled');
    }
    
    return executionResult;
  } finally {
    // Remove signal handlers
    try { process.off('SIGTERM', gracefulShutdownHandler); } catch (e) { /* ignore */ }
    try { process.off('SIGINT', gracefulShutdownHandler); } catch (e) { /* ignore */ }
    // Cleanup resources
    await cleanupPlannedTask(result);
  }
}
