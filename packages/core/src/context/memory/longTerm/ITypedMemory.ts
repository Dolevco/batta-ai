import { MemoryEntry, MemoryInsight } from '../types';

/**
 * Generic interface for typed memory storage and retrieval.
 * Implement this interface to create specialized memory types.
 * 
 * @template TData - The structured data type for this memory
 * @template TInput - The raw input data type (can be unstructured)
 */
export interface ITypedMemory<TData, TInput = TData> {
  /**
   * The unique type identifier for this memory (e.g., 'task_run', 'plan_generation')
   */
  readonly memoryType: string;

  /**
   * Store raw input data as a memory.
   * If the input is already structured (TData), it stores directly.
   * Otherwise, it generates insights from raw data (TInput).
   * 
   * @param data - Raw or structured data to store
   * @param useInsightGeneration - Whether to use LLM to generate insights from raw data
   */
  store(data: TInput, useInsightGeneration?: boolean): Promise<MemoryEntry>;

  /**
   * Search for memories of this type based on a query.
   * 
   * @param query - Natural language search query
   * @param limit - Maximum number of results to return
   */
  search(query: string, limit?: number): Promise<MemoryInsight[]>;

  /**
   * Format retrieved memories as context for LLM consumption.
   * 
   * @param memories - Retrieved memories to format
   */
  formatAsContext(memories: MemoryInsight[]): string;

  /**
   * Initialize the memory (e.g., ensure database collections exist).
   * Should be called before first use.
   */
  initialize(): Promise<void>;
}