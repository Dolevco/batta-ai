import { IEmbeddingHandler, ILLMApiHandler, ChatTask, MODES, Tool, createChatCompletionTool, createEmbeddingClientFromEnv } from '@batta/core';
import {
  SecurityQueryTools,
  createSecurityQueryTools,
  SecurityReviewService,
  FeatureService,
  ICustomIntegrationRepository,
  JiraIntegration,
  createPostgresDataAdapter,
  createPostgresGraphAdapter,
  type JiraConfig,
} from '@batta/shared';
import { createSecurityChatTools } from './chatSecurityReviewTools';
import { createKnowledgeBaseChatTools } from './chatKnowledgeBaseTools';
import { createServiceRelationshipTools } from './chatServiceRelationshipTools';

interface ChatTaskConfig {
  apiClient: ILLMApiHandler;
  embeddingClient: IEmbeddingHandler;
  securityReviewService: SecurityReviewService;
  featureService: FeatureService;
  tenantId: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  customIntegrationRepository?: ICustomIntegrationRepository;
}

/**
 * Create a ChatTask focused on security reviews, assets, and business features.
 * Includes:
 *  - Security review + feature query tools (chatSecurityReviewTools)
 *  - Knowledge base semantic search tools (chatKnowledgeBaseTools):
 *      semantic_search_services, semantic_search_features, filter_security_reviews
 *  - Infrastructure graph tools (securityQueryTools) when adapters are configured
 */
export async function createChatTask(config: ChatTaskConfig): Promise<ChatTask> {
  const { apiClient, embeddingClient, securityReviewService, featureService, tenantId, conversationHistory = [], customIntegrationRepository } = config;

  const tools: Tool[] = [];

  // Add security review and feature query tools
  const secChatTools = createSecurityChatTools(securityReviewService, featureService, tenantId);
  tools.push(...secChatTools);

  // Add knowledge base + graph tools (always available with PostgreSQL)
  try {
    const dataAdapter = createPostgresDataAdapter(embeddingClient ?? createEmbeddingClientFromEnv());
    const graphAdapter = createPostgresGraphAdapter();

    const kbTools = createKnowledgeBaseChatTools(dataAdapter, featureService, securityReviewService, tenantId);
    tools.push(...kbTools);

    const securityQueryTools = new SecurityQueryTools({ tenantId, graphAdapter, dataAdapter });
    tools.push(...createSecurityQueryTools(securityQueryTools));

    const serviceRelTools = createServiceRelationshipTools(graphAdapter, dataAdapter, tenantId);
    tools.push(...serviceRelTools);
  } catch (error) {
    console.warn('Failed to initialize security tools:', error);
  }

  // Load custom integration tools (e.g. Jira) for this tenant
  if (customIntegrationRepository) {
    try {
      const integrations = await customIntegrationRepository.getAll(tenantId, true);
      for (const integration of integrations) {
        if (integration.name === 'Jira') {
          const cfg = integration.config as Record<string, string>;
          const jiraConfig: JiraConfig = {
            tenantId: cfg.tenantId || tenantId,
            baseUrl: cfg.baseUrl || '',
            userEmail: cfg.userEmail || '',
            apiToken: cfg.apiToken || '',
            projectKeys: cfg.projectKeys || undefined,
          };
          tools.push(...new JiraIntegration(jiraConfig).getTools());
        }
      }
    } catch (error) {
      console.warn('Failed to load custom integration tools for chat:', error);
    }
  }

  // Add chat completion tool (replaces task_complete for chat mode)
  tools.push(createChatCompletionTool());

  // Create and return ChatTask instance
  const task = new ChatTask(apiClient, MODES.TASK_CHAT_ASSISTANT, {
    tools,
    maxIterations: 30,
    conversationHistory,
  });

  return task;
}
