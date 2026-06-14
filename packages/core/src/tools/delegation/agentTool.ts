import { BaseTool } from '../baseTool';
import { ToolCategory, ToolParameter, ToolResult } from '../types';
import { AgentDefinition, Message } from '../../task/types';
import { AgentRegistry } from '../../task/agentRegistry';
import { ISubAgentExecutor, SubAgentRequest, DelegationLimits } from './types';
import { Tool } from '../types';
import { TypedEventEmitter } from '../../task/eventEmitter';
import { TaskEventMap } from '../../task/types';

// Boilerplate tag injected into fork-child context
export const FORK_BOILERPLATE_TAG = 'fork-child-context';

export const AgentToolName = 'agent';

export const AgentToolCategory: ToolCategory = {
  name: 'agent',
  description: 'Launch specialized sub-agents to handle complex multi-step tasks autonomously',
  keywords: ['agent', 'sub-agent', 'spawn', 'fork', 'delegate']
};

export interface AgentToolParams extends Record<string, unknown> {
  /** 3-5 word description of what the agent will do (shown to the user) */
  description: string;
  /** The full task prompt for the agent to perform */
  prompt: string;
  /**
   * Optional agent type key from the agent registry.
   * If omitted, the general-purpose agent is used.
   */
  subagent_type?: string;
  /**
   * When true the sub-agent inherits the caller's full conversation history.
   * Use for research/exploration where prior context is essential.
   */
  fork?: boolean;
  /** Expected output. Helps the sub-agent know what "done" looks like. */
  expectedOutput?: string;
  /** Anticipated number of execution steps — used to cap sub-task iterations */
  anticipatedSteps?: number;
  /** Optional code integration ID for git-backed coding tasks */
  codeIntegrationId?: string;
  /** Required structured outputs: map of key → description */
  requiredOutputs?: Record<string, string>;
  /** Required inputs from prior steps: map of key → value */
  requiredInputs?: Record<string, string>;
  /** Shared event emitter for progress forwarding */
  events?: TypedEventEmitter<TaskEventMap>;
  /**
   * Parent conversation history — automatically injected when fork=true.
   * Do NOT set this manually; the Task layer populates it.
   */
  parentHistory?: Message[];
  /**
   * Current spawn depth, automatically threaded by the executor.
   * Do NOT set this manually; the executor increments and forwards it.
   */
  depth?: number;
  /**
   * Workspace path inherited from the parent task.
   * Automatically injected by Task.executeTool() so the sub-agent's file tools
   * resolve paths against the same working directory as the parent.
   * Do NOT set this manually.
   */
  workspace?: string;
}

/**
 * AgentTool: spawns a sub-agent to handle a complex task autonomously.
 *
 * Replaces the `delegate_task` concept from DelegatingTask. The parent agent
 * now calls tools DIRECTLY for simple operations, and uses `agent` for complex
 * multi-step work that benefits from isolation or specialization.
 *
 * Two spawn modes :
 *
 * 1. Fresh agent (default): starts with zero context; receives full prompt.
 *    Use for: tool-heavy operations, code changes, independent research.
 *
 * 2. Fork (fork=true): inherits parent's full conversation history.
 *    Use for: research/exploration where parent context saves re-discovery.
 *
 * Progress tracking — forwards subAgentProgress events from the sub-task.
 * Agent registry — looks up AgentDefinition to scope tools/memory.
 *
 * Security note:
 *   - tool names and agent types are validated before execution
 *   - parent history is only forwarded when fork=true (explicit opt-in)
 *   - tool execution permissions are enforced by the agent's AgentDefinition allowlist
 */
export class AgentTool extends BaseTool<AgentToolParams> {
  readonly name = AgentToolName;
  readonly category = AgentToolCategory;
  readonly isConcurrencySafe = false; // sub-agents may have side effects — always sequential
  readonly whenToUse =
    'Use for complex multi-step tasks that benefit from isolation or specialization. ' +
    'For simple operations (read a file, search for text) call tools directly instead. ' +
    'Specify subagent_type for specialised behaviour; use fork=true to share your context. ' +
    'Always send as a single JSON object — never batch with other tools in an array.';

  readonly description: string;
  readonly parameters: ToolParameter[];

