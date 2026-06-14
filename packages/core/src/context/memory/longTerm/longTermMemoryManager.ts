import { ILLMApiHandler, IEmbeddingHandler } from '../../../llm';
import { Message } from '../../../task/types';
import { LongTermMemory } from './longTermMemory';
import { MemorySummarizer } from './memorySummarizer';
import { LongTermMemoryConfig, RetrievedMemory, MemorySummaryResult } from '../types';
import {
  buildConsolidationPrompt,
  parseConsolidationResponse,
  ConsolidationResult,
  StoredMemorySummary
} from './consolidationPrompt';

export interface LongTermMemoryManagerConfig extends LongTermMemoryConfig {
  /** Maximum input length before query extraction is applied (default: 200) */
  maxQueryLength?: number;
}

/**
 * High-level manager for long-term memory operations.
 * Combines vector storage, query extraction, and conversation evaluation.
 */
export class LongTermMemoryManager {
  private readonly memory: LongTermMemory;
  private readonly summarizer: MemorySummarizer;
  private readonly llmApi: ILLMApiHandler;
  private readonly maxQueryLength: number;

  constructor(
    llmApi: ILLMApiHandler,
    embeddingHandler: IEmbeddingHandler,
    config: LongTermMemoryManagerConfig
  ) {
    this.llmApi = llmApi;
    this.maxQueryLength = config.maxQueryLength ?? 200;
    this.memory = new LongTermMemory(embeddingHandler, config);
    this.summarizer = new MemorySummarizer(llmApi);
  }

  /**
   * Initialize the underlying vector database collection.
   */
  async initialize(): Promise<void> {
    await this.memory.initialize();
  }

  /**
   * Search for relevant memories based on user input.
   * Automatically extracts a concise query from long inputs.
   */
  async searchRelevantMemories(userInput: string): Promise<RetrievedMemory[]> {
    try {
      const searchQuery = await this.extractSearchQuery(userInput);
      return await this.memory.search(searchQuery);
    } catch (error) {
      console.error('LongTermMemoryManager: Failed to search memories', error);
      return [];
    }
  }

  /**
   * Evaluate a conversation and store it if valuable.
   * Returns the evaluation result.
   */
  async evaluateAndStore(conversationHistory: Message[]): Promise<MemorySummaryResult> {
    try {
      const result = await this.summarizer.evaluateConversation(conversationHistory);
      
      if (result.isValuable && result.summary) {
        await this.memory.store(result.summary, result.metadata);
        console.log(`LongTermMemoryManager: Stored valuable memory - ${result.reason}`);
      } else {
        console.log(`LongTermMemoryManager: Memory not stored - ${result.reason}`);
      }

      return result;
    } catch (error) {
      console.error('LongTermMemoryManager: Failed to evaluate/store memory', error);
      return {
        isValuable: false,
        reason: 'Evaluation failed due to an error'
      };
    }
  }

  /**
   * Format retrieved memories as context for the LLM.
   */
  formatMemoriesAsContext(memories: RetrievedMemory[]): string {
    return this.memory.formatMemoriesAsContext(memories);
  }

  /**
   * Get the count of stored memories.
   */
  async count(): Promise<number> {
    return this.memory.count();
  }

  /**
   * Delete a specific memory by ID.
   */
  async delete(id: string): Promise<void> {
    return this.memory.delete(id);
  }

  /**
   * Consolidate long-term memories by removing duplicates/stale entries.
   * Implements the "Dream Pattern" — a reflective pass over memories
   * to prune, merge, and update them for long-term quality.
   *
   * This is designed to be called at end-of-session or on a timer, non-blockingly.
   *
   * Security note:
   *   - Memory summaries are classified as "confidential" (see featureSecurityContext)
   *   - They are sent to the LLM API over HTTPS (inherited from ILLMApiHandler)
   *   - Consolidation writes go through postgres with auth required
   *   - Actions are validated/sanitized in parseConsolidationResponse before applying
   */
  async consolidate(): Promise<ConsolidationResult> {
    const result: ConsolidationResult = { removed: 0, merged: 0, updated: 0, actions: [] };

    try {
      const allMemories = await this.listAll();
      if (allMemories.length < 2) {
        // Nothing to consolidate with less than 2 memories
        return result;
      }

      const memorySummaries: StoredMemorySummary[] = allMemories.map(m => ({
        id: m.id,
        summary: m.summary,
        tags: m.metadata?.tags,
        createdAt: m.timestamp
      }));

      const prompt = buildConsolidationPrompt(memorySummaries);
      const response = await this.llmApi.createCompletion([
        { role: 'system', content: prompt },
        { role: 'user', content: 'Consolidate these memories. Return only the JSON array of actions.' }
      ] as any);

      const actions = parseConsolidationResponse((response as any).content || '');
      result.actions = actions;

      for (const action of actions) {
        try {
          if (action.action === 'delete' && action.id) {
            await this.memory.delete(action.id);
            result.removed++;
          } else if (action.action === 'update' && action.id && action.newSummary) {
            // Delete old entry and store updated one
            await this.memory.delete(action.id);
            await this.memory.store(action.newSummary);
            result.updated++;
          } else if (action.action === 'merge' && action.ids && action.ids.length >= 2 && action.newSummary) {
            // Delete all merged entries and store the combined one
            for (const id of action.ids) {
              await this.memory.delete(id);
            }
            await this.memory.store(action.newSummary);
            result.merged++;
            result.removed += action.ids.length;
          }
        } catch (actionErr) {
          console.error(`LongTermMemoryManager: Failed to apply consolidation action ${action.action}:`, actionErr instanceof Error ? actionErr.message : 'unknown');
          // Continue with other actions even if one fails
        }
      }

      console.log(`LongTermMemoryManager: Consolidation complete — removed: ${result.removed}, merged: ${result.merged}, updated: ${result.updated}`);
    } catch (error) {
      console.error('LongTermMemoryManager: Consolidation failed', error instanceof Error ? error.message : 'unknown');
    }

    return result;
  }

  /**
   * List all stored memories (used for consolidation).
   * Returns a simplified view without vector data.
   */
  async listAll(): Promise<RetrievedMemory[]> {
    try {
      return await this.memory.listAll();
    } catch (error) {
      console.error('LongTermMemoryManager: Failed to list all memories', error);
      return [];
    }
  }

  /**
   * Extract a concise search query from user input for vector database lookup.
   * Uses LLM to understand the core intent and create an optimal search query.
   */
  private async extractSearchQuery(userInput: string): Promise<string> {
    // If input is already short enough, use it directly
    if (userInput.length <= this.maxQueryLength) {
      return userInput;
    }

    try {
      const extractionPrompt = `Extract a concise search query (max 50 words) that captures the core intent and key concepts from this user input. Focus on the main problem, question, or task. Remove unnecessary details, examples, or verbose explanations.

User input: ${userInput}

Return only the search query, no explanation:`;

      const messages: Message[] = [
        { role: 'system', content: extractionPrompt }
      ];

      const response = await this.llmApi.createCompletion(messages);
      const extractedQuery = response.content.trim();

      // Fallback to truncated input if extraction fails or is too long
      if (!extractedQuery || extractedQuery.length > this.maxQueryLength) {
        return userInput.substring(0, this.maxQueryLength) + '...';
      }

      return extractedQuery;
    } catch (error) {
      console.error('LongTermMemoryManager: Failed to extract search query, using truncated input', error);
      // Fallback: use first maxQueryLength characters
      return userInput.substring(0, this.maxQueryLength) + '...';
    }
  }
}
