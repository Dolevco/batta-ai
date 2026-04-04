export interface LongTermMemoryConfig {
  /** Qdrant server URL (default: http://localhost:6333) */
  qdrantUrl?: string;
  /** Qdrant API key (optional, for cloud deployments) */
  qdrantApiKey?: string;
  /** Collection name in Qdrant (default: agent_memories) */
  collectionName?: string;
  /** Vector dimension size (default: 1536 for OpenAI embeddings) */
  vectorSize?: number;
  /** Maximum number of memories to retrieve (default: 5) */
  maxRetrievedMemories?: number;
  /** Minimum similarity score to consider a memory relevant (default: 0.7) */
  minSimilarityScore?: number;
}

export interface MemoryEntry {
  /** Unique identifier for the memory */
  id: string;
  /** The concise summary of the conversation */
  summary: string;
  /** When this memory was created */
  timestamp: Date;
  /** Additional metadata about the conversation */
  metadata?: MemoryMetadata;
}

export interface MemoryMetadata {
  /** The original user query/issue */
  issue?: string;
  /** The solution or recommendation provided */
  solution?: string;
  /** The outcome or result */
  outcome?: string;
  /** Tags for categorization */
  tags?: string[];
  data?: Record<string, unknown>;
}

export interface MemorySummaryResult {
  /** Whether the conversation is worth storing */
  isValuable: boolean;
  /** The structured summary if valuable */
  summary?: string;
  /** Structured breakdown of the conversation */
  metadata?: MemoryMetadata;
  /** Reason why the conversation was/wasn't valuable */
  reason: string;
}

export interface RetrievedMemory extends MemoryEntry {
  /** Similarity score from vector search */
  score: number;
}

/**
 * Generic memory insight template for flexible memory generation.
 * Used by MemoryTask to structure any type of memory.
 */
export interface MemoryInsight<T = Record<string, unknown>> {
  /** A concise, searchable summary of the memory */
  intent: string;
  executionPlan: string;
  outcome: string;
  /** Structured data specific to the memory type */
  data: T;
  /** Key insights or lessons learned */
  insights: string;
  /** Tags for categorization and filtering */
  tags?: string[];
  /** User feedback text for this memory (optional) */
  feedback?: string;
}