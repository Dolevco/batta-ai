import { v4 as uuidv4 } from 'uuid';
import { BaseTool } from '../baseTool';
import { ToolCategory, ToolParameter, ToolResult } from '../types';
import { TodoStore, TodoStatus, TodoItem } from './todoStore';

/**
 * The todo list category.
 * Structured Todo / Task List Tool.
 */
export const TodoCategory: ToolCategory = {
  name: 'todo',
  description: 'Structured task list management for multi-step work',
  keywords: ['todo', 'task', 'checklist', 'progress', 'plan']
};

interface TodoWriteParams extends Record<string, unknown> {
  todos: Array<{
    id?: string;
    content: string;
    status: string;
  }>;
}

/**
 * TodoTool: creates and updates the task's structured todo list.
 *
 * Structured Todo / Task List Tool.
 *
 * When to use:
 *   - Complex multi-step tasks (3+ distinct steps)
 *   - Non-trivial tasks that benefit from tracking
 *   - User explicitly requests a todo list
 *   - User provides multiple tasks (numbered or comma-separated)
 *   - After receiving new instructions — capture immediately
 *
 * Rules:
 *   - Mark in_progress BEFORE beginning each item
 *   - Mark completed AFTER finishing each item
 *   - Only ONE item in_progress at a time
 *   - Add discovered follow-up tasks as they are found
 *
 * isConcurrencySafe = false: writes to shared state — must be sequential.
 *
 * Security note:
 *   - Input content is sanitized in TodoStore.set() to max 1000 chars per item
 *   - Max 100 items enforced to prevent DoS
 *   - No external calls or file I/O
 */
export class TodoTool extends BaseTool<TodoWriteParams> {
  readonly name = 'todo_write';
  readonly category = TodoCategory;
  readonly description = 'Create and update the structured task todo list. Use proactively for complex or multi-step tasks (3+ steps). Full replacement semantics: the provided list becomes the new complete todo list.';
  readonly parameters: ToolParameter[] = [
    {
      name: 'todos',
      description: 'The complete, updated todo list. Each item must have: content (string), status ("pending" | "in_progress" | "completed"), and optionally an id (auto-generated if omitted). Only ONE item may have status "in_progress" at a time.',
      required: true,
      type: 'array'
    }
  ];
  readonly isConcurrencySafe = false;
  readonly whenToUse = 'Use for tasks with 3+ distinct steps, when tracking multiple sub-goals, or when the user provides multiple tasks. Mark items in_progress BEFORE starting, completed AFTER finishing.';

  constructor(private todoStore: TodoStore) {
    super();
  }

  async execute(params: TodoWriteParams): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      if (!Array.isArray(params.todos)) {
        return { success: false, message: 'todos must be an array' };
      }

      // Validate status values
      const validStatuses: TodoStatus[] = ['pending', 'in_progress', 'completed'];
      for (const item of params.todos) {
        if (!validStatuses.includes(item.status as TodoStatus)) {
          return {
            success: false,
            message: `Invalid status "${item.status}". Must be one of: pending, in_progress, completed`
          };
        }
      }

      // Enforce only one in_progress item
      const inProgressItems = params.todos.filter(t => t.status === 'in_progress');
      if (inProgressItems.length > 1) {
        return {
          success: false,
          message: `Only ONE item may be in_progress at a time. Found ${inProgressItems.length} items with status "in_progress".`
        };
      }

      const now = Date.now();
      const existing = new Map(this.todoStore.get().map(i => [i.id, i]));

      const newItems: TodoItem[] = params.todos.map(item => {
        const id = item.id || uuidv4();
        const prev = existing.get(id);
        return {
          id,
          content: String(item.content ?? '').substring(0, 1000),
          status: item.status as TodoStatus,
          createdAt: prev?.createdAt ?? now,
          updatedAt: now
        };
      });

      this.todoStore.set(newItems);

      const summary = `Todo list updated: ${newItems.filter(i => i.status === 'pending').length} pending, ${newItems.filter(i => i.status === 'in_progress').length} in_progress, ${newItems.filter(i => i.status === 'completed').length} completed`;
      return {
        success: true,
        message: summary,
        result: this.todoStore.formatAsText()
      };
    });
  }
}

/**
 * TodoReadTool: reads the current task todo list.
 *
 * isConcurrencySafe = true: read-only access to shared state.
 */
export class TodoReadTool extends BaseTool<Record<string, never>> {
  readonly name = 'todo_read';
  readonly category = TodoCategory;
  readonly description = 'Read the current task todo list to see what has been planned, what is in progress, and what has been completed.';
  readonly parameters: ToolParameter[] = [];
  readonly isConcurrencySafe = true;
  readonly whenToUse = 'Check the current task list before starting work to understand scope, or before marking an item completed to confirm it is the right one.';

  constructor(private todoStore: TodoStore) {
    super();
  }

  async execute(_params: Record<string, never>): Promise<ToolResult> {
    const items = this.todoStore.get();
    if (items.length === 0) {
      return {
        success: true,
        message: 'Todo list is empty. Use todo_write to create tasks.',
        result: 'No tasks in the todo list.'
      };
    }
    return {
      success: true,
      message: `Todo list has ${items.length} items`,
      result: this.todoStore.formatAsText()
    };
  }
}
