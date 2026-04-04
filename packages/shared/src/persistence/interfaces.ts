import type { TaskResponse, ChatMessage, ConversationSummary, MCPIntegration, Integration, Agent, CustomIntegration, Feedback, SecurityReview, PolicyTemplate, PolicyTemplateType } from '../types';
import type { TaskRun, IndexingRun } from '../types';

/**
 * Filters for querying tasks
 */
export interface TaskFilters {
  tenantId?: string;
  status?: TaskResponse['status'] | TaskResponse['status'][];
  createdAfter?: string;
  createdBefore?: string;
}

/**
 * Filters for querying chat messages
 */
export interface ChatMessageFilters {
  tenantId?: string;
  conversationId?: string;
  taskId?: string;
  role?: 'user' | 'assistant';
  createdAfter?: string;
  createdBefore?: string;
}

/**
 * Configuration for task repository
 */
export interface RepositoryConfig {
  qdrantUrl?: string;
  qdrantApiKey?: string;
  collectionName?: string;
}

/**
 * Repository interface for task persistence.
 * Implement this interface to support different database backends.
 */
export interface ITaskRepository {
  /**
   * Initialize the repository (e.g., create collections, tables)
   */
  initialize(): Promise<void>;

  /**
   * Create a new task
   */
  create(task: TaskResponse): Promise<TaskResponse>;

  /**
   * Update an existing task
   */
  update(id: string, updates: Partial<TaskResponse>): Promise<TaskResponse>;

  /**
   * Get a task by ID
   */
  getById(id: string): Promise<TaskResponse | null>;

  /**
   * Get all tasks with optional filters
   */
  getAll(filters?: TaskFilters): Promise<TaskResponse[]>;

  /**
   * Delete a task by ID
   */
  delete(id: string): Promise<boolean>;
}

/**
 * Repository interface for chat message persistence.
 * Implement this interface to support different database backends.
 */
export interface IChatMessageRepository {
  /**
   * Initialize the repository (e.g., create collections, tables)
   */
  initialize(): Promise<void>;

  /**
   * Create a new chat message
   */
  create(message: ChatMessage): Promise<ChatMessage>;

  /**
   * Get messages by conversation ID
   */
  getByConversationId(conversationId: string, filters?: Omit<ChatMessageFilters, 'conversationId'>): Promise<ChatMessage[]>;

  /**
   * Get messages by task ID
   */
  getByTaskId(taskId: string, filters?: Omit<ChatMessageFilters, 'taskId'>): Promise<ChatMessage[]>;

  /**
   * Get all conversations with their summaries
   */
  getAllConversations(): Promise<ConversationSummary[]>;

  /**
   * Delete messages by conversation ID
   */
  deleteByConversationId(conversationId: string): Promise<boolean>;

  /**
   * Delete messages by task ID
   */
  deleteByTaskId(taskId: string): Promise<boolean>;
}

/**
 * Repository interface for MCP integration persistence.
 */
export interface IMCPIntegrationRepository {
  /**
   * Initialize the repository
   */
  initialize(): Promise<void>;

  /**
   * Create a new MCP integration
   */
  create(integration: MCPIntegration): Promise<MCPIntegration>;

  /**
   * Update an existing MCP integration
   */
  update(id: string, updates: Partial<MCPIntegration>): Promise<MCPIntegration>;

  /**
   * Get an MCP integration by ID
   */
  getById(id: string, tenantId: string): Promise<MCPIntegration | null>;

  /**
   * Get all MCP integrations
   */
  getAll(tenantId: string, enabledOnly?: boolean): Promise<MCPIntegration[]>;

  /**
   * Delete an MCP integration by ID
   */
  delete(id: string, tenantId: string): Promise<boolean>;
}

/**
 * Repository interface for Custom integration persistence.
 */
export interface ICustomIntegrationRepository {
  /**
   * Initialize the repository
   */
  initialize(): Promise<void>;

  /**
   * Create a new Custom integration
   */
  create(integration: CustomIntegration): Promise<CustomIntegration>;

  /**
   * Update an existing Custom integration
   */
  update(id: string, updates: Partial<CustomIntegration>): Promise<CustomIntegration>;

  /**
   * Get a Custom integration by ID
   */
  getById(id: string, tenantId: string): Promise<CustomIntegration | null>;

  /**
   * Get all Custom integrations
   */
  getAll(tenantId: string, enabledOnly?: boolean): Promise<CustomIntegration[]>;

  /**
   * Delete a Custom integration by ID
   */
  delete(id: string, tenantId: string): Promise<boolean>;
}

/**
 * Repository interface for all integration types.
 */
export interface IIntegrationRepository {
  /**
   * Initialize the repository
   */
  initialize(): Promise<void>;

  /**
   * Get all integrations across all types
   */
  getAll(filters?: { type?: 'mcp' | 'code'; enabledOnly?: boolean }): Promise<Integration[]>;
}

/**
 * Repository interface for Agent persistence.
 */
export interface IAgentRepository {
  /**
   * Initialize the repository
   */
  initialize(): Promise<void>;

