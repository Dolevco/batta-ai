import { ILLMApiHandler, IEmbeddingHandler } from '../../api';
import { TaskPlannerToolProvider } from '../../tools/planner/taskPlannerToolProvider';
import { TaskStepLongTermMemory } from '../../context/memory/longTerm/taskStepMemory';
import { Task } from '../task';
import { TaskConfig, TaskResult } from '../types';
import { Mode } from '../../context/prompts/modes';
import { getFullSystemPrompt } from '../../context/prompts/system';
import { PlanMemory } from './planMemory';
import { 
  StoredPlan, 
  PlanResult, 
  PlannerConfig 
} from './types';
import { ToolResult } from '../../tools';

export interface PlannedTaskConfig extends TaskConfig {
  /** Planner configuration */
  planner?: PlannerConfig;
  /** Task step memory for learning from past step executions */
  taskStepMemory?: TaskStepLongTermMemory;
}

/**
 * Task that plans and executes complex tasks by breaking them into sub-tasks.
 * 
 * Uses:
 * - list_tool_details: to discover available tools
 * - delegate_task: to execute sub-tasks via sub-agents
 * - PlanMemory: to cache and reuse plans for similar tasks
 * 
 * Extends Task to leverage the existing execution loop.
 */
export class PlannedTask extends Task {
  private readonly toolProvider: TaskPlannerToolProvider;
  private readonly planMemory: PlanMemory;
  private readonly plannerConfig: Required<PlannerConfig>;
  private currentPlan: ToolResult | undefined;

  constructor(
    api: ILLMApiHandler,
    config: PlannedTaskConfig,
    planMemory: PlanMemory,
    embeddingHandler?: IEmbeddingHandler
  ) {
    const tools = config.tools || [];
    const maxIterations = config.maxSubAgentIterations ?? 10;
    const maxSubTasks = config.planner?.maxSubTasks ?? 10;

    // Create tool provider with all available tools
    const toolProvider = new TaskPlannerToolProvider(
      tools, 
      api, 
      planMemory, 
      maxIterations, 
      maxSubTasks,
      config.codeIntegrationProvider,
      config.taskStepMemory
    );

    // Planner uses: list_tool_details, generate_plan, execute_plan, task_complete
    const plannerTools = toolProvider.getPlannerTools(true);

    // Build prompt before super() and pass via the internal _systemPrompt field.
    const systemPrompt = buildPlannerSystemPrompt(
      toolProvider,
      config.mode,
      config.customInstructions,
      config.workspace
    );

    // Call parent constructor — buildSystemPrompt() is called inside super() via the hook.
    // We must set this.toolProvider AFTER super(), so we pass a temporary provider reference
    // through a closure captured in buildSystemPrompt (see override below).
    super(api, {
      ...config,
      _systemPrompt: systemPrompt,
      tools: plannerTools,
    }, embeddingHandler);

    this.toolProvider = toolProvider;
    this.planMemory = planMemory;
    this.plannerConfig = {
      temperature: config.planner?.temperature ?? 0,
      similarityThreshold: config.planner?.similarityThreshold ?? 0.85,
      maxSubTasks: config.planner?.maxSubTasks ?? 10,
    };
  }

  /*protected isTaskCompleted(toolResult: ToolResult, tool: Tool | undefined): boolean {
    if (super.isTaskCompleted(toolResult, tool)) {
      return true;
    }

    if (tool?.name == "generate_plan" && toolResult.success) {
      this.currentPlan = toolResult;
    }
    if (tool?.name === ValidatePlanToolName && !!toolResult?.success) {
      toolResult = this.currentPlan ?? toolResult;
      return true;
    }

    return false;
  }*/

  /*protected getTaskCompletionResult<T>(toolResult: ToolResult, tool: Tool | undefined): TaskResult<T> {
    if (tool?.name === ValidatePlanToolName) {
      toolResult = this.currentPlan ?? toolResult;
    }

    return {
      success: toolResult.success,
      completed: true,
      summary: toolResult.message,
      result: toolResult.result
    };
  }*/

  /**
   * Execute a task with optional plan caching.
   * 
   * If a similar plan exists in memory, it will be reused.
   * Otherwise, the task runs normally and can create its own plan.
   */
  async executeWithPlanCache(taskDescription: string): Promise<PlanResult> {
    // Try to find existing similar plan
    const existingPlan = await this.planMemory.findSimilarPlan(
      taskDescription,
      this.plannerConfig.similarityThreshold
    );

    if (existingPlan) {
      console.log('PlannedTask: Reusing cached plan');
      return await this.executePlan(existingPlan);
    }

    // No cached plan - execute normally via Task.execute()
    // The task will use delegate_task to break down and execute
    const result = await this.execute(taskDescription);
    
    return {
      success: result.success,
      results: [{
        index: 0,
        success: result.success,
        result: result.summary,
      }],
    };
  }

  /**
   * Generate a plan using the Task execution loop.
   * 
   * Creates a dedicated planning Task that uses list_tool_details and generate_plan
   * tools to create a validated plan.
   */
  async generatePlan(taskDescription: string): Promise<TaskResult<StoredPlan>> {
    // Check for cached plan first
   /* const existingPlan = await this.planMemory.findSimilarPlan(
      taskDescription,
      this.plannerConfig.similarityThreshold
    );

    if (existingPlan) {
      console.log('PlannedTask: Reusing cached plan');
      return { result: existingPlan, success: true, summary: 'Reusing cached plan', completed: true };
    }*/

    const result = await this.execute<StoredPlan>(taskDescription);
    if (result.completed) {
      return result;
    }

    // interaction response
    return { ...result, result: {
      task: taskDescription,
      description: '',
      message: result.summary,
      subTasks: [],
      createdAt: Date.now().toString()
    }};
  }

  /**
   * Execute a plan using the execute_plan tool.
   */
  async executePlan(plan: StoredPlan, context?: string): Promise<PlanResult> {
    const executePlanTool = this.toolProvider.getExecutePlanTool();
    // Pass the shared events emitter from this PlannedTask so any sub-task can reuse it
    const result = await executePlanTool.execute({ plan, context, events: this.events });

    if (result.success && result.result) {
      return result.result as PlanResult;
    }

    return {
      success: false,
      results: [],
      error: result.error ?? 'Plan execution failed',
    };
  }
}

/**
 * Build system prompt with planning guidance.
 */
function buildPlannerSystemPrompt(
  provider: TaskPlannerToolProvider,
  mode?: Mode,
  customInstructions?: string,
  workspace?: string
): string {
  const toolsSection = provider.generateToolsPromptSection();

  const fullCustomInstructions = customInstructions
    ? `${customInstructions}\n\n${toolsSection}`
    : toolsSection;

  return getFullSystemPrompt(
    provider.getPlannerTools(true),
    mode,
    fullCustomInstructions,
    workspace
  );
}
