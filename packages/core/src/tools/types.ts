// TODO: change
export interface ToolResult {
  success: boolean;
  message: string;
  name?: string;
  result?: any;
  error?: string;
  /** Optional structured metadata to pass to dependent tasks */
  requiredOutput?: {
    repositoryName?: string;
    [key: string]: unknown;
  };
}

// Tool Types
export interface Tool {
  name: string;
  category: ToolCategory;
  description: string;
  parameters: ToolParameter[];
  isInteractionTool: boolean;
  /** Optional: describe what this tool is best used for (injected into system prompt) */
  whenToUse?: string;
  /**
   * Concurrency-safe flag.
   * When true, this tool may be executed in parallel with other concurrency-safe tools
   * in the same assistant turn. Read-only tools (file reads, searches) should set this to true.
   * Write/mutation tools should leave it false (default).
   */
  isConcurrencySafe?: boolean;
  /**
   * Per-tool result size budget.
   * If the tool result exceeds this many characters, paging/truncation is applied.
   */
  maxResultSizeChars?: number;
  /**
   * Human-readable activity description for progress tracking.
   * Returns a short string like "Reading src/foo.ts" for display in sub-agent progress.
   */
  getActivityDescription?(params: any): string | undefined;
  execute(params: unknown): Promise<ToolResult>;
}

export interface ToolParameter {
  name: string;
  description: string;
  required: boolean;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any';
}

export interface ToolUse {
  name: string;
  reason: string;
  parameters: Record<string, unknown>;
}

/**
 * Parsed assistant turn with potentially multiple tool uses.
 */
export interface ParsedAssistantTurn {
  /** Free-text portion of the assistant message (if any) */
  text?: string;
  /** Zero or more tool calls parsed from the message */
  toolUses: ToolUse[];
  /** Set of tool names that are safe to run concurrently (used to identify unsafe tools in a mixed batch) */
  concurrencySafeToolNames?: ReadonlySet<string>;
}

export interface ToolConfig {
  workspacePath?: string;
  notificationCallback?: (message: string) => Promise<void>;
  isInteractionTool?: boolean;
}

export interface ToolCategory {
  name: string;
  description: string;
  keywords: string[];
  requireAllTools?: boolean;
  tools?: string[];  // Tool names in this category (for explicit assignment)
}

export const SecurityToolCategory: ToolCategory = {
  name: 'security',
  description: 'Security related tools',
  keywords: ['security', 'microsoft', 'defender'],
};

export const CommunicationToolCategory: ToolCategory = {
  name: 'communication',
  description: 'Communication related tools',
  keywords: ['communication', 'message', 'slack'],
};