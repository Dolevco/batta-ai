import { QdrantClient } from '@qdrant/js-client-rest';
import { v4 as uuidv4 } from 'uuid';
import { IEmbeddingHandler } from '../../../api';
import {
  LongTermMemoryConfig,
  MemoryEntry,
  MemoryMetadata,
  RetrievedMemory,
  MemoryInsight
} from '../types';
import { MemoryTask } from '../../../task/memoryTask';
import { createQdrantConfig } from './qdrantUtils';

const DEFAULT_CONFIG: Required<LongTermMemoryConfig> = {
  qdrantUrl: process.env.QDRANT_URL || 'http://localhost:6333',
  qdrantApiKey: process.env.QDRANT_API_KEY || '',
  collectionName: 'agent_memories',
  vectorSize: 1536, // OpenAI text-embedding-ada-002 dimension
  maxRetrievedMemories: 5,
  minSimilarityScore: 0.7
};

export class LongTermMemory {
  private client: QdrantClient;
  private config: Required<LongTermMemoryConfig>;
  private initialized: boolean = false;
  private memoryTaskCache: Map<string, any> = new Map();

  constructor(
    private embeddingHandler: IEmbeddingHandler,
    config: LongTermMemoryConfig = {},
    private llmApi?: any // Optional LLM API for generating insights
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.client = new QdrantClient(
      createQdrantConfig(
        this.config.qdrantUrl,
        this.config.qdrantApiKey || undefined
      )
    );
  }

  /**
   * Initialize the Qdrant collection if it doesn't exist.
   * Should be called before using the memory.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(
        c => c.name === this.config.collectionName
      );

      if (!exists) {
        await this.client.createCollection(this.config.collectionName, {
          vectors: {
            size: this.config.vectorSize,
            distance: 'Cosine'
          }
        });
        console.log(`LongTermMemory: Created collection '${this.config.collectionName}'`);
      }

      this.initialized = true;
    } catch (error) {
      console.error('LongTermMemory: Failed to initialize', error);
      throw error;
    }
  }

  /**
   * Store a memory in the vector database.
   */
  async store(summary: string, metadata?: MemoryMetadata): Promise<MemoryEntry> {
    await this.ensureInitialized();

    try {
      // Generate embedding for the summary
      const embeddingResponse = await this.embeddingHandler.createEmbedding(summary);
      const embedding = embeddingResponse.embedding;

      const id = uuidv4();
      const timestamp = new Date();

      // Store in Qdrant
      await this.client.upsert(this.config.collectionName, {
        wait: true,
        points: [
          {
            id,
            vector: embedding,
            payload: {
              summary,
              timestamp: timestamp.toISOString(),
              ...metadata
            }
          }
        ]
      });

      const entry: MemoryEntry = {
        id,
        summary,
        timestamp,
        metadata
      };

      console.log(`LongTermMemory: Stored memory ${id}`);
      return entry;
    } catch (error) {
      console.error('LongTermMemory: Failed to store memory', error);
      throw error;
    }
  }

  /**
   * Search for relevant memories based on a query.
   */
  async search(query: string, limit?: number): Promise<RetrievedMemory[]> {
    await this.ensureInitialized();

    try {
      // Generate embedding for the query
      const embeddingResponse = await this.embeddingHandler.createEmbedding(query);
      const queryEmbedding = embeddingResponse.embedding;

      const searchLimit = limit || this.config.maxRetrievedMemories;

      // Search in Qdrant
      const results = await this.client.search(this.config.collectionName, {
        vector: queryEmbedding,
        limit: searchLimit,
        score_threshold: this.config.minSimilarityScore
      });

      // Map results to RetrievedMemory
      return results.map(result => ({
        id: String(result.id),
        summary: (result.payload?.summary as string) || '',
        timestamp: new Date((result.payload?.timestamp as string) || Date.now()),
        score: result.score,
        metadata: {
          issue: result.payload?.issue as string | undefined,
          solution: result.payload?.solution as string | undefined,
          outcome: result.payload?.outcome as string | undefined,
          tags: result.payload?.tags as string[] | undefined
        }
      }));
    } catch (error) {
      console.error('LongTermMemory: Failed to search memories', error);
      return []; // Return empty array on error to not break the flow
    }
  }

  /**
   * Delete a specific memory by ID.
   */
  async delete(id: string): Promise<void> {
    await this.ensureInitialized();

    try {
      await this.client.delete(this.config.collectionName, {
        wait: true,
        points: [id]
      });
      console.log(`LongTermMemory: Deleted memory ${id}`);
    } catch (error) {
      console.error('LongTermMemory: Failed to delete memory', error);
      throw error;
    }
  }

  /**
   * List all stored memories (for consolidation / dream pass).
   * Returns memories without vector data. Limited to 500 to prevent overload.
   */
  async listAll(limit = 500): Promise<RetrievedMemory[]> {
    await this.ensureInitialized();
    try {
      const results = await this.client.scroll(this.config.collectionName, {
        limit,
        with_payload: true,
        with_vector: false
      });

      return (results.points ?? []).map((point: any) => ({
        id: String(point.id),
        summary: (point.payload?.summary as string) || (point.payload?.insights as string) || '',
        timestamp: new Date((point.payload?.timestamp as string) || Date.now()),
        score: 1.0,
        metadata: {
          issue: point.payload?.issue as string | undefined,
          solution: point.payload?.solution as string | undefined,
          outcome: point.payload?.outcome as string | undefined,
          tags: point.payload?.tags as string[] | undefined
        }
      }));
    } catch (error) {
      console.error('LongTermMemory: Failed to list all memories', error);
      return [];
    }
  }

