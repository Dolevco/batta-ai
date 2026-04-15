import { AzureOpenAIClient, IEmbeddingHandler, ChatTask, MODES, Tool, createChatCompletionTool } from '@ai-agent/core';
import { Neo4jAdapter, QdrantAdapter, SecurityQueryTools, createSecurityQueryTools, SecurityReviewService, FeatureService } from '@ai-agent/shared';
import { createSecurityChatTools } from './chatSecurityReviewTools';
import { createKnowledgeBaseChatTools } from './chatKnowledgeBaseTools';
import { createServiceRelationshipTools } from './chatServiceRelationshipTools';

interface ChatTaskConfig {
  apiClient: AzureOpenAIClient;
  embeddingClient: IEmbeddingHandler;
  securityReviewService: SecurityReviewService;
  featureService: FeatureService;
  tenantId: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/**
 * Create a ChatTask focused on security reviews, assets, and business features.
 * Includes:
 *  - Security review + feature query tools (chatSecurityReviewTools)
 *  - Knowledge base semantic search tools (chatKnowledgeBaseTools):
 *      semantic_search_services, semantic_search_features, filter_security_reviews
 *  - Infrastructure graph tools (securityQueryTools) when Neo4j + Qdrant are configured
 */
export async function createChatTask(config: ChatTaskConfig): Promise<ChatTask> {
  const { apiClient, embeddingClient, securityReviewService, featureService, tenantId, conversationHistory = [] } = config;

  const tools: Tool[] = [];

  // Add security review and feature query tools
  const secChatTools = createSecurityChatTools(securityReviewService, featureService, tenantId);
  tools.push(...secChatTools);

  // Add security tools if Neo4j and Qdrant are configured
  if (process.env.NEO4J_URI && process.env.QDRANT_URL) {
    try {
      // Initialize Neo4j adapter
      const neo4j = new Neo4jAdapter({
        uri: process.env.NEO4J_URI,
        username: process.env.NEO4J_USERNAME || 'neo4j',
        password: process.env.NEO4J_PASSWORD || 'password'
      });

      // Initialize Qdrant adapter using the shared embedding client
      const qdrant = new QdrantAdapter({
        url: process.env.QDRANT_URL,
        apiKey: process.env.QDRANT_API_KEY,
        collectionPrefix: 'code_indexer',
      }, embeddingClient);

      // Add knowledge base semantic search + filtered review tools
      const kbTools = createKnowledgeBaseChatTools(qdrant, featureService, securityReviewService, tenantId);
      tools.push(...kbTools);

      // Create security query tools instance (graph traversal)
      const securityQueryTools = new SecurityQueryTools({
        tenantId,
        neo4j,
        qdrant,
      });

      // Create and add security tools
      const securityTools = createSecurityQueryTools(securityQueryTools);
      tools.push(...securityTools);

      // Add service-to-service relationship tools
      const serviceRelTools = createServiceRelationshipTools(neo4j, qdrant, tenantId);
      tools.push(...serviceRelTools);
    } catch (error) {
      console.warn('Failed to initialize security tools:', error);
      // Continue without security tools
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
