/**
 * TodoStore: in-memory shared state for a task's todo list.
 *
 * Structured Todo / Task List Tool.
 *
 * The store is shared between TodoTool (write) and TodoReadTool (read)
 * so both tools operate on the same list during a task run.
 *
 * Security note: The todo list contains task descriptions derived from user input
 * and LLM output. It is in-memory only and not persisted between sessions.
 */

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  createdAt: number;
  updatedAt: number;
}

export class TodoStore {
  private items: TodoItem[] = [];
  private maxItems = 100; // Prevent unbounded growth (DoS protection)

  /**
   * Replace the entire todo list with a new set of items.
   * Validates input length to prevent oversized content.
   */
  set(items: TodoItem[]): void {
    if (items.length > this.maxItems) {
      throw new Error(`Todo list cannot exceed ${this.maxItems} items`);
    }
    this.items = items.map(item => ({
      ...item,
      // Sanitize content length
      content: String(item.content ?? '').substring(0, 1000)
    }));
  }

  get(): TodoItem[] {
    return [...this.items];
  }

  getInProgress(): TodoItem[] {
    return this.items.filter(i => i.status === 'in_progress');
  }

  getPending(): TodoItem[] {
    return this.items.filter(i => i.status === 'pending');
  }

  getCompleted(): TodoItem[] {
    return this.items.filter(i => i.status === 'completed');
  }

  formatAsText(): string {
    if (this.items.length === 0) return 'No tasks in the todo list.';
    return this.items
      .map(item => {
        const icon = item.status === 'completed' ? '✅' : item.status === 'in_progress' ? '🔄' : '⏳';
        return `${icon} [${item.id}] ${item.content} (${item.status})`;
      })
      .join('\n');
  }
}
