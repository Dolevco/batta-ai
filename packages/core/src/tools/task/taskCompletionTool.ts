import { ToolCategory, ToolParameter, ToolResult } from "../types";
import { BaseTool } from "../baseTool";

export const TaskCompletionToolName = 'task_complete';

export const TaskCompletionCategory: ToolCategory = {
  name: 'task_completion_tools',
  description: 'Tools used for completing tasks',
  keywords: []
};

export type TaskCompletionToolParams = {
  success: boolean;
  result: string;
  summary: string;
};

export class TaskCompletionTool extends BaseTool<TaskCompletionToolParams> {
  name = TaskCompletionToolName;
  category = TaskCompletionCategory;
  description = 'Mark task as complete';
  readonly isConcurrencySafe = false;
  
  parameters: ToolParameter[] = [
    {
      name: 'result',
      description: 'The task result output. A self-contained, detailed output of the task that another agent can use without prior context. If the system prompt included an expected output, include the exact returned output here',
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
      name: 'summary',
      description: 'Short summary of the task and steps taken. If the system prompt specified an expected output, explicitly state what was requested and briefly compare what was returned in `result` against that expectation (matches, partial, or differs)',
      required: true,
      type: 'string'
    }
  ];

  async execute(completionResult: TaskCompletionToolParams): Promise<ToolResult> {
    return this.wrapExecution(completionResult, async () => {
      await this.notify(`✅Task completed: ${completionResult.summary}`);
      return {
        success: completionResult.success,
        message: completionResult.summary,
        result: completionResult.result
      };
    });
  }
}