  /**
   * Create a new agent
   */
  create(agent: Agent): Promise<Agent>;

  /**
   * Update an existing agent
   */
  update(id: string, updates: Partial<Agent>): Promise<Agent>;

  /**
   * Get an agent by ID
   */
  getById(id: string, tenantId: string): Promise<Agent | null>;

  /**
   * Get all agents
   */
  getAll(tenantId: string): Promise<Agent[]>;

  /**
   * Delete an agent by ID
   */
  delete(id: string, tenantId: string): Promise<boolean>;
}

/**
 * Repository interface for TaskRun persistence.
 */
export interface ITaskRunRepository {
  /**
   * Initialize the repository
   */
  initialize(): Promise<void>;

  /**
   * Create a new task run
   */
  create(taskRun: TaskRun): Promise<TaskRun>;

  /**
   * Update an existing task run
   */
  update(id: string, updates: Partial<TaskRun>): Promise<TaskRun>;

  /**
   * Get a task run by ID
   */
  getById(id: string, tenantId: string): Promise<TaskRun | null>;

  /**
   * Get all task runs for a specific task
   */
  getByTaskId(taskId: string, tenantId: string): Promise<TaskRun[]>;

  /**
   * Get all task runs across all tasks
   */
  getAll(tenantId: string): Promise<TaskRun[]>;

  /**
   * Delete a task run by ID
   */
  delete(id: string, tenantId: string): Promise<boolean>;

  /**
   * Delete all task runs for a task
   */
  deleteByTaskId(taskId: string, tenantId: string): Promise<boolean>;
}

/**
 * Repository interface for Feedback persistence.
 */
export interface IFeedbackRepository {
  /**
   * Initialize the repository
   */
  initialize(): Promise<void>;

  /**
   * Create a new feedback
   */
  create(feedback: Feedback): Promise<Feedback>;

  /**
   * Get feedback by ID
   */
  getById(id: string, tenantId: string): Promise<Feedback | null>;

  /**
   * Get all feedback for a specific task
   */
  getByTaskId(taskId: string, tenantId: string): Promise<Feedback[]>;

  /**
   * Get all feedback for a specific task run
   */
  getByTaskRunId(taskRunId: string, tenantId: string): Promise<Feedback[]>;

  /**
   * Delete a feedback by ID
   */
  delete(id: string, tenantId: string): Promise<boolean>;

  /**
   * Update a feedback by ID
   */
  update(id: string, tenantId: string, updates: Partial<Feedback>): Promise<Feedback>;

  /**
   * Delete all feedback for a task
   */
  deleteByTaskId(taskId: string, tenantId: string): Promise<boolean>;
}

/**
 * Repository interface for SecurityReview persistence.
 */
export interface ISecurityReviewRepository {
  initialize(): Promise<void>;
  create(review: SecurityReview): Promise<SecurityReview>;
  update(id: string, tenantId: string, updates: Partial<SecurityReview>): Promise<SecurityReview>;
  getById(id: string, tenantId: string): Promise<SecurityReview | null>;
  getAll(tenantId: string): Promise<SecurityReview[]>;
  delete(id: string, tenantId: string): Promise<boolean>;
}

/**
 * Repository interface for PolicyTemplate persistence.
 */
export interface IPolicyTemplateRepository {
  initialize(): Promise<void>;
  create(template: PolicyTemplate): Promise<PolicyTemplate>;
  update(id: string, tenantId: string, updates: Partial<PolicyTemplate>): Promise<PolicyTemplate>;
  getById(id: string, tenantId: string): Promise<PolicyTemplate | null>;
  getAll(tenantId: string): Promise<PolicyTemplate[]>;
  getActiveByType(tenantId: string, type: PolicyTemplateType): Promise<PolicyTemplate | null>;
  delete(id: string, tenantId: string): Promise<boolean>;
}

/**
 * Repository interface for IndexingRun persistence.
 * Data classification: INTERNAL — contains operational metadata only (repo URLs,
 * commit SHAs, timestamps, counts). No PII or secret material.
 * All queries MUST filter by tenantId first for multi-tenant isolation.
 */
export interface IIndexingRunRepository {
  initialize(): Promise<void>;
  create(run: IndexingRun): Promise<IndexingRun>;
  update(id: string, tenantId: string, updates: Partial<IndexingRun>): Promise<IndexingRun>;
  getById(id: string, tenantId: string): Promise<IndexingRun | null>;
  getAll(tenantId: string): Promise<IndexingRun[]>;
  /**
   * Returns the most-recently completed IndexingRun for a given repository URL.
   * Used by the task-processor to resolve sinceCommit for incremental runs.
   * Security: always filters by tenantId first, then by status and scope.repositories.
   */
  getLatestCompletedForRepository(tenantId: string, repositoryUrl: string): Promise<IndexingRun | null>;
  /**
   * Delete all IndexingRun records for a tenant.
   * Called during "delete all assets" so incremental scans don't use stale sinceCommit values.
   * Security: scoped exclusively to the provided tenantId.
   */
  deleteByTenant(tenantId: string): Promise<void>;
}
