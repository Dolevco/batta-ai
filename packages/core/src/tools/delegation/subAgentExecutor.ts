import { ILLMApiHandler } from "../../llm";
import { MODES } from "../../context/prompts/modes";
import { TaskStepLongTermMemory } from "../../context/memory/longTerm/taskStepMemory";
import { Task } from "../../task/task";
import { TaskResult, Message } from "../../task/types";
import { AgentDefinition } from "../../task/types";
import { AgentRegistry } from "../../task/agentRegistry";
import { PlannedTaskCompletionTool } from "../task";
import { TaskCompletionCategory, TaskCompletionTool } from "../task/taskCompletionTool";
import { Tool } from "../types";
import { DelegationLimits, ISubAgentExecutor, SubAgentRequest, SubAgentResult } from "./types";
import { CodeIntegrationProvider, CodeIntegrationConfig } from "./codeIntegrationProvider";

// Instruction injected into sub-agents that are at or beyond MAX_AGENT_DEPTH.
const NO_SPAWN_INSTRUCTION =
  '\n\n## Sub-agent spawning disabled\n\n' +
  'You are running at the maximum allowed nesting depth. ' +
  'You CANNOT spawn further sub-agents — the `agent` tool is not available to you. ' +
  'Complete your task using only the tools listed above. ' +
  'Do NOT request or reference the `agent` tool; doing so will cause an error.';

/**
 * Sub-agent executor that creates a Task to execute tools.
 *
 * Fork Sub-Agent — when taskType === 'fork', seeds the sub-task with the parent's
 * conversation history so it starts with inherited context (cheaper than re-summarising).
 *
 * Agent Registry — looks up AgentDefinition to scope tools and memory.
 */
export class SubAgentExecutor implements ISubAgentExecutor {
  constructor(
    private readonly api: ILLMApiHandler,
    private readonly maxIterations: number,
    private readonly codeIntegrationProvider?: CodeIntegrationProvider,
    private readonly taskStepMemory?: TaskStepLongTermMemory,
    /** Optional agent registry for typed agent definitions */
    private readonly agentRegistry?: AgentRegistry
  ) {}

