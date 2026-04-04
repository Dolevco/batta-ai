import type { CreateTaskRequest, TaskResponse, TaskRun, ChainThoughtEvent } from '../types';
import { ITaskRepository, IMCPIntegrationRepository, ITaskRunRepository, IFeedbackRepository, ICustomIntegrationRepository, IChatMessageRepository, RedisEventSubscriber } from '@ai-agent/shared';
import { v4 as uuidv4 } from 'uuid';
import { attachProgressListeners, detachProgressListeners, initializePlannedTask, createTaskStepMemory } from '@ai-agent/shared';
import { StoredPlan, formatChainOfThoughts} from '@ai-agent/core';
import { WorkerOrchestrator } from './workerOrchestrator';

export class TaskService {
  private workerOrchestrator: WorkerOrchestrator;
  
  constructor(
    private repository: ITaskRepository,
    private chatMessageRepository: IChatMessageRepository,
    private mcpIntegrationRepository: IMCPIntegrationRepository,
    private taskRunRepository: ITaskRunRepository,
    private feedbackRepository: IFeedbackRepository,
    private customIntegrationRepository: ICustomIntegrationRepository
  ) {
    this.workerOrchestrator = new WorkerOrchestrator();
  }

  // Track running operations so they can be cancelled from external callers
  private runningOperations: Map<string, { controller: AbortController; plannedTask?: any; listeners?: { event: string; fn: (...args: any[]) => void }[] }> = new Map();

  /**
   * Cancel a specific task run by its run ID.
   * Returns true if the run was found and cancelled.
   */
  async cancelTaskRun(runId: string, tenantId: string): Promise<boolean> {
    try {
      // Fetch the task run
      const taskRun = await this.taskRunRepository.getById(runId, tenantId);
      
      if (!taskRun) {
        console.log(`Task run ${runId} not found`);
        return false;
      }
      
      if (taskRun.status !== 'running') {
        console.log(`Task run ${runId} is not running (status: ${taskRun.status})`);
        return false;
      }
      
      // Update run status to cancelled
      await this.taskRunRepository.update(runId, {
        status: 'cancelled',
        tenantId,
        completedAt: new Date().toISOString(),
        error: 'Cancelled by user',
      });
      
      console.log(`✅ Task run ${runId} marked as cancelled`);
      
      // Terminate the worker if we have a workerId
      if (taskRun.workerId && taskRun.environment) {
        console.log(`🛑 Terminating worker ${taskRun.workerId} for task run ${runId}`);
        await this.workerOrchestrator.terminateWorker(taskRun.workerId, taskRun.environment);
      }
      
      return true;
    } catch (e) {
      console.error('Error cancelling task run:', e);
      throw e;
    }
  }
  
  /**
   * Cancel a running in-process task operation (planning / message processing).
   * This is for operations that haven't spawned a worker yet.
   * Returns true if an operation was found and cancelled.
   */
  cancelTask(taskId: string): boolean {
    const entry = this.runningOperations.get(taskId);
    if (!entry) return false;
    
    try {
      // First, trigger the abort signal so any listeners on the controller react
      entry.controller.abort();

      // If we have a plannedTask instance, ask it to cancel explicitly
      const pt = entry.plannedTask;
      if (pt) {
        try {
          (pt as any).cancel?.();
        } catch (e) { /* ignore */ }

        try {
          (pt as any).events?.emit?.('abort', { message: 'Cancelled by user' });
        } catch (e) { /* ignore */ }
      }

      // detach listeners so we don't leak memory
      if (entry.plannedTask && entry.listeners) {
        try { detachProgressListeners(entry.plannedTask, entry.listeners); } catch (e) { /* ignore */ }
      }
    } catch (e) {
      // ignore cancellation errors
    } finally {
      this.runningOperations.delete(taskId);
    }

    return true;
  }

