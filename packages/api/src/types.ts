import type { GitToolConfig, StoredPlan, Tool } from "@ai-agent/core";

// Agent Types
export interface Agent {
  id: string;
  name: string;
  role: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentRequest {
  name: string;
  role: string;
}

export interface UpdateAgentRequest {
  name?: string;
  role?: string;
}

export interface CreateTaskRequest {
  description: string;
  agentId?: string; // Link task to an agent
  tools?: string[];
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  conversationId?: string; // Optional conversation ID for linking to chat messages
}

export interface TaskMessageRequest {
  message: string;
}

export interface TaskResponse {
  id: string;
  description: string;
  agentId?: string; // Link to agent
  tenantId: string;
  tools?: string[]; // Integration IDs selected for this task
  status: 'pending' | 'planning' | 'completed' | 'failed';
  plan?: StoredPlan;
  createdAt: string;
  updatedAt: string;
  chatMessages?: ChatMessage[]; // Associated chat messages
  feedbacks?: Feedback[]; // User feedback on task runs
}

// Chat Message Types
export interface ChatMessage {
  id: string;
  conversationId: string;
  taskId?: string; // Optional link to a task
  tenantId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  metadata?: Record<string, any>; // For additional data like tool calls, etc.
}

export interface CreateChatMessageRequest {
  conversationId: string;
  taskId?: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: Record<string, any>;
}

export interface ConversationSummary {
  conversationId: string;
  taskId?: string;
  messageCount: number;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
}

// Integration Types
export type IntegrationType = 'mcp' | 'code' | 'custom';

export interface BaseIntegration {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

// MCP Integration Types
export interface MCPIntegration extends BaseIntegration {
  type: 'mcp';
  transport: 'http' | 'stdio';
  config: MCPHttpConfig | MCPStdioConfig;
}

export interface MCPHttpConfig {
  url: string;
  headers?: Record<string, string>;
}

export interface MCPStdioConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface CreateMCPIntegrationRequest {
  name: string;
  description?: string;
  transport: 'http' | 'stdio';
  config: MCPHttpConfig | MCPStdioConfig;
  enabled?: boolean;
}

export interface UpdateMCPIntegrationRequest {
  name?: string;
  description?: string;
  config?: MCPHttpConfig | MCPStdioConfig;
  enabled?: boolean;
}

export interface DockerMCPServer {
  name: string;
  description: string;
  toolCount: number;
}

export interface MCPIntegrationDetails extends MCPIntegration {
  tools?: MCPToolInfo[];
  connectionStatus?: 'connected' | 'disconnected' | 'error';
  error?: string;
}

export interface MCPToolInfo {
  name: string;
  description: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

// Built-in Integration Types
export interface MdcIntegrationConfig {
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  subscriptionId?: string;
}

export interface CustomIntegrationField {
  /**
   * Key name used in the integration config object (e.g. tenantId)
   */
  key: string;

  /**
   * Human friendly label to show in the UI
   */
  displayName: string;

  /**
   * Short description/help text shown under the field
   */
  description?: string;

  /**
   * Placeholder/example value to show in the input
   */
  placeholder?: string;

  /**
   * Whether the field is required
   */
  required?: boolean;

  /**
   * Whether the field contains secrets and should be masked
   */
  secret?: boolean;

  /**
   * Field input type for rendering (string, password, textarea, number, boolean)
   */
  type?: 'string' | 'password' | 'textarea' | 'number' | 'boolean';
}

export type CustomIntegrationConfigSchema = CustomIntegrationField[];

// New OAuth metadata that built-in integrations can optionally expose to the UI
export interface BuiltInOAuthConfig {
  /**
   * URL (absolute or relative) to start the OAuth consent flow. If relative it will be resolved against the current origin.
   */
  authorizeUrl: string;

  /**
   * Optional default scopes to request
   */
  scopes?: string[];

  /**
   * Optional additional query params to include when building the consent URL
   */
  params?: Record<string, string>;
}

export interface BuiltInIntegration {
  id: string;
  name: string;
  description: string;
  category: string;
  uiCategory?: string;
  type: 'mcp' | 'code' | 'custom';
  // Built-in integrations may include MCP/http configs,
  // MDC configs or arbitrary custom config key/values for custom built-ins (e.g. Slack tokens).
  config: MCPHttpConfig | MCPStdioConfig | MdcIntegrationConfig | Record<string, string>;

  // Optional schema that describes the expected configuration fields for UI rendering
  configSchema?: CustomIntegrationConfigSchema;

  // Optional OAuth metadata that tells the UI how to construct a consent link for this provider
  oauth?: BuiltInOAuthConfig;
}

export interface CustomIntegration extends BaseIntegration {
  type: 'custom' | 'code';
  // dynamic key/value config for custom integrations
  config: Record<string, string>;
}

export interface CustomIntegrationHandler {
  id: string;
  name: string;
  // Return the tools exposed by the integration at runtime
  getTools(): Tool[];
}

export interface CodeIntegrationRepository {
  name: string;
  url: string;
  language?: string;
  description?: string;
  defaultBranch?: string;
}

export interface CodeIntegrationHandler extends CustomIntegrationHandler {
  getCodingTools: (config: GitToolConfig) => Tool[];
  getAccessToken: () => Promise<string>;
  getRepositories: () => Promise<CodeIntegrationRepository[]>;
}

export interface ValidateIntegrationRequest {
  integrationId: string;
  config: Record<string, any>;
}

export interface ValidateIntegrationResponse {
  valid: boolean;
  error?: string;
}

// Task Run Types - for persisting execution history
export interface TaskRun {
  id: string;
  taskId: string;
  taskName?: string;
  tenantId: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  result?: any;
  error?: string;
  chainOfThoughts: ChainThoughtEvent[];
  workerId?: string; // Container ID (Docker) or execution name (Azure) for cancellation
  environment?: 'local' | 'azure' | 'debug'; // Execution environment
}

export interface ChainThoughtEvent {
  id: string;
  timestamp: string;
  type: 'toolUse' | 'planStepStart' | 'planStepResult' | 'other';
  name?: string;
  reason?: string;
  message?: string;
  error?: string;
  result?: any;
  status?: 'pending' | 'running' | 'success' | 'failed';
  data?: any;
}

// Feedback Types - for user feedback on task runs
export interface Feedback {
  id: string;
  taskId: string;
  taskRunId?: string;
  tenantId: string;
  role: 'user' | 'system';
  content: string;
  createdAt: string;
  rating?: 'like' | 'dislike';
}

export interface CreateFeedbackRequest {
  taskId: string;
  taskRunId?: string;
  content: string;
  rating?: 'like' | 'dislike';
}

export interface CreateCustomIntegrationRequest {
  name: string;
  description?: string;
  config: Record<string, string>;
  enabled?: boolean;
}

export interface UpdateCustomIntegrationRequest {
  name?: string;
  description?: string;
  config?: Partial<Record<string, string>>;
  enabled?: boolean;
}
