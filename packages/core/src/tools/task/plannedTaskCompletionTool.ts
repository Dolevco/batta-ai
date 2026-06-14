import { ToolParameter, ToolResult } from "../types";
import { BaseTool } from "../baseTool";
import { TaskCompletionCategory } from "./taskCompletionTool";

export const PlannedTaskCompletionToolName = 'task_complete';

export type PlannedTaskCompletionToolParams = {
  success: boolean;
  result: string;
  summary: string;
  /** Optional structured metadata to pass to dependent tasks (e.g., repositoryName for dynamic code integration) */
  requiredOutput?: {
    repositoryName?: string;
    [key: string]: unknown;
  };
};

/**
 * Task completion tool for planned tasks with required output validation.
 * Validates that all required outputs (keys) are present in metadata.
 */
export class PlannedTaskCompletionTool extends BaseTool<PlannedTaskCompletionToolParams> {
  name = PlannedTaskCompletionToolName;
  category = TaskCompletionCategory;
  description = 'Mark task as complete';
  
  private requiredOutputs: Record<string, string>;
  
  parameters: ToolParameter[] = [
    {
      name: 'requiredOutput',
      description: 'structured output required from the task. for example: { "repositoryName": "myRepo" }. A self-contained, detailed output of the task that another agent can use without prior context. If the system prompt included an expected output, include the exact returned output here. do not fabricate data, if you cannot provide the requiredOutput, complete the task with success false',
      required: true,
      type: 'any'
    },
    {
      name: 'success',
      description: 'Boolean indicating that the task successfully completed all it was supposed to do. Partial or incomplete success should return false.',
      required: true,
      type: 'boolean'
    },
    {
      name: 'result',
      description: 'Short summary of the task and steps taken. If the system prompt specified an expected output, explicitly state what was requested and briefly compare what was returned in `requiredOutput` against that expectation (matches, partial, or differs)',
      required: true,
      type: 'string'
    }
  ];

  constructor(requiredOutputs: Record<string, string> = {}) {
    super();
    this.requiredOutputs = requiredOutputs;
    
    // Update description with required outputs if any
    const keys = Object.keys(requiredOutputs || {});
    if (keys.length > 0) {
      const list = keys.map(k => `${k}: ${requiredOutputs[k]}`).join('; ');
      this.parameters[0].description += `This task must provide the following requiredOutput keys: ${list}`;
    }
  }

  async execute(completionResult: PlannedTaskCompletionToolParams): Promise<ToolResult> {
    return this.wrapExecution(completionResult, async () => {
      // Validate required outputs are present
      const keys = Object.keys(this.requiredOutputs || {});
      if (keys.length > 0) {
        const missing: string[] = [];
        for (const requiredKey of keys) {
          if (!completionResult.requiredOutput || completionResult.requiredOutput[requiredKey] === undefined) {
            missing.push(requiredKey);
          }
        }
        
        if (missing.length > 0 && completionResult.success) {
          return {
            success: false,
            message: `Task completion failed: missing required outputs in requiredOutput: ${missing.join(', ')}`,
            error: `Required outputs not provided: ${missing.join(', ')}`
          };
        }
      }
      
      await this.notify(`✅Task completed: ${completionResult.summary}`);
      return {
        success: completionResult.success,
        message: completionResult.result,
        result: completionResult.result,
        requiredOutput: completionResult.requiredOutput
      };
    });
  }
}