  // Added optional onProgress callback to stream events during planning
  async createTask(request: CreateTaskRequest, tenantId: string, onProgress?: (eventName: string, payload: unknown) => void): Promise<TaskResponse> {
    const taskId = uuidv4();
    // create an abort controller for this operation so it can be cancelled later
    const controller = new AbortController();
    this.runningOperations.set(taskId, { controller });
    const conversationId = request.conversationId || uuidv4();
    
    const task: TaskResponse = {
      id: taskId,
      description: request.description,
      agentId: request.agentId,
      tenantId,
      tools: request.tools,
      status: 'planning',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Save initial task to repository
    await this.repository.create(task);
    
    // Load MCP integrations - filter by tools array if provided
    let mcpIntegrations = await this.mcpIntegrationRepository.getAll(tenantId, true);
    if (request.tools && request.tools.length > 0) {
      mcpIntegrations = mcpIntegrations.filter(integration => 
        request.tools!.includes(integration.id)
      );
    }
    
    const { plannedTask } = await this.preparePlannedTask(
      task,
      false,
      mcpIntegrations,
      request.tools,
      true
    );
    
    // register running operation (reuse the controller created earlier) and attach listeners
    this.registerRunningOperation(taskId, plannedTask, onProgress, { markTaskFailedOnAbort: true, task });

    // Build full context including chat history
    let contextualDescription = `Create a plan for the following ask: ${request.description}`;
    if (request.chatHistory && request.chatHistory.length > 0) {
      const historyContext = request.chatHistory
        .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
        .join('\n');
      contextualDescription = `Previous conversation:\n${historyContext}\n\nCurrent plan request: ${request.description}`;
    }

    // (listeners and abort handler already attached by registerRunningOperation)

    // Generate real plan if PlannedTask is available
    try {
      await this.chatMessageRepository.create({
          id: uuidv4(),
          conversationId,
          taskId,
          tenantId,
          role: 'user',
          content: request.description,
          createdAt: new Date().toISOString(),
          metadata: { source: 'task_creation' }
        });

      const generatePlanResult = await plannedTask.generatePlan(contextualDescription);
      if (!generatePlanResult.success || !generatePlanResult?.result) {
        throw new Error(`'Failed to generate plan:' ${JSON.stringify(generatePlanResult)}`);
      }

      const storedPlan = generatePlanResult.result!;
      
      // Store the plan in the task
      task.plan = storedPlan;
      await this.chatMessageRepository.create({
          id: uuidv4(),
          conversationId,
          taskId,
          tenantId,
          role: 'assistant',
          content: storedPlan.message,
          createdAt: new Date().toISOString(),
          metadata: { 
            source: 'task_creation',
            taskStatus: task.status,
            stepCount: task.plan?.subTasks?.length || 0
          }
        });


    } catch (error) {
      console.error(error);
      task.status = 'failed';
    } finally {
      // detach listeners
      try { detachProgressListeners(plannedTask, /* listeners from map */ this.runningOperations.get(taskId)?.listeners || []); } catch (e) { /* ignore */ }
      // cleanup running operation entry
      this.runningOperations.delete(taskId);
    }

    task.updatedAt = new Date().toISOString();
    
    
    // Update task in repository
    await this.repository.update(taskId, task);
    
    return task;
  }

  async getTask(id: string, tenantId: string): Promise<TaskResponse | undefined> {
    return this.getTaskWithChatMessages(id, tenantId);
  }

  private async getTaskWithChatMessages(taskId: string, tenantId: string): Promise<TaskResponse | undefined> {
    const task = await this.repository.getById(taskId);
    if (!task) return undefined;

    const chatMessages = await this.chatMessageRepository.getByTaskId(taskId);
    chatMessages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    task.chatMessages = chatMessages;

    const feedbacks = await this.feedbackRepository.getByTaskId(taskId, tenantId);
    feedbacks.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    task.feedbacks = feedbacks;

    return task;
  }

  async getAllTasks(tenantId: string): Promise<TaskResponse[]> {
    return this.repository.getAll({ tenantId });
  }

  async deleteTask(id: string, tenantId: string): Promise<boolean> {
    return await this.repository.delete(id);
  }

  async sendTaskMessage(taskId: string, message: string, tenantId: string, onProgress?: (eventName: string, payload: unknown) => void): Promise<TaskResponse> {
    // Get existing task
    const task = await this.getTaskWithChatMessages(taskId, tenantId);
    if (!task) {
      throw new Error('Task not found');
    }
    const chatMessages = task.chatMessages!;

    // Save the user message
    const conversationId = chatMessages[0]?.conversationId || uuidv4();
    await this.chatMessageRepository.create({
      id: uuidv4(),
      conversationId,
      taskId,
      tenantId,
      role: 'user',
      content: message,
      createdAt: new Date().toISOString(),
      metadata: { source: 'task_conversation' }
    });
    
    // Build context from chat history + new message
    const historyContext = chatMessages
      .map(msg => `{${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}}`)
      .join('\n');
    
    // Add current plan context if it exists
    let planContext = '';
    if (task.plan) {
      planContext = `\n\nCurrent Plan:\n${JSON.stringify(task.plan, null, 2)}`;
    }
    
    const contextualDescription = `Chat history: ${historyContext}${planContext}\n\nUser: ${message}`;

    // Initialize planned task and regenerate plan
    // Load MCP integrations - filter by task's tools if available
    let mcpIntegrations = await this.mcpIntegrationRepository.getAll(tenantId, true);
    if (task.tools && task.tools.length > 0) {
      mcpIntegrations = mcpIntegrations.filter(integration => 
        task.tools!.includes(integration.id)
      );
    }
    
    const { plannedTask } = await this.preparePlannedTask(
      task,
      true,
      mcpIntegrations,
      task.tools,
      true
    );
    
    // register running operation and attach listeners
    this.registerRunningOperation(taskId, plannedTask, onProgress);

    try {
      task.updatedAt = new Date().toISOString();
      await this.repository.update(taskId, task);

      const executeResult = await plannedTask.execute(contextualDescription);
      if (!executeResult.success) {
        throw new Error(`Failed to process message: ${executeResult.summary}`);
      }

      // Check if a plan was generated (result will be a StoredPlan)
      if (executeResult.result && typeof executeResult.result === 'object' && 'subTasks' in executeResult.result) {
        const storedPlan = executeResult.result as StoredPlan;
        
        // Store the plan in the task
        task.plan = storedPlan;

        task.status = 'pending';
      } else {
        // No new plan generated - just a text response (clarification, answer, etc.)
        task.status = task.plan ? 'pending' : 'planning';
      }

      // Save assistant response
      await this.chatMessageRepository.create({
        id: uuidv4(),
        conversationId,
        taskId,
        tenantId,
        role: 'assistant',
        content: (executeResult.result as StoredPlan)?.description ?? executeResult.result,
        createdAt: new Date().toISOString(),
        metadata: { 
          source: 'task_conversation',
          taskStatus: task.status,
          stepCount: task.plan?.subTasks.length || 0,
          hasPlan: !!executeResult.result
        }
      });

    } catch (error) {
      console.error(error);
      task.status = 'failed';
    } finally {
      try { detachProgressListeners(plannedTask, this.runningOperations.get(taskId)?.listeners || []); } catch (e) { /* ignore */ }
      this.runningOperations.delete(taskId);
    }

    task.updatedAt = new Date().toISOString();
    await this.repository.update(taskId, task);
    
    return (await this.getTaskWithChatMessages(taskId, tenantId))!;
  }

  async refinePlanFromRun(taskId: string, runId: string, tenantId: string, onProgress?: (eventName: string, payload: unknown) => void): Promise<TaskResponse> {
    // Get existing task
    const task = await this.getTaskWithChatMessages(taskId, tenantId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Get the task run to extract chain of thoughts
    const taskRun = await this.taskRunRepository.getById(runId, tenantId);
    if (!taskRun) {
      throw new Error('Task run not found');
    }

    // Get feedbacks for the task
    const feedbacks = await this.feedbackRepository.getByTaskId(taskId, tenantId);

    // Build refinement message from run data and feedbacks
    let refinementMessage = `Please refine the plan based on the following execution run and feedback:\n\n`;

    // Add run summary
    refinementMessage += `## Execution Run Summary\n`;
    refinementMessage += `Status: ${taskRun.status}\n`;
    refinementMessage += `Started: ${taskRun.startedAt}\n`;
    if (taskRun.completedAt) {
      refinementMessage += `Completed: ${taskRun.completedAt}\n`;
    }
    if (taskRun.error) {
      refinementMessage += `Error: ${taskRun.error}\n`;
    }
    refinementMessage += `\n`;

    // Add chain of thoughts analysis
    if (taskRun.chainOfThoughts && taskRun.chainOfThoughts.length > 0) {
      refinementMessage += `## Execution Flow\n`;
      refinementMessage += formatChainOfThoughts(taskRun.chainOfThoughts);
      refinementMessage += `\n`;
    }

    // Add feedbacks
    if (feedbacks && feedbacks.length > 0) {
      refinementMessage += `## User Feedback\n`;
      for (const fb of feedbacks) {
        const ratingLabel = fb.rating ? `[${fb.rating.toUpperCase()}]` : '[FEEDBACK]';
        refinementMessage += `${ratingLabel}: ${fb.content}\n`;
      }
      refinementMessage += `\n`;
    }

    refinementMessage += `Based on the above information, please analyze what worked well and what didn't, and generate an improved plan that addresses the issues and feedback.`;

    // Save the refinement request message
    const conversationId = task.chatMessages?.[0]?.conversationId || uuidv4();
    await this.chatMessageRepository.create({
      id: uuidv4(),
      conversationId,
      taskId,
      tenantId,
      role: 'user',
      content: `Refine the plan based on run ${runId} results and feedbacks`,
      createdAt: new Date().toISOString(),
      metadata: { source: 'plan_refinement', taskRunId: runId }
    });

    // Build context from chat history + refinement message
    const chatMessages = task.chatMessages || [];
    const historyContext = chatMessages
      .map(msg => `{${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}}`)
      .join('\n');
    
    let planContext = '';
    if (task.plan) {
      planContext = `\n\nCurrent Plan:\n${JSON.stringify(task.plan, null, 2)}`;
    }
    
    const contextualDescription = `Chat history: ${historyContext}${planContext}\n\nUser: ${refinementMessage}`;

    // Initialize planned task and regenerate plan
    let mcpIntegrations = await this.mcpIntegrationRepository.getAll(tenantId, true);
    if (task.tools && task.tools.length > 0) {
      mcpIntegrations = mcpIntegrations.filter(integration => 
        task.tools!.includes(integration.id)
      );
    }
    
    const { plannedTask } = await this.preparePlannedTask(
      task,
      true,
      mcpIntegrations,
      task.tools,
      true
    );
    
    // register running operation and attach listeners
    this.registerRunningOperation(taskId, plannedTask, onProgress);

    try {
      task.updatedAt = new Date().toISOString();
      await this.repository.update(taskId, task);

      const executeResult = await plannedTask.execute(contextualDescription);
      if (!executeResult.success) {
        throw new Error(`Failed to refine plan: ${executeResult.summary}`);
      }

      // Check if a plan was generated
      if (executeResult.result && typeof executeResult.result === 'object' && 'subTasks' in executeResult.result) {
        const storedPlan = executeResult.result as StoredPlan;
        
        // Store the plan in the task
        task.plan = storedPlan;
        task.status = 'pending';
      } else {
        // No new plan generated - just a text response
        task.status = task.plan ? 'pending' : 'planning';
      }

      // Save assistant response
      await this.chatMessageRepository.create({
        id: uuidv4(),
        conversationId,
        taskId,
        tenantId,
        role: 'assistant',
        content: (executeResult.result as StoredPlan)?.description ?? executeResult.result,
        createdAt: new Date().toISOString(),
        metadata: { 
          source: 'plan_refinement',
          taskStatus: task.status,
          stepCount: task.plan?.subTasks.length || 0,
          hasPlan: !!executeResult.result,
          refinedFromRunId: runId
        }
      });

    } catch (error) {
      console.error(error);
      task.status = 'failed';
    } finally {
      try { detachProgressListeners(plannedTask, this.runningOperations.get(taskId)?.listeners || []); } catch (e) { /* ignore */ }
      this.runningOperations.delete(taskId);
    }

    task.updatedAt = new Date().toISOString();
    await this.repository.update(taskId, task);
    
    return (await this.getTaskWithChatMessages(taskId, tenantId))!;
  }

  async executeTaskPlan(task: TaskResponse, onProgress?: (eventName: string, payload: unknown) => void, providedRunId?: string): Promise<any> {
    if (!task.plan) {
      throw new Error('Task has no plan to execute');
    }

    // Create a task run to track this execution - use provided runId or generate one
    const runId = providedRunId || uuidv4();
    
    // Determine environment (local docker, azure, or debug)
    let environment: 'local' | 'azure' | 'debug' = 'local';
    if (process.env.WORKER_ENVIRONMENT === 'azure') {
      environment = 'azure';
    } else if (process.env.WORKER_ENVIRONMENT === 'debug') {
      environment = 'debug';
    }
    
    const taskRun: TaskRun = {
      id: runId,
      taskId: task.id!,
      taskName: task.description || undefined,
      tenantId: task.tenantId,
      startedAt: new Date().toISOString(),
      status: 'running',
      chainOfThoughts: [],
      environment,
    };
    
    await this.taskRunRepository.create(taskRun);

    // Set up Redis subscriber if onProgress callback is provided (streaming mode)
    let redisSubscriber: RedisEventSubscriber | undefined;

    // Promise that resolves when we receive a 'done' event (only created when Redis is used)
    let donePromise: Promise<void> | undefined;
    let doneResolve: (() => void) | undefined;
    let doneReject: ((err?: any) => void) | undefined;

    if (onProgress) {
      const redisUrl = process.env.REDIS_URL;
      if (redisUrl) {
        // Use a tenant-scoped channel id to avoid cross-tenant streaming
        const pubsubChannel = `${task.tenantId}:${runId}`;

        // Create subscriber
        redisSubscriber = new RedisEventSubscriber(pubsubChannel, redisUrl);

        // create a promise that will be resolved when we see the 'done' event
        donePromise = new Promise<void>((resolve, reject) => {
          doneResolve = resolve;
          doneReject = reject;
        });

        // Subscribe to Redis events and forward to onProgress callback
        await redisSubscriber.subscribe((event) => {
          onProgress(event.event, event.payload);
          // Resolve the done promise when a 'done' event is observed
          try {
            if (event.event === 'done') {
              doneResolve?.();
            }
          } catch (e) {
            // ignore
          }
        }, (err) => {
          console.error('Redis subscription error:', err);
          try { doneReject?.(err); } catch (e) { /* ignore */ }
        });

        console.log(`📡 Redis subscriber initialized for run: ${pubsubChannel}`);
      } else {
        console.warn('⚠️  REDIS_URL not configured, streaming disabled');
      }
    }

    try {
      // Spawn worker container to execute the task
      console.log(`🚀 Spawning worker container for task ${task.id} (run ${runId})`);
      const workerId = await this.workerOrchestrator.spawnWorker({
        taskId: task.id!,
        runId,
        tenantId: task.tenantId,
        environment,
      });
      
      console.log(`✅ Worker spawned: ${workerId}`);
      
      // Update task run with workerId for cancellation support
      await this.taskRunRepository.update(runId, {
        workerId,
        tenantId: task.tenantId,
      });

      // If we set up a Redis subscriber for progress events, wait until we receive a 'done' event
      if (onProgress && redisSubscriber && donePromise) {
        try {
          await donePromise;

          // Best-effort cleanup of subscriber once done
          try { (redisSubscriber as any).unsubscribe?.(); } catch (e) { /* ignore */ }
          try { (redisSubscriber as any).close?.(); } catch (e) { /* ignore */ }

          return { 
            success: true, 
            runId, 
            workerId,
            message: 'Task execution completed (worker reported done)'
          };
        } catch (err) {
          // If waiting for done failed, return run started but surface error
          console.error('Error while waiting for done event:', err);
          return { success: true, runId, workerId, message: 'Task execution started in worker container (failed waiting for done event)' };
        }
      }
      
      // Return immediately with the runId - execution happens asynchronously in the worker
      // The worker will update the task run status via API when complete
      return { 
        success: true, 
        runId, 
        workerId,
        message: 'Task execution started in worker container'
      };
    } catch (error: any) {
      // Update task run with failure
      await this.taskRunRepository.update(runId, {
        status: 'failed',
        tenantId: task.tenantId,
        completedAt: new Date().toISOString(),
        error: error?.message || 'Failed to spawn worker',
      });

      // if we had a pending done promise, reject it so callers don't hang
      try { doneReject?.(error); } catch (e) { /* ignore */ }
      
      throw error;
    } finally {
      // Note: We don't cleanup the subscriber here since execution is async
      // The subscriber should be cleaned up by the caller when they're done listening
      // or implement a timeout mechanism
    }
  }

  // New: update an existing task with partial updates and return the updated task
  async updateTask(id: string, updates: Partial<TaskResponse>, tenantId: string): Promise<TaskResponse> {
    // Fetch existing task
    const existing = await this.repository.getById(id);
    if (!existing) {
      throw new Error('Task not found');
    }

    const merged: TaskResponse = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    } as TaskResponse;

    await this.repository.update(id, merged);

    // Return task with chat messages
    return (await this.getTaskWithChatMessages(id, tenantId))!;
  }

  // Get all task runs for a specific task
  async getTaskRuns(taskId: string, tenantId: string): Promise<TaskRun[]> {
    return await this.taskRunRepository.getByTaskId(taskId, tenantId);
  }

  // Get all task runs across all tasks
  async getAllTaskRuns(tenantId: string): Promise<TaskRun[]> {
    return await this.taskRunRepository.getAll(tenantId);
  }

  // Get a specific task run by ID
  async getTaskRun(runId: string, tenantId: string): Promise<TaskRun | null> {
    return await this.taskRunRepository.getById(runId, tenantId);
  }

  // Update a task run (used by worker containers)
  async updateTaskRun(runId: string, tenantId: string, updates: Partial<TaskRun>): Promise<void> {
    await this.taskRunRepository.update(runId, { ...updates, tenantId });
  }

  /**
   * Store step-level memories for a task run.
   * This should be called when feedback (positive or negative) is received on a task run.
   * @param runId - The task run ID to store memories for
   * @param tenantId - The tenant ID
   * @param feedback - Optional user feedback text to include in the memory (format: "like: content..." or "dislike: content...")
   */
  async storeStepMemoriesForTaskRun(runId: string, tenantId: string, feedback?: string): Promise<void> {
    try {
      // Get the task run
      const taskRun = await this.taskRunRepository.getById(runId, tenantId);
      if (!taskRun) {
        console.warn(`Task run ${runId} not found, cannot store step memories`);
        return;
      }

      // Only store memories for completed runs
      if (taskRun.status !== 'completed') {
        console.warn(`Task run ${runId} is not completed (status: ${taskRun.status}), skipping step memory storage`);
        return;
      }

      // Get the task to access tools
      const task = await this.repository.getById(taskRun.taskId);
      if (!task) {
        console.warn(`Task ${taskRun.taskId} not found, cannot store step memories`);
        return;
      }

      // Load MCP integrations
      let mcpIntegrations = await this.mcpIntegrationRepository.getAll(tenantId, true);
      if (task.tools && task.tools.length > 0) {
        mcpIntegrations = mcpIntegrations.filter(integration => 
          task.tools!.includes(integration.id)
        );
      }

      // Initialize the memory infrastructure
      const { longTermMemory, apiClient } = await initializePlannedTask({
        usePlanningAssistantMode: false,
        mcpIntegrations,
        customIntegrationRepository: this.customIntegrationRepository,
        tenantId,
        toolsFilter: task.tools
      });

      // Create task step memory
      const taskStepMemory = await createTaskStepMemory(longTermMemory, apiClient);

      // Store the step memories with feedback
      await taskStepMemory.store(taskRun, feedback);
      console.log(`💾 Stored step-level memories for task run ${runId} (${taskRun.taskName || taskRun.taskId})`);
    } catch (error) {
      console.error(`Failed to store step memories for task run ${runId}:`, error);
      // Don't throw - this is a best-effort operation
    }
  }

  // Helper to build feedback-based instructions from task + feedbacks
  private async buildFeedbackInstructions(task: TaskResponse): Promise<string | undefined> {
    try {
      // Prefer in-memory feedbacks if task already loaded with them
      let feedbacks = task.feedbacks;
      if (!feedbacks) {
        feedbacks = await this.feedbackRepository.getByTaskId(task.id!, task.tenantId);
      }
      if (!feedbacks || feedbacks.length === 0) return undefined;

      const parts: string[] = [];
      parts.push('### Feedback summaries for this task');

      for (const fb of feedbacks) {
        const header = fb.rating ? `${fb.rating.toUpperCase()} feedback` : 'Feedback';
        let line = `${header}: "${fb.content}"`;

        // Try to enrich feedback with task run summary when available
        if (fb.taskRunId) {
          try {
            const run = await this.taskRunRepository.getById(fb.taskRunId, task.tenantId);
            if (run) {
              // Extract used tools from chainOfThoughts (robust to different event shapes)
              const toolUses = (run.chainOfThoughts || [])
                .filter(e => e.type === 'toolUse')
                .map(e => {
                  // try multiple places for a tool name
                  return (e as any).name || (e as any).data?.name || (e as any).data?.tool || undefined;
                })
                .filter((v, i, a) => v && a.indexOf(v) === i) as string[];

              // Build a flow based on planStepStart events (ordered)
              const planSteps = (run.chainOfThoughts || [])
                .filter(e => e.type === 'planStepStart' && ((e as any).data))
                .map(e => {
                  const d = (e as any).data || {};
                  return d.name || d.id || (e as any).name || d.step || 'unnamed_step';
                });

              const flow = planSteps.slice(0, 50).join(' -> ');

              if (toolUses.length > 0) {
                line += `; Associated run used tools: ${toolUses.join(', ')}`;
              }

              if (flow) {
                line += `; Flow: ${flow}`;
              }
            }
          } catch (e) {
            // ignore enrichment failures
          }
        }

        parts.push(`- ${line}`);
      }

      parts.push('\nInstructions to the planner:');
      parts.push('- Treat negative/dislike feedback as constraints to avoid when planning and executing.');
      parts.push('- Treat positive/like feedback as preferred patterns; prefer the tools and flows that produced positive results.');

      return `${parts.join('\n')}\n\n`;
    } catch (e) {
      // ignore and return undefined
      return undefined;
    }
  }

  // Helper to prepare a PlannedTask instance enriched with feedback summaries
  private async preparePlannedTask(
    task: TaskResponse,
    usePlanningAssistantMode: boolean,
    mcpIntegrations: any[],
    toolsFilter?: string[],
    highReasoningEffort?: boolean
  ) {
    const extraInstructions = await this.buildFeedbackInstructions(task);
    // delegate to factory, pass feedback repo + taskId + extra instructions so factory can also inject raw feedback if desired
    return await initializePlannedTask({
      usePlanningAssistantMode,
      mcpIntegrations,
      customIntegrationRepository: this.customIntegrationRepository,
      tenantId: task.tenantId,
      toolsFilter,
      extraCustomInstructions: extraInstructions,
      highReasoningEffort
    });
  }

  // Helper to register a running operation (creates or reuses an AbortController entry,
  // attaches progress listeners and wires up a standard abort handler).
  private registerRunningOperation(
    taskId: string,
    plannedTask: any,
    onProgress?: (eventName: string, payload: unknown) => void,
    options?: { markTaskFailedOnAbort?: boolean; task?: TaskResponse }
  ): AbortController {
    let entry = this.runningOperations.get(taskId);
    let controller: AbortController;

    if (entry && entry.controller) {
      controller = entry.controller;
    } else {
      controller = new AbortController();
      this.runningOperations.set(taskId, { controller, plannedTask: undefined, listeners: [] });
      entry = this.runningOperations.get(taskId)!;
    }

    // attach the plannedTask reference and progress listeners
    entry.plannedTask = plannedTask;
    try {
      entry.listeners = attachProgressListeners(plannedTask, onProgress);
    } catch (e) {
      // ignore listener attach failures
    }

    // standard abort handler (safe best-effort attempts)
    const abortHandler = () => {
      try {
        if (options?.markTaskFailedOnAbort && options.task) {
          try { options.task.status = 'failed'; } catch (e) { /* ignore */ }
        }
        try { (plannedTask as any).abort?.(); } catch (e) { /* ignore */ }
        try { (plannedTask as any).cancel?.(); } catch (e) { /* ignore */ }
        try { (plannedTask as any).stop?.(); } catch (e) { /* ignore */ }
        try { (plannedTask as any).events?.emit?.('abort'); } catch (e) { /* ignore */ }
      } catch (e) {
        // ignore
      }
    };

    try {
      // ensure we don't add duplicate listeners if controller already had one
      controller.signal.addEventListener('abort', abortHandler);
    } catch (e) {
      // ignore
    }

    return controller;
  }

  /**
   * Stream task run events via Redis subscriber
   * Returns a cleanup function if streaming was set up, null otherwise
   */
  async streamTaskRunEvents(runId: string, tenantId: string, onProgress?: (eventName: string, data: unknown) => void): Promise<(() => void) | null> {
    const taskRun = await this.taskRunRepository.getById(runId, tenantId);
    if (!taskRun || taskRun.status !== 'running') {
      return null;
    }

    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl || !onProgress) {
      return null;
    }

    // Use tenant-scoped channel
    const pubsubChannel = `${tenantId}:${runId}`;
    const redisSubscriber = new RedisEventSubscriber(pubsubChannel, redisUrl);

    try {
      await redisSubscriber.subscribe((event) => {
        onProgress(event.event, event.payload);
        
        // Close subscriber when done
        if (event.event === 'done') {
          setTimeout(() => {
            redisSubscriber.close().catch(console.error);
          }, 100);
        }
      }, (err) => {
        console.error('Redis subscription error:', err);
        redisSubscriber.close().catch(console.error);
      });

      console.log(`📡 Redis subscriber connected for streaming run: ${pubsubChannel}`);
      
      // Return cleanup function
      return () => {
        redisSubscriber.close().catch(console.error);
      };
    } catch (error) {
      console.error('Failed to subscribe to Redis for task run streaming:', error);
      await redisSubscriber.close();
      return null;
    }
  }
}
