import { QdrantClient } from '@qdrant/js-client-rest';
import type { ChatMessage, ConversationSummary } from '../types';
import type { IChatMessageRepository, ChatMessageFilters, RepositoryConfig } from './interfaces';
import { createQdrantConfig } from './qdrantUtils';

const DEFAULT_CONFIG = {
  qdrantUrl: 'http://localhost:6333',
  qdrantApiKey: '',
  collectionName: 'chat_messages',
};

/**
 * Qdrant-based implementation of chat message repository.
 * Uses Qdrant as a document store for chat messages with efficient filtering.
 */
export class QdrantChatMessageRepository implements IChatMessageRepository {
  private client: QdrantClient;
  private config: Required<RepositoryConfig>;
  private initialized = false;

  constructor(config: RepositoryConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.client = new QdrantClient(
      createQdrantConfig(
        this.config.qdrantUrl,
        this.config.qdrantApiKey || undefined
      )
    );
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(
        (c: any) => c.name === this.config.collectionName
      );

      if (!exists) {
        // Create collection without vectors (payload-only storage)
        await this.client.createCollection(this.config.collectionName, {
          vectors: {
            size: 1,
            distance: 'Cosine',
          },
          // Enable payload indexing for efficient filtering
          optimizers_config: {
            indexing_threshold: 0,
          },
        });

        // Create payload indexes for common filter fields
        await this.client.createPayloadIndex(this.config.collectionName, {
          field_name: 'conversationId',
          field_schema: 'keyword',
        });

        await this.client.createPayloadIndex(this.config.collectionName, {
          field_name: 'taskId',
          field_schema: 'keyword',
        });

        await this.client.createPayloadIndex(this.config.collectionName, {
          field_name: 'role',
          field_schema: 'keyword',
        });

        await this.client.createPayloadIndex(this.config.collectionName, {
          field_name: 'createdAt',
          field_schema: 'datetime',
        });

        await this.client.createPayloadIndex(this.config.collectionName, {
          field_name: 'tenantId',
          field_schema: 'keyword',
        });

        console.log(`ChatMessageRepository: Created collection '${this.config.collectionName}'`);
      }

      this.initialized = true;
    } catch (error) {
      console.error('ChatMessageRepository: Failed to initialize', error);
      throw error;
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  async create(message: ChatMessage): Promise<ChatMessage> {
    await this.ensureInitialized();

    try {
      await this.client.upsert(this.config.collectionName, {
        wait: true,
        points: [
          {
            id: message.id,
            vector: [0], // Dummy vector since we're not doing vector search
            payload: message as any,
          },
        ],
      });

      return message;
    } catch (error) {
      console.error('ChatMessageRepository: Failed to create message', error);
      throw error;
    }
  }

  async getByConversationId(conversationId: string, filters?: Omit<ChatMessageFilters, 'conversationId'>): Promise<ChatMessage[]> {
    await this.ensureInitialized();

    try {
      // Build filter conditions
      const filterConditions: any[] = [
        {
          key: 'conversationId',
          match: { value: conversationId },
        },
      ];

      // Add tenantId filter if provided
      if (filters?.tenantId) {
        filterConditions.push({
          key: 'tenantId',
          match: { value: filters.tenantId },
        });
      }

      if (filters?.taskId) {
        filterConditions.push({
          key: 'taskId',
          match: { value: filters.taskId },
        });
      }

      if (filters?.role) {
        filterConditions.push({
          key: 'role',
          match: { value: filters.role },
        });
      }

      if (filters?.createdAfter) {
        filterConditions.push({
          key: 'createdAt',
          range: { gte: filters.createdAfter },
        });
      }

      if (filters?.createdBefore) {
        filterConditions.push({
          key: 'createdAt',
          range: { lte: filters.createdBefore },
        });
      }

      // Use scroll to get all matching messages
      const scrollResult = await this.client.scroll(this.config.collectionName, {
        filter: { must: filterConditions },
        with_payload: true,
        with_vector: false,
        limit: 1000, // Adjust as needed for conversation size
      });

      // Sort by createdAt to maintain conversation order
      const messages = scrollResult.points.map((point: any) => point.payload as unknown as ChatMessage);
      return messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    } catch (error) {
      console.error('ChatMessageRepository: Failed to get messages by conversation', error);
      throw error;
    }
  }

  async getByTaskId(taskId: string, filters?: Omit<ChatMessageFilters, 'taskId'>): Promise<ChatMessage[]> {
    await this.ensureInitialized();

    try {
      // Build filter conditions
      const filterConditions: any[] = [
        {
          key: 'taskId',
          match: { value: taskId },
        },
      ];

      // Add tenantId filter if provided
      if (filters?.tenantId) {
        filterConditions.push({
          key: 'tenantId',
          match: { value: filters.tenantId },
        });
      }

      if (filters?.conversationId) {
        filterConditions.push({
          key: 'conversationId',
          match: { value: filters.conversationId },
        });
      }

      if (filters?.role) {
        filterConditions.push({
          key: 'role',
          match: { value: filters.role },
        });
      }

      if (filters?.createdAfter) {
        filterConditions.push({
          key: 'createdAt',
          range: { gte: filters.createdAfter },
        });
      }

      if (filters?.createdBefore) {
        filterConditions.push({
          key: 'createdAt',
          range: { lte: filters.createdBefore },
        });
      }

      // Use scroll to get all matching messages
      const scrollResult = await this.client.scroll(this.config.collectionName, {
        filter: { must: filterConditions },
        with_payload: true,
        with_vector: false,
        limit: 1000,
      });

      // Sort by createdAt to maintain conversation order
      const messages = scrollResult.points.map((point: any) => point.payload as unknown as ChatMessage);
      return messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    } catch (error) {
      console.error('ChatMessageRepository: Failed to get messages by task', error);
      throw error;
    }
  }

  async getAllConversations(): Promise<ConversationSummary[]> {
    await this.ensureInitialized();

    try {
      // Get all messages grouped by conversationId
      const scrollResult = await this.client.scroll(this.config.collectionName, {
        with_payload: true,
        with_vector: false,
        limit: 10000, // Large limit to get all conversations
      });

      const messages = scrollResult.points.map((point: any) => point.payload as unknown as ChatMessage);

      // Group by conversationId and create summaries
      const conversationMap = new Map<string, ChatMessage[]>();

      for (const message of messages) {
        if (!conversationMap.has(message.conversationId)) {
          conversationMap.set(message.conversationId, []);
        }
        conversationMap.get(message.conversationId)!.push(message);
      }

      const summaries: ConversationSummary[] = [];
      for (const [conversationId, conversationMessages] of conversationMap) {
        const sortedMessages = conversationMessages.sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );

        const firstMessage = sortedMessages[0];
        const lastMessage = sortedMessages[sortedMessages.length - 1];

        // Get unique taskIds for this conversation
        const taskIds = [...new Set(conversationMessages.map(m => m.taskId).filter(Boolean))];

        summaries.push({
          conversationId,
          taskId: taskIds.length === 1 ? taskIds[0] : undefined, // Only set if single task
          messageCount: conversationMessages.length,
          lastMessageAt: lastMessage.createdAt,
          createdAt: firstMessage.createdAt,
          updatedAt: lastMessage.createdAt,
        });
      }

      // Sort by last message date (most recent first)
      return summaries.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
    } catch (error) {
      console.error('ChatMessageRepository: Failed to get all conversations', error);
      throw error;
    }
  }

  async deleteByConversationId(conversationId: string): Promise<boolean> {
    await this.ensureInitialized();

    try {
      await this.client.delete(this.config.collectionName, {
        wait: true,
        filter: {
          must: [
            {
              key: 'conversationId',
              match: { value: conversationId },
            },
          ],
        },
      });

      return true;
    } catch (error) {
      console.error('ChatMessageRepository: Failed to delete messages by conversation', error);
      return false;
    }
  }

  async deleteByTaskId(taskId: string): Promise<boolean> {
    await this.ensureInitialized();

    try {
      await this.client.delete(this.config.collectionName, {
        wait: true,
        filter: {
          must: [
            {
              key: 'taskId',
              match: { value: taskId },
            },
          ],
        },
      });

      return true;
    } catch (error) {
      console.error('ChatMessageRepository: Failed to delete messages by task', error);
      return false;
    }
  }
}
