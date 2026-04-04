import { BaseTool, Tool, ToolResult, ToolCategory, ToolParameter } from '@ai-agent/core';
import { TaskService } from './taskService';

export const TASK_QUERY_CATEGORY: ToolCategory = {
  name: 'task_query',
  description: 'Tools for querying tasks and task execution history',
  keywords: ['task', 'search', 'query', 'history', 'run', 'execution']
};

export interface TaskQueryParams extends Record<string, unknown> {
  query?: string;
  status?: string;
  limit?: number;
}

export interface TaskRunQueryParams extends Record<string, unknown> {
  taskId?: string;
  runId?: string;
  limit?: number;
}

// Search tasks tool (definition + implementation)
export class SearchTasksTool extends BaseTool<TaskQueryParams> {
  name = 'search_tasks';
  category = TASK_QUERY_CATEGORY;
  description = 'Search for tasks by description, status, or other criteria. Returns a list of matching tasks with their IDs, descriptions, status, and creation dates.';

  parameters: ToolParameter[] = [
    {
      name: 'query',
      description: 'Search query to match against task descriptions',
      required: false,
      type: 'string'
    },
    {
      name: 'status',
      description: 'Filter by task status (pending, planning, completed, failed)',
      required: false,
      type: 'string'
    },
    {
      name: 'limit',
      description: 'Maximum number of results to return (default: 10)',
      required: false,
      type: 'number'
    }
  ];

  constructor(
    private readonly taskService: TaskService,
    private readonly tenantId: string
  ) {
    super();
  }

  async execute(params: TaskQueryParams): Promise<ToolResult> {
    try {
      const tasks = await this.taskService.getAllTasks(this.tenantId);
      let filtered = tasks;

      // Apply query filter
      if (params.query) {
        const query = String(params.query).toLowerCase();
        filtered = filtered.filter((t: any) =>
          String(t.description || '').toLowerCase().includes(query) ||
          String(t.id || '').toLowerCase().includes(query)
        );
      }

      // Apply status filter
      if (params.status) {
        filtered = filtered.filter((t: any) => t.status === params.status);
      }

      // Apply limit
      const limit = params.limit || 10;
      filtered = filtered.slice(0, limit);

      return {
        success: true,
        result: filtered.map((t: any) => ({
          id: t.id,
          description: t.description,
          status: t.status,
          agentId: t.agentId,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt
        })),
        message: `Found ${filtered.length} task(s)`
      };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Failed to search tasks',
        message: 'Error occurred while searching tasks'
      };
    }
  }
}

// Get task details tool (definition + implementation)
export class GetTaskDetailsTool extends BaseTool<{ taskId: string }> {
  name = 'get_task_details';
  category = TASK_QUERY_CATEGORY;
  description = 'Get detailed information about a specific task including its description, status, plan, agent, and all associated metadata.';

  parameters: ToolParameter[] = [
    {
      name: 'taskId',
      description: 'The ID of the task to retrieve',
      required: true,
      type: 'string'
    }
  ];

  constructor(
    private readonly taskService: TaskService,
    private readonly tenantId: string
  ) {
    super();
  }

  async execute(params: { taskId: string }): Promise<ToolResult> {
    try {
      const task = await this.taskService.getTask(params.taskId, this.tenantId);
      if (!task) {
        return {
          success: false,
          error: `Task ${params.taskId} not found`,
          message: 'Task does not exist'
        };
      }

      return {
        success: true,
        result: task,
        message: 'Task details retrieved'
      };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Failed to get task details',
        message: 'Error occurred while retrieving task details'
      };
    }
  }
}

// Search task runs tool (definition + implementation)
export class SearchTaskRunsTool extends BaseTool<TaskRunQueryParams> {
  name = 'search_task_runs';
  category = TASK_QUERY_CATEGORY;
  description = 'Search for task execution runs. Can filter by taskId to get all runs for a specific task, or get a specific run by runId. Returns execution history with status, start/end times, and results.';

  parameters: ToolParameter[] = [
    {
      name: 'taskId',
      description: 'Filter runs by task ID',
      required: false,
      type: 'string'
    },
    {
      name: 'runId',
      description: 'Get a specific run by its ID',
      required: false,
      type: 'string'
    },
    {
      name: 'limit',
      description: 'Maximum number of results to return (default: 10)',
      required: false,
      type: 'number'
    }
  ];

  constructor(
    private readonly taskService: TaskService,
    private readonly tenantId: string
  ) {
    super();
  }

  async execute(params: TaskRunQueryParams): Promise<ToolResult> {
    try {
      let runs: any[];

      if (params.runId) {
        const run = await this.taskService.getTaskRun(params.runId, this.tenantId);
        runs = run ? [run] : [];
      } else if (params.taskId) {
        runs = await this.taskService.getTaskRuns(params.taskId, this.tenantId);
      } else {
        runs = await this.taskService.getAllTaskRuns(this.tenantId);
      }

      // Apply limit
      const limit = params.limit || 10;
      runs = runs.slice(0, limit);

      return {
        success: true,
        result: runs.map(r => ({
          id: r.id,
          taskId: r.taskId,
          status: r.status,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
          result: r.result
        })),
        message: `Found ${runs.length} run(s)`
      };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Failed to search task runs',
        message: 'Error occurred while searching task runs'
      };
    }
  }
}

// Get task run details tool (definition + implementation)
export class GetTaskRunDetailsTool extends BaseTool<{ runId: string }> {
  name = 'get_task_run_details';
  category = TASK_QUERY_CATEGORY;
  description = 'Get detailed information about a specific task execution run including all steps, chain of thought, results, and feedback.';

  parameters: ToolParameter[] = [
    {
      name: 'runId',
      description: 'The ID of the task run to retrieve',
      required: true,
      type: 'string'
    }
  ];

  constructor(
    private readonly taskService: TaskService,
    private readonly tenantId: string
  ) {
    super();
  }

  async execute(params: { runId: string }): Promise<ToolResult> {
    try {
      const run = await this.taskService.getTaskRun(params.runId, this.tenantId);
      if (!run) {
        return {
          success: false,
          error: `Task run ${params.runId} not found`,
          message: 'Task run does not exist'
        };
      }

      return {
        success: true,
        result: run,
        message: 'Task run details retrieved'
      };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Failed to get task run details',
        message: 'Error occurred while retrieving task run details'
      };
    }
  }
}

/**
 * Creates task query tools with API implementations
 */
export function createTaskQueryTools(taskService: TaskService, tenantId: string): Tool[] {
  return [
    new SearchTasksTool(taskService, tenantId),
    new GetTaskDetailsTool(taskService, tenantId),
    new SearchTaskRunsTool(taskService, tenantId),
    new GetTaskRunDetailsTool(taskService, tenantId)
  ];
}