  async execute(request: SubAgentRequest): Promise<SubAgentResult> {
    const { intent, context, expectedOutput, tools, anticipatedSteps, events, taskType, dependencyResults, codeIntegrationId, requiredOutputs } = request;

    // Depth tracking: increment depth from parent; default 0 for root-level spawns.
    const currentDepth = (request.depth ?? 0) + 1;
    const atDepthLimit = currentDepth >= DelegationLimits.MAX_AGENT_DEPTH;

    if (currentDepth > DelegationLimits.MAX_AGENT_DEPTH) {
      // Hard guard: should not reach here because ensureBuiltinTools won't inject the
      // agent tool at MAX_AGENT_DEPTH, but defend in depth anyway.
      return {
        success: false,
        result: '',
        error: `Sub-agent spawn rejected: maximum nesting depth (${DelegationLimits.MAX_AGENT_DEPTH}) exceeded. ` +
               `Agent at depth ${currentDepth - 1} attempted to spawn a child. `
      };
    }
    
    // Search for relevant past executions if task run memory is available
    let memoryContext = '';
    
    // Search for relevant step-level memories if task step memory is available
    if (this.taskStepMemory) {
      try {
        const relevantStepMemories = await this.taskStepMemory.search(intent, 2);
        if (relevantStepMemories.length > 0) {
          events?.emit('stepMemoryRetrieved', { insights: relevantStepMemories[0].insights });
          memoryContext += '\n\n## Past Step-Level Learnings\n\n' + 
            this.taskStepMemory.formatAsContext(relevantStepMemories) + 
            '\n\nApply these step-specific insights when planning and executing similar steps.\nIMPORTANT: Do not assume its completing your task. learn the relevant lessons to complete your task and provide evidence that you complete it.';
          console.log(`📚 Found ${relevantStepMemories.length} relevant step memories for: ${intent.substring(0, 50)}...`);
        }
      } catch (error) {
        console.warn('Failed to retrieve task step memories:', error);
        // Continue without step memories if retrieval fails
      }
    }

    // Resolve agent definition from registry (if available)
    const agentDef = this.resolveAgentDefinition(request);
    
    // Load git tools if code integration ID is provided
    let effectiveTools = [...tools];
    let workspace = request.workspace; // inherit from parent task by default
    let codeIntegrationConfig: CodeIntegrationConfig | undefined = undefined;
    if (codeIntegrationId && this.codeIntegrationProvider) {
      codeIntegrationConfig = await this.codeIntegrationProvider.getConfig(codeIntegrationId);
      workspace = codeIntegrationConfig.workspacePath; // override with code-integration workspace
      // Add or replace code-integration tools by name
      const nameToIndex = new Map<string, number>();
      effectiveTools.forEach((t, i) => nameToIndex.set(t.name, i));
      for (const tool of codeIntegrationConfig.tools) {
        if (nameToIndex.has(tool.name)) {
          effectiveTools[nameToIndex.get(tool.name)!] = tool;
        } else {
          nameToIndex.set(tool.name, effectiveTools.length);
          effectiveTools.push(tool);
        }
      }
      console.log(`✅ Loaded ${codeIntegrationConfig.tools.length} tools for code integration: ${codeIntegrationConfig.name}`);
    }

    // filter tools by agent definition allowlist / denylist
    if (agentDef) {
      effectiveTools = this.filterToolsByDefinition(effectiveTools, agentDef);
    }

    // Ensure completion tool is available - use PlannedTaskCompletionTool if requiredOutputs specified
    const hasCompletionTool = effectiveTools.some(tool => tool.category.name === TaskCompletionCategory.name);
    if (!hasCompletionTool) {
      const completionTool = requiredOutputs && Object.keys(requiredOutputs).length > 0
        ? new PlannedTaskCompletionTool(requiredOutputs)
        : new TaskCompletionTool();
      effectiveTools = [completionTool, ...effectiveTools];
    }

    const agentCustomInstructions = agentDef?.customInstructions;
    const customInstructions = this.buildSubAgentPrompt(expectedOutput, requiredOutputs, anticipatedSteps, codeIntegrationConfig, memoryContext, agentCustomInstructions);

    // Use anticipated steps to set a reasonable iteration limit
    // Add buffer for retries, but cap at configured max
    const agentMaxIterations = agentDef?.maxIterations;
    const effectiveMaxIterations = agentMaxIterations ?? Math.max(
      (anticipatedSteps ?? DelegationLimits.MAX_ANTICIPATED_STEPS) * 2,
      this.maxIterations
    );

    // Fork sub-agent — inherit parent conversation history
    const parentHistory: Message[] | undefined = taskType === 'fork' ? request.parentHistory : undefined;

    // Depth guard: withhold the agentExecutor (and thus the `agent` tool) when
    // the sub-agent is at or beyond the maximum allowed nesting depth.
    //
    // How this prevents infinite spawning:
    //   - SubAgentExecutor passes `agentExecutor: this` only when depth < MAX_AGENT_DEPTH.
    //   - Task.ensureBuiltinTools() injects AgentTool only when agentExecutor is present.
    //   - Therefore sub-agents at MAX_AGENT_DEPTH never see the `agent` tool in their
    //     tool list and cannot spawn further children.
    //
    // The sub-agent's custom instructions are also patched with an explicit notice so the
    // model understands why the tool is absent and doesn't hallucinate calls to it.
    const canSpawnChildren = !atDepthLimit;
    const effectiveCustomInstructions = atDepthLimit
      ? customInstructions + NO_SPAWN_INSTRUCTION
      : customInstructions;

    // Build executor for child agent so it propagates the incremented depth onward.
    // When at the depth limit this is undefined, so Task won't inject the agent tool.
    const childExecutor = canSpawnChildren
      ? new DepthAwareSubAgentExecutor(
          this.api,
          this.maxIterations,
          currentDepth,
          this.codeIntegrationProvider,
          this.taskStepMemory,
          this.agentRegistry
        )
      : undefined;

    // Create a Task for the sub-agent with maxIterations configured
    let subTask: Task;
    subTask = new Task(this.api, {
      mode: MODES.DELEGATED_TASK,
      customInstructions: effectiveCustomInstructions,
      workspace,
      tools: effectiveTools,
      memory: { maxMessages: effectiveMaxIterations * 2 },
      maxIterations: effectiveMaxIterations,
      events,
      // Only provide agentExecutor (which enables the `agent` tool injection) when
      // the current depth is below the cap. Passing undefined prevents Task from
      // injecting AgentTool, which is the primary recursion guard.
      agentExecutor: childExecutor,
      agentRegistry: this.agentRegistry,
      // seed history from parent for fork mode
      conversationHistory: parentHistory
    });

    try {
      return await this.runToCompletion(subTask, intent, context, dependencyResults);
    } catch (error) {
      return {
        success: false,
        result: '',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Resolve the best AgentDefinition for this request.
   * Falls back to the default (general) agent if no match found.
   */
  private resolveAgentDefinition(request: SubAgentRequest): AgentDefinition | undefined {
    if (!this.agentRegistry) return undefined;
    const agentType = (request as any).agentType as string | undefined;
    if (agentType) {
      return this.agentRegistry.get(agentType) ?? this.agentRegistry.getDefault();
    }
    return undefined;
  }

  /**
   * Filter the effective tool list by the agent definition's allowlist/denylist.
   * - If definition.tools is set, only those tool names are kept (plus completion tool).
   * - If definition.disallowedTools is set, those names are removed.
   */
  private filterToolsByDefinition(tools: Tool[], def: AgentDefinition): Tool[] {
    let filtered = tools;
    if (def.tools && def.tools.length > 0) {
      const allowed = new Set(def.tools);
      filtered = filtered.filter(t => allowed.has(t.name) || t.category.name === TaskCompletionCategory.name);
    }
    if (def.disallowedTools && def.disallowedTools.length > 0) {
      const denied = new Set(def.disallowedTools);
      filtered = filtered.filter(t => !denied.has(t.name));
    }
    return filtered;
  }

  private async runToCompletion(
    task: Task,
    intent: string,
    context: string,
    dependencyResults?: Record<string, string>
  ): Promise<SubAgentResult> {
    // Build message with dependency context if available
    let message = `context:${context}\n\nour goal (you SHOULD work on this only, do not do anything less or more):\n ${intent}`;
    if (dependencyResults && Object.keys(dependencyResults).length > 0) {
      const depsContext = Object.entries(dependencyResults)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n\n');
      message += `\n\n## Results from Previous Steps:\n\n${depsContext}`;
    }

    const result: TaskResult = await task.execute(message);
    return { 
      success: result.success, 
      summary: result.summary, 
      result: result.result as any || '',
      requiredOutput: result.requiredOutput
    };
  }

  private buildSubAgentPrompt(
    expectedOutput: string, 
    requiredOutputs?: Record<string,string>, 
    anticipatedSteps?: number, 
    codeIntegrationConfig?: CodeIntegrationConfig,
    memoryContext?: string,
    agentCustomInstructions?: string
  ): string {
    const stepsGuidance = anticipatedSteps 
      ? `\n## Execution Guidance\n\nThis task should be completed in the minumum step possible and must be less then ${anticipatedSteps} steps. Stay focused and efficient.`
      : '';
    const req = requiredOutputs && Object.keys(requiredOutputs).length > 0
      ? '\n\nREQUIRED OUTPUT:\n' + Object.entries(requiredOutputs).map(([k,v]) => `- ${k}: ${v}`).join('\n')
      : '';
    const codeSection = codeIntegrationConfig
      ? `### Existing Code Integration Config\n\nThe code is cloned and ready on a fix branch. you don't need to clone or create any branch. details: Repository: ${codeIntegrationConfig.repoName ?? codeIntegrationConfig.name}\nWorkspace path: / \nMain branch: ${codeIntegrationConfig.mainBranch ?? 'unknown'}\nCurrent branch: ${codeIntegrationConfig.currentBranch ?? 'unknown'}\n`
      : '';
    const memorySection = memoryContext || '';
    const agentSection = agentCustomInstructions ? `\n## Agent Instructions\n\n${agentCustomInstructions}\n` : '';
    
    return `${codeSection}${memorySection}${agentSection}\n\n## Expected Output\n\n${expectedOutput}${req}${requiredOutputs && Object.keys(requiredOutputs).length > 0 ? '\n\nNOTE: Do not fabricate, mock, or guess required output. If accurate details are unavailable, fail the task instead of making them up.' : ''}\n\nIMPORTANT: Produce a self-contained, fully detailed result that another agent can use without prior context. Include all required data, exact values, formats, commands, file paths, examples, and any assumptions or decisions made. Do not omit requested details. Structure the output clearly (use sections or machine-readable blocks) so the next agent can act immediately.\n\n${stepsGuidance}`;
  }
}

/**
 * A SubAgentExecutor that carries a fixed spawn depth and forwards it to each request.
 *
 * When a parent Task creates a child Task via SubAgentExecutor.execute(), it wraps the
 * executor in a DepthAwareSubAgentExecutor so that every subsequent spawn by the child
 * automatically gets `depth = parentDepth + 1`.  Once depth reaches MAX_AGENT_DEPTH the
 * executor is replaced by `undefined` in the child Task, which prevents Task.ensureBuiltinTools()
 * from injecting AgentTool — the primary infinite-recursion guard.
 *
 * Design note: We prefer an explicit integer depth counter over the message-scan approach
 * because it is O(1), covers non-fork paths, and is unambiguous across summarization / compaction
 * that could strip the boilerplate tag from conversation history.
 */
class DepthAwareSubAgentExecutor extends SubAgentExecutor {
  constructor(
    api: ILLMApiHandler,
    maxIterations: number,
    /** The depth at which THIS executor operates (i.e. the child's depth). */
    private readonly spawnDepth: number,
    codeIntegrationProvider?: CodeIntegrationProvider,
    taskStepMemory?: TaskStepLongTermMemory,
    agentRegistry?: AgentRegistry
  ) {
    super(api, maxIterations, codeIntegrationProvider, taskStepMemory, agentRegistry);
  }

  override async execute(request: SubAgentRequest): Promise<SubAgentResult> {
    // Forward the accumulated depth so the recursive guard in execute() fires correctly.
    return super.execute({ ...request, depth: this.spawnDepth });
  }
}