  constructor(
    private readonly executor: ISubAgentExecutor,
    private readonly availableTools: Tool[],
    private readonly agentRegistry?: AgentRegistry
  ) {
    super();

    const agentListing = agentRegistry ? this.buildAgentListing(agentRegistry) : '';

    this.description =
      `Launch a new agent to handle complex, multi-step tasks autonomously.\n\n` +
      `Each agent type has specific capabilities and tools available to it.\n` +
      (agentListing ? `\n${agentListing}\n` : '') +
      `\nWhen using the agent tool, specify a subagent_type to use a specialised agent, ` +
      `or omit it to use the general-purpose agent. ` +
      `Set fork=true to give the agent your full conversation history (cheaper than re-explaining; ` +
      `ideal for research tasks).`;

    this.parameters = [
      {
        name: 'description',
        description: 'A short (3-5 word) description of the task, shown to the user.',
        required: true,
        type: 'string'
      },
      {
        name: 'prompt',
        description:
          'The complete task for the agent. Brief the agent like a smart colleague who has zero context: ' +
          'explain what to accomplish, what you already know, exact file paths / IDs, ' +
          'and what "done" looks like. Terse command-style prompts produce shallow results.',
        required: true,
        type: 'string'
      },
      {
        name: 'subagent_type',
        description:
          'Optional. The type of specialised agent to use (e.g. "code-reviewer", "explore", "planner"). ' +
          'Omit to use the general-purpose agent. Available types are listed in the tool description.',
        required: false,
        type: 'string'
      },
      {
        name: 'fork',
        description:
          'Optional. Set to true to fork yourself: the sub-agent inherits your full conversation history ' +
          'and shares your prompt cache. Ideal for research/exploration tasks where re-discovering context ' +
          'would be wasteful. Default: false (fresh agent with no prior context).',
        required: false,
        type: 'boolean'
      },
      {
        name: 'expectedOutput',
        description:
          'Optional. Describe what the result should look like when the task is complete. ' +
          'Be specific — include format, structure, and what data must be present.',
        required: false,
        type: 'string'
      },
      {
        name: 'anticipatedSteps',
        description: `Optional. Estimated number of tool calls needed (1-${DelegationLimits.MAX_ANTICIPATED_STEPS}). Used to set a sensible iteration cap.`,
        required: false,
        type: 'number'
      },
      {
        name: 'codeIntegrationId',
        description: 'Optional. Code integration ID for git-backed coding tasks that need a cloned repo.',
        required: false,
        type: 'string'
      },
      {
        name: 'requiredOutputs',
        description: 'Optional. Map of output keys → descriptions that the agent MUST include in its result.',
        required: false,
        type: 'object'
      },
      {
        name: 'requiredInputs',
        description: 'Optional. Map of input keys → values from previous steps passed to the agent.',
        required: false,
        type: 'object'
      }
    ];
  }

  async execute(params: AgentToolParams): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      const {
        prompt,
        subagent_type,
        fork = false,
        expectedOutput,
        anticipatedSteps,
        codeIntegrationId,
        requiredOutputs,
        requiredInputs,
        events,
        parentHistory,
        depth,
        workspace
      } = params;

      if (!prompt || prompt.trim().length === 0) {
        return { success: false, message: 'prompt is required and must not be empty' };
      }

      // Fork recursion guard: a fork child must not spawn further forks.
      // Detected by checking whether FORK_BOILERPLATE_TAG appears in parent history
      if (fork && parentHistory) {
        const isAlreadyForkChild = parentHistory.some(
          m => typeof m.content === 'string' && m.content.includes(`<${FORK_BOILERPLATE_TAG}>`)
        );
        if (isAlreadyForkChild) {
          return {
            success: false,
            message: 'Fork is not available inside a forked worker. Complete your task directly using your tools.'
          };
        }
      }

      // Hard depth guard at the tool level — secondary defense besides the executor-level guard.
      const currentDepth = depth ?? 0;
      if (currentDepth >= DelegationLimits.MAX_AGENT_DEPTH) {
        return {
          success: false,
          message: `Cannot spawn sub-agent: maximum nesting depth (${DelegationLimits.MAX_AGENT_DEPTH}) reached. ` +
                   `Use your available tools directly to complete this task.`
        };
      }

      // Resolve tool set: if subagent_type is given, apply agent definition allowlist/denylist
      const agentDef = subagent_type ? this.agentRegistry?.get(subagent_type) : undefined;
      const toolsForAgent = this.resolveToolsForAgent(agentDef);

      const request: SubAgentRequest = {
        intent: prompt,
        context: prompt, // for fresh agents the prompt is the full context
        expectedOutput: expectedOutput ?? 'Complete the task as described in the prompt.',
        tools: toolsForAgent,
        taskType: fork ? 'fork' : 'normal',
        anticipatedSteps: Math.max(anticipatedSteps ?? 0, 5),
        events,
        dependencyResults: requiredInputs,
        codeIntegrationId,
        requiredOutputs,
        agentType: subagent_type,
        parentHistory: fork ? parentHistory : undefined,
        depth: currentDepth,
        workspace
      };

      const result = await this.executor.execute(request);

      return {
        success: result.success,
        result: result.result,
        message: result.success
          ? result.result
          : `Agent failed: ${result.error}`,
        error: result.error,
        requiredOutput: result.requiredOutput
      };
    });
  }

  /**
   * Resolve the effective tool list for a sub-agent, applying agent definition
   * allowlist and denylist if an agent definition is provided.
   */
  private resolveToolsForAgent(agentDef?: AgentDefinition): Tool[] {
    if (!agentDef) return [...this.availableTools];

    let tools = [...this.availableTools];

    // Apply allowlist (tools array means "only these")
    if (agentDef.tools && agentDef.tools.length > 0) {
      const allowed = new Set(agentDef.tools);
      tools = tools.filter(t => allowed.has(t.name));
    }

    // Apply denylist
    if (agentDef.disallowedTools && agentDef.disallowedTools.length > 0) {
      const denied = new Set(agentDef.disallowedTools);
      tools = tools.filter(t => !denied.has(t.name));
    }

    return tools;
  }

  /**
   * Build a human-readable agent listing for injection into the tool description.
   */
  private buildAgentListing(registry: AgentRegistry): string {
    const agents = registry.getAll();
    if (agents.length === 0) return '';

    const lines = ['Available agent types and the tools they have access to:'];
    for (const def of agents) {
      let toolsDesc = 'All tools';
      if (def.tools && def.tools.length > 0) {
        toolsDesc = def.tools.join(', ');
      } else if (def.disallowedTools && def.disallowedTools.length > 0) {
        toolsDesc = `All tools except ${def.disallowedTools.join(', ')}`;
      }
      lines.push(`- ${def.agentType}: ${def.whenToUse} (Tools: ${toolsDesc})`);
    }
    return lines.join('\n');
  }
}
