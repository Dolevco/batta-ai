import { Tool, ToolCategory } from "../types";
import { TypedEventEmitter } from '../../task/eventEmitter';
import { Message, TaskEventMap } from '../../task/types';

/**
 * Special code integration ID that signals dynamic repository selection.
 * When used, the repository name should be provided in a dependency's metadata.
 */
export const DYNAMIC_CODE_INTEGRATION = 'dynamic';

/**
 * Delegation constraints to keep sub-tasks focused and efficient.
 */
export const DelegationLimits = {
  /** Maximum number of tools a sub-task can use */
  MAX_TOOLS_PER_SUBTASK: 15,//7,
  /** Maximum anticipated steps for a sub-task (used for validation guidance) */
  MAX_ANTICIPATED_STEPS: 20,
  /**
   * Maximum nesting depth for sub-agent spawning.
   * Depth 0 = root task, depth 1 = first-level sub-agent, etc.
   * Sub-agents at this depth do NOT receive the `agent` tool, preventing infinite recursion.
   */
  MAX_AGENT_DEPTH: 3
} as const;

export const DelegationCategory: ToolCategory = {
  name: 'delegation',
  description: 'Delegate tasks to sub-agents',
  keywords: ['delegate', 'sub-agent', 'execute']
};

export interface DelegateToolParams extends Record<string, unknown> {
  id: string;
  name: string;
  tools: string[];
  toolsCategories?: string[];
  taskType?: string;
  intent: string;
  context: string;
  expectedOutput: string;
  /** Anticipated number of steps (1-5). Helps validate task scope. */
  anticipatedSteps?: number;
  /** Optional shared events emitter to propagate to sub-agents */
  events?: TypedEventEmitter<TaskEventMap>;
  /** Optional code integration ID for coding tasks */
  codeIntegrationId?: string;
  /** Required outputs that must be provided in metadata for dependent steps. Map of key->description. */
  requiredOutputs?: Record<string, string>;
  /** Required inputs that this sub-task expects from its dependencies. Map of key->description. May be empty. */
  requiredInputs?: Record<string, string>;
}

/** Request to execute tools via sub-agent */
export interface SubAgentRequest {
  intent: string;
  context: string;
  expectedOutput: string;
  tools: Tool[];
  taskType?: string;
  /** Anticipated number of steps for this sub-task */
  anticipatedSteps?: number;
  /** Optional shared events emitter */
  events?: TypedEventEmitter<TaskEventMap>;
  /** Results from dependent tasks (indexed by task ID or index) */
  dependencyResults?: Record<string, string>;
  /** Optional code integration ID for coding tasks */
  codeIntegrationId?: string;
  /** Required outputs that must be provided in metadata for dependent steps. Map of key->description. */
  requiredOutputs?: Record<string, string>;
  /**
   * Optional agent type key for registry lookup.
   */
  agentType?: string;
  /**
   * Parent conversation history for fork sub-agents.
   * When taskType === 'fork', the sub-task is seeded with this history to inherit parent context.
   */
  parentHistory?: Message[];
  /**
   * Current nesting depth of this sub-agent spawn (0 = root, 1 = first child, etc.).
   * Passed through the call chain and incremented at each level.
   * When depth >= DelegationLimits.MAX_AGENT_DEPTH the `agent` tool is withheld,
   * preventing infinite recursive spawning.
   */
  depth?: number;
  /**
   * Workspace path inherited from the parent task.
   * Injected into the sub-agent's system prompt so file tools resolve paths correctly.
   * When a codeIntegrationId is also provided the workspace is overridden by the
   * code-integration config; otherwise this value is used as-is.
   */
  workspace?: string;
}

/** Result from sub-agent execution */
export interface SubAgentResult {
  success: boolean;
  result: string;
  summary?: string;
  error?: string;
  /** Optional structured metadata to pass to dependent tasks */
  requiredOutput?: {
    repositoryName?: string;
    [key: string]: unknown;
  };
}

/** Interface for sub-agent executors */
export interface ISubAgentExecutor {
  execute(request: SubAgentRequest): Promise<SubAgentResult>;
}
