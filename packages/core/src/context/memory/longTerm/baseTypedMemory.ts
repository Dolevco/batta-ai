import { ITypedMemory } from './ITypedMemory';
import { LongTermMemory } from './longTermMemory';
import { MemoryEntry, MemoryInsight } from '../types';
import { ILLMApiHandler } from '../../../llm';

/**
 * Configuration for TypedMemory
 */
export interface TypedMemoryConfig {
  /** Custom system prompt (optional, will be auto-generated if not provided) */
  systemPrompt?: string;
  /** Instructions for processing raw data into structured format */
  processingInstructions: string;
  /** JSON schema describing the expected data structure */
  outputSchema?: string;
  /** Required fields in the data object with their descriptions */
  requiredFields?: Record<string, string>;
  /** Optional example output to guide LLM */
  exampleOutput?: any;
}

/**
 * Base implementation of ITypedMemory that handles common functionality.
 * Extend this class to create specialized memory types.
 */
export abstract class BaseTypedMemory<TData, TInput = TData> implements ITypedMemory<TData, TInput> {
  abstract readonly memoryType: string;
  protected abstract readonly config: TypedMemoryConfig;

  constructor(
    protected longTermMemory: LongTermMemory,
    protected llmApi?: ILLMApiHandler
  ) {}

  /**
   * Initialize the memory storage.
   */
  async initialize(): Promise<void> {
    await this.longTermMemory.initialize();
  }

  /**
   * Format data for memory insight generation.
   * Override this to provide custom formatting for the LLM.
   * By default, converts to JSON string.
   */
  protected formatDataForMemoryTask(data: TInput): string {
    return JSON.stringify(data, null, 2);
  }

  /**
   * Store data as a memory.
   * Automatically detects if data is structured or needs insight generation.
   */
  async store(data: TInput): Promise<MemoryEntry> {
    // If insight generation is requested and data is not structured
    if (this.llmApi) {
      // Format the data for the LLM
      const formattedData = this.formatDataForMemoryTask(data);
      
      return this.longTermMemory.storeWithInsightGeneration(
        formattedData,
        this.memoryType,
        this.config
      );
    }

    // Direct storage with structured data
    const structuredData = data as unknown as TData;
    const insight = this.createInsight(structuredData);
    return this.longTermMemory.storeMemoryInsight(insight, this.memoryType);
  }

  /**
   * Search for memories of this type.
   */
  async search(query: string, limit?: number): Promise<MemoryInsight[]> {
    return this.longTermMemory.searchMemoriesByType(query, this.memoryType, limit);
  }

  /**
   * Format memories as context for LLM.
   * Override this method to provide custom formatting.
   */
  formatAsContext(memories: MemoryInsight[]): string {
    if (memories.length === 0) return '';

    const formattedMemories = memories
      .map((m, i) => {
        if (!m.data) return `[${this.memoryType} ${i + 1}] ${m.insights}`;

        return this.formatSingleMemory(m, i);
      })
      .join('\n\n');

    return `Past ${this.memoryType} memories:\n${formattedMemories}`;
  }

  /**
   * Create a memory insight from structured data.
   * Override this to customize how insights are created.
   */
  protected abstract createInsight(data: TData): MemoryInsight<TData>;

  /**
   * Check if data is already in structured format.
   * Override this to provide type-specific validation.
   */
  protected abstract isStructuredData(data: any): data is TData;

  /**
   * Format a single memory for context display.
   * Override this to customize formatting per memory type.
   */
  protected abstract formatSingleMemory(memory: MemoryInsight, index: number): string;
}