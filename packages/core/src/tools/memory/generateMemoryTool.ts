import { BaseTool } from '../baseTool';
import { ToolParameter, ToolResult } from '../types';
import { MemoryInsight } from '../../context/memory';
import { TaskCompletionCategory } from '../task/taskCompletionTool';

const GenerateMemoryToolName = 'memory_complete';

export type GenerateMemoryParams = {
  intent: string;
  data: Record<string, unknown>;
  executionPlan: string;
  outcome: string;
  insights: string;
  tags?: string[];
};

/**
 * Memory completion tool for validating structured memory insights.
 * Validates that all required fields are present in the memory data.
 * Works like PlannedTaskCompletionTool but for memory generation.
 */
export class GenerateMemoryTool extends BaseTool<GenerateMemoryParams> {
  name = GenerateMemoryToolName;
  category = TaskCompletionCategory;
  description = 'Complete memory generation and validate the structured memory insight';

  private memoryType: string;
  private requiredFields: Record<string, string>;

  parameters: ToolParameter[] = [
    {
      name: 'intent',
      description: 'A concise, searchable summary (1-2 sentences) optimized for semantic search. Answer: what would someone search for to find this memory?',
      required: true,
      type: 'string'
    },
    {
      name: 'executionPlan',
      description: 'The task run execution steps taken to complete the task including tools, so we can use it for future run',
      required: true,
      type: 'string'
    },
    {
      name: 'outcome',
      description: 'The results of the execution steps taken in the task run',
      required: true,
      type: 'string'
    },
    {
      name: 'data',
      description: 'Structured data matching the expected schema. This is the core content of the memory.',
      required: false,
      type: 'object'
    },
    {
      name: 'insights',
      description: 'Key lessons learned or actionable insights from this memory. include explaination of the execution plan - steps taken, what went good and what wrong',
      required: true,
      type: 'string'
    },
    {
      name: 'tags',
      description: 'Categorization tags for filtering (e.g., ["deployment", "docker", "success"])',
      required: false,
      type: 'object'
    }
  ];

  constructor(memoryType: string, requiredFields: Record<string, string> = {}) {
    super();
    this.memoryType = memoryType;
    this.requiredFields = requiredFields;

    // Update data parameter description with required fields if any
    const keys = Object.keys(requiredFields);
    if (keys.length > 0) {
      const list = keys.map(k => `${k}: ${requiredFields[k]}`).join('; ');
      this.parameters[1].required = true;
      this.parameters[1].description += `\n\nREQUIRED: The data object must contain the following fields: ${list}`;
    }
  }

  async execute(params: GenerateMemoryParams): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      const { intent, executionPlan, outcome, data, insights, tags } = params;

      // Validate data is present and is an object
      if (!data || typeof data !== 'object') {
        return {
          success: false,
          message: 'Data field must be a non-empty object',
          error: 'Invalid data field'
        };
      }

      // Validate required fields are present in data
      const keys = Object.keys(this.requiredFields);
      if (keys.length > 0) {
        const missing: string[] = [];
        for (const requiredKey of keys) {
          if (data[requiredKey] === undefined) {
            missing.push(requiredKey);
          }
        }

        if (missing.length > 0) {
          return {
            success: false,
            message: `Memory generation failed: missing required fields in data: ${missing.join(', ')}. Expected fields: ${keys.map(k => `${k} (${this.requiredFields[k]})`).join(', ')}`,
            error: `Required fields not provided: ${missing.join(', ')}`
          };
        }
      }

      // Build the validated insight
      const insight: MemoryInsight = {
        intent,
        executionPlan,
        outcome,
        data,
        insights,
        tags: tags || []
      };

      await this.notify(`✅ Memory generated: ${intent}`);
      return {
        success: true,
        message: `Generated ${this.memoryType} memory insight`,
        result: {
          insight
        }
      };
    });
  }
}