  /**
   * Get the count of stored memories.
   */
  async count(): Promise<number> {
    await this.ensureInitialized();

    try {
      const info = await this.client.getCollection(this.config.collectionName);
      return info.points_count || 0;
    } catch (error) {
      console.error('LongTermMemory: Failed to get count', error);
      return 0;
    }
  }

  /**
   * Format retrieved memories as context for the LLM.
   */
  formatMemoriesAsContext(memories: RetrievedMemory[]): string {
    if (memories.length === 0) return '';

    const formattedMemories = memories
      .map((m, i) => `[Memory ${i + 1}] ${m.summary}`)
      .join('\n');

    return `Relevant past experiences:\n${formattedMemories}`;
  }

  /**
   * Store a generic memory insight.
   * This is a flexible method that can store any type of structured memory data.
   */
  async storeMemoryInsight<T = Record<string, unknown>>(
    insight: MemoryInsight<T>,
    memoryType: string
  ): Promise<MemoryEntry> {
    await this.ensureInitialized();

    try {
      // Generate embedding for the summary
      const embeddingResponse = await this.embeddingHandler.createEmbedding(insight.intent);
      const embedding = embeddingResponse.embedding;

      const id = uuidv4();
      const timestamp = new Date();

      // Store in Qdrant with the memory type tag
      await this.client.upsert(this.config.collectionName, {
        wait: true,
        points: [
          {
            id,
            vector: embedding,
            payload: {
              intent: insight.intent,
              outcome: insight.outcome,
              executionPlan: insight.executionPlan,
              timestamp: timestamp.toISOString(),
              type: memoryType,
              data: insight.data,
              insights: insight.insights,
              tags: insight.tags || [],
              feedback: insight.feedback
            }
          }
        ]
      });

      const entry: MemoryEntry = {
        id,
        summary: insight.insights,
        timestamp,
        metadata: {
          issue: insight.intent,
          outcome: insight.outcome,
          solution: insight.executionPlan,
          tags: insight.tags
        }
      };

      console.log(`LongTermMemory: Stored ${memoryType} memory ${id}`);
      return entry;
    } catch (error) {
      console.error(`LongTermMemory: Failed to store ${memoryType} memory`, error);
      throw error;
    }
  }

  /**
   * Search for memories of a specific type.
   */
  async searchMemoriesByType(
    query: string,
    memoryType: string,
    limit?: number
  ): Promise<MemoryInsight[]> {
    await this.ensureInitialized();

    try {
      // Generate embedding for the query
      const embeddingResponse = await this.embeddingHandler.createEmbedding(query);
      const queryEmbedding = embeddingResponse.embedding;

      const searchLimit = limit || this.config.maxRetrievedMemories;

      // Search in Qdrant, filtering for memory type
      const results = await this.client.search(this.config.collectionName, {
        vector: queryEmbedding,
        limit: searchLimit,
        score_threshold: this.config.minSimilarityScore,
        filter: {
          must: [
            {
              key: 'type',
              match: { value: memoryType }
            }
          ]
        }
      });

      // Map results to RetrievedMemory
      return results.map(result => ({
        intent: (result.payload?.intent as string) || '',
        outcome: (result.payload?.outcome as string) || '',
        executionPlan: (result.payload?.executionPlan as string) || '',
        insights: (result.payload?.insights as string) || '',
        timestamp: new Date((result.payload?.timestamp as string) || Date.now()),
        score: result.score,
        data: result.payload?.data,
        tags: result.payload?.tags as string[] | undefined,
        feedback: result.payload?.feedback as string | undefined
      } as MemoryInsight));
    } catch (error) {
      console.error(`LongTermMemory: Failed to search ${memoryType} memories`, error);
      return [];
    }
  }

  /**
   * Get or create a MemoryTask for a specific memory type.
   * Uses caching to avoid recreating tasks.
   */
  private getMemoryTask(memoryType: string, config: any): any {
    if (!this.llmApi) {
      return null;
    }

    const cacheKey = memoryType;
    if (this.memoryTaskCache.has(cacheKey)) {
      return this.memoryTaskCache.get(cacheKey);
    }

    // Dynamically import and create MemoryTask
    // This is a lazy import to avoid circular dependencies
    try {
      const task = new MemoryTask(this.llmApi, config);
      this.memoryTaskCache.set(cacheKey, task);
      return task;
    } catch (error) {
      console.warn('Failed to create MemoryTask:', error);
      return null;
    }
  }

  /**
   * Store raw data as a memory using MemoryTask to generate insights.
   * This is a convenience method that handles the insight generation automatically.
   * 
   * @param data - The raw data to process
   * @param memoryType - Type of memory being stored
   * @param config - Configuration for insight generation
   * @param intent - Optional original intent/goal (helps with similarity search)
   */
  async storeWithInsightGeneration<TInput, TOutput>(
    data: TInput,
    memoryType: string,
    config: {
      processingInstructions: string;
      outputSchema?: string;
      exampleOutput?: TOutput;
    },
    intent?: string
  ): Promise<MemoryEntry> {
    if (!this.llmApi) {
      throw new Error('LLM API required for automatic insight generation. Provide it in constructor or use storeMemoryInsight directly.');
    }

    const memoryTask = this.getMemoryTask(memoryType, {
      memoryType,
      ...config
    });

    if (!memoryTask) {
      throw new Error('Failed to create MemoryTask for insight generation');
    }

    // Generate insight using MemoryTask
    const insight = await memoryTask.generateInsight(data, intent);

    // Use original intent for indexing
    insight.intent = intent;

    // Store the generated insight
    return this.storeMemoryInsight(insight, memoryType);
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}