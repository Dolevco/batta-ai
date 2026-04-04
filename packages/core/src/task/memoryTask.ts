import { Task } from './task';
import { TaskConfig, TaskResult } from './types';
import { ILLMApiHandler } from '../api';
import { MemoryInsight } from '../context/memory';
import { getFullSystemPrompt } from '../context/prompts/system';
import { MODES } from '../context/prompts/modes';
import { GenerateMemoryTool } from '../tools/memory/generateMemoryTool';

/**
 * Configuration for MemoryTask
 */
export interface MemoryTaskConfig<TInput = unknown, TOutput = unknown> {
  /** Description of what kind of memory insight to generate */
  memoryType: string;
  /** Instructions for how to process the input data */
  processingInstructions: string;
  /** Schema description for the expected output structure */
  outputSchema: string;
  /** Required fields in the data object with their descriptions */
  requiredFields?: Record<string, string>;
  /** Example of expected output (optional, helps guide the LLM) */
  exampleOutput?: TOutput;
}

/**
 * MemoryTask generates structured memory insights from raw data.
 * 
 * This task takes any type of input data and generates a MemoryInsight
 * with a searchable summary, structured data, and insights.
 * 
 * Use cases:
 * - Converting task run data into searchable memories
 * - Processing plan generation outcomes
 * - Structuring feedback for future reference
 * - Any data that should be stored and queried later
 * 
 * @example
 * ```typescript
 * const memoryTask = new MemoryTask(api, {
 *   memoryType: 'task_run',
 *   processingInstructions: 'Extract key insights from this task execution',
 *   outputSchema: 'TaskRun with id, taskId, status, result, chainOfThoughts'
 * });
 * 
 * const insight = await memoryTask.generateInsight(taskRunData);
 * await longTermMemory.storeMemoryInsight(insight, 'task_run');
 * ```
 */
export class MemoryTask<TInput = unknown, TOutput = unknown> {
  private task: Task;
  private config: MemoryTaskConfig<TInput, TOutput>;

  constructor(
    api: ILLMApiHandler,
    config: MemoryTaskConfig<TInput, TOutput>
  ) {
    this.config = config;

    // Create the memory completion tool with required fields validation
    const generateMemoryTool = new GenerateMemoryTool(
      config.memoryType,
      config.requiredFields || {}
    );

    // Build custom instructions from the current configuration
    const customInstructions = this.buildCustomInstructions(config);

    // Build the system prompt using MEMORY_GENERATION mode before constructing the Task.
    const systemPrompt = getFullSystemPrompt(
      [generateMemoryTool],
      MODES.MEMORY_GENERATION,
      customInstructions
    );

    const taskConfig: TaskConfig = {
      _systemPrompt: systemPrompt,
      tools: [generateMemoryTool],
      maxIterations: 5 // Allow one retry if validation fails
    };

    this.task = new Task(api, taskConfig);
  }

  /**
   * Generate a memory insight from input data.
   * Returns a structured MemoryInsight ready to be stored.
   * 
   * @param input - The raw input data to process
   * @param intent - The original intent of the task/operation (helps with similarity search)
   */
  async generateInsight(input: TInput, intent?: string): Promise<MemoryInsight<TOutput>> {
    const prompt = this.buildPrompt(input, intent);
    const result = await this.task.execute<any>(prompt);

    if (!result.success || !result.completed) {
      throw new Error(`Failed to generate memory insight: ${result.summary}`);
    }

    // The result should contain the validated insight from the generate_memory tool
    if (result.result?.insight) {
      return result.result.insight as MemoryInsight<TOutput>;
    }

    // Fallback: try to parse from summary if tool wasn't used (shouldn't happen)
    throw new Error('Memory insight not generated properly. Tool execution may have failed.');
  }

  /**
   * Build custom instructions for the memory generation task
   */
  private buildCustomInstructions(config: MemoryTaskConfig<TInput, TOutput>): string {
    const exampleSection = config.exampleOutput 
      ? `\n\nExample output:\n${JSON.stringify(config.exampleOutput, null, 2)}`
      : '';

    const requiredFieldsSection = config.requiredFields && Object.keys(config.requiredFields).length > 0
      ? `${config.outputSchema}\n\nRequired fields in data object:\n${Object.entries(config.requiredFields).map(([key, desc]) => `  - ${key}: ${desc}`).join('\n')}${exampleSection}`
      : '';

    return `Memory Type: ${config.memoryType}
Processing Instructions: ${config.processingInstructions}
${requiredFieldsSection.length ? 'Expected Output Schema for the data field:\n' + requiredFieldsSection : ''}
To complete this task:
1. Analyze the provided input data carefully
2. Extract the essential information according to the instructions
3. Use the memory_complete tool to submit your result with:
   - intent:
   - outcome:
   - executionPlan
   - insights: Key lessons learned or actionable insights (required)
   - tags: Categorization tags (required)`;
  }

  /**
   * Build the user prompt with the input data
   */
  private buildPrompt(input: TInput, intent?: string): string {
    const inputStr = typeof input === 'string' 
      ? input 
      : JSON.stringify(input, null, 2);

    const intentSection = intent 
      ? `\n\nOriginal Intent/Goal: ${intent}\n` 
      : '';

    return `Generate a memory insight from the following data:
${intentSection}
${inputStr}
Analyze the data according to the instructions and use the memory_complete tool to submit your structured insight.${intent ? ' Make sure the summary captures the intent and outcome to enable similarity search for similar operations.' : ''}`;
  }
}