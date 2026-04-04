import { Tool, ToolResult, ToolUse } from "../tools/types";
import { LongTermMemoryConfig } from "../context/memory/types";
import { TypedEventEmitter } from './eventEmitter';

// Core Types
export type Role = 'system' | 'user' | 'assistant';
export type ContentType = 'text' | 'tool_use' | 'tool_result';

// Message Types
export interface Message {
  role: Role;
  content: string;
}

/**
 * Extended memory config with token-aware compaction support.
 */
export interface MemoryConfig {
  maxMessages?: number;
  summarizationEnabled?: boolean;
  summarizationTrigger?: number;
  summarizationPrompt?: string;
  summarizationDisabled?: boolean;
  /**
   * Token threshold that triggers compaction (default: 80_000).
   * When estimated tokens exceed this, summarization is triggered regardless of message count.
   */
  maxTokens?: number;
  /**
   * Characters per token estimate for rough token counting (default: 4).
   */
  tokenEstimateCharsPerToken?: number;
  /**
   * Always preserve this many most-recent messages after compaction (default: 4).
   */
  preserveLastNMessages?: number;
}

/**
 * Activity record for a single tool invocation.
 */
export interface ToolActivity {
  toolName: string;
  parameters: Record<string, unknown>;
  /** Human-readable description, e.g. "Reading src/foo.ts" */
  activityDescription?: string;
  timestamp: number;
}

/**
 * Sub-agent progress tracking.
 */
export interface SubAgentProgress {
  subTaskIndex: number;
  subTaskName: string;
  toolUseCount: number;
  estimatedTokens: number;
  lastActivity?: ToolActivity;
  recentActivities: ToolActivity[];
}

export interface TaskResult<T = unknown> {
  success: boolean;
  completed: boolean;
  summary: string;
  result?: T;
  /** Optional structured metadata to pass to dependent tasks */
  requiredOutput?: {
    repositoryName?: string;
    [key: string]: unknown;
  };
}

/**
 * Agent definition for typed sub-agents with scoped memory.
 */
export interface AgentDefinition {
  agentType: string;
  description: string;
  whenToUse: string;
  /** Tool allowlist by name; undefined = all tools from the parent */
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  maxIterations?: number;
  memory?: {
    scope: 'session' | 'project' | 'global';
    /** Optional collection name override for long-term memory */
    collectionName?: string;
  };
  systemPromptTemplate?: string;
  customInstructions?: string;
}

// Task Types
export interface TaskConfig {
  tools?: Tool[];
  /**
   * Mode that controls the agent's persona and behaviour (default: MODES.DELEGATING_TASK).
   * The Task always builds the system prompt internally using this mode together with
   * `customInstructions` and `workspace` — no raw system prompt is accepted from outside.
   */
  mode?: import('../context/prompts/modes').Mode;
  /**
   * Workspace path injected into the system prompt (e.g. '/' for a cloned repo).
   */
  workspace?: string;
  /**
   * Custom instructions appended to the generated system prompt.
   */
  customInstructions?: string;
  /**
   * @internal
   * Pre-built system prompt string for use ONLY by specialised Task subclasses within
   * the core package (e.g. HierarchicalTask, PlannedTask) that need to control the
   * exact prompt content. External callers MUST NOT set this field — use `mode`,
   * `customInstructions`, and `workspace` instead.
   */
  _systemPrompt?: string;
  /**
   * When provided, the base Task automatically injects an `agent` tool backed by this executor.
   * Sub-agents spawned via the `agent` tool receive all non-interaction tools from this task.
   * If the tools array already contains an `agent` tool this field is ignored.
   *
   * Agent Tool auto-injection.
   */
  agentExecutor?: import('../tools/delegation/types').ISubAgentExecutor;
  /**
   * Agent registry for typed sub-agents.
   * When not set, falls back to `defaultAgentRegistry`.
   * When `agentExecutor` is also absent, the Task auto-creates a `SubAgentExecutor`
   * using this registry so that every Task has agent-spawning capability out of the box.
   */
  agentRegistry?: import('./agentRegistry').AgentRegistry;
  /**
   * Maximum iterations allowed for each spawned sub-agent (default: 20).
   * Passed through to the auto-created `SubAgentExecutor`.
   */
  maxSubAgentIterations?: number;
  /**
   * Optional code-integration provider for git-backed sub-agents.
   * Passed through to the auto-created `SubAgentExecutor`.
   */
  codeIntegrationProvider?: import('../tools/delegation/codeIntegrationProvider').CodeIntegrationProvider;
  memory?: MemoryConfig;
  longTermMemory?: LongTermMemoryConfig;
  /** Enable long-term memory features (default: false) */
  enableLongTermMemory?: boolean;
  /** Maximum iterations before task stops (default: unlimited) */
  maxIterations?: number;
  /** Optional shared event emitter to be used by this Task and any sub-tasks */
  events?: TypedEventEmitter;
  /** Optional initial conversation history to seed the task (used for fork sub-agents) */
  conversationHistory?: Message[];
  /**
   * Enable background memory consolidation at task completion.
   */
  enableMemoryConsolidation?: boolean;
  /**
   * Token count threshold at which a context warning is emitted (default: 160_000).
   */
  tokenWarningThreshold?: number;
  /**
   * Token count threshold at which the task is halted (default: 190_000).
   */
  tokenErrorThreshold?: number;
}

export type TaskEventMap = {
  message: (message: Message) => void;
  error: (error: Error) => void;
  toolUse: (tool: ToolUse) => void;
  toolResult: (result: ToolResult) => void;
  completed: (result: unknown) => void;
  memorySummary: (summary: Message) => void;
  memoryStored: (summary: string) => void;
  memoryRetrieved: (memories: string[]) => void;
  planStepStart: (stepStart: { id: string, name: string, intent: string }) => void;
  planStepResult: (stepResult: { id: string, name: string, result: ToolResult }) => void;
  /** Emitted when an external caller requests task cancellation */
  abort: (reason?: any) => void;
  streamChunk: (chunk: string) => void;
  stepMemoryRetrieved: (memory: { insights: string}) => void;
  /**
   * Emitted when context compaction (summarization) runs.
   */
  contextCompacted: (summary: { before: number; after: number; summaryLength: number }) => void;
  /**
   * Emitted on each tool use by a sub-agent for parent progress tracking.
   */
  subAgentProgress: (progress: SubAgentProgress) => void;
  /**
   * Emitted when estimated token usage approaches the warning threshold.
   */
  tokenBudgetWarning: (state: { estimatedTokens: number; threshold: number; percentUsed: number }) => void;
  /**
   * Emitted when estimated token usage exceeds the hard limit.
   */
  tokenBudgetExceeded: (state: { estimatedTokens: number; threshold: number }) => void;
};

export type ParseToolUseResult =
  | { success: true; toolUse: ToolUse }
  | { success: false; error: string };
