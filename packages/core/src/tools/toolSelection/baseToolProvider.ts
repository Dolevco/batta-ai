import { InteractionsCategory } from '../interactions/chatTools';
import { TaskCompletionCategory } from '../task/taskCompletionTool';
import { Tool, ToolCategory } from '../types';

/**
 * Base class for tool providers that organize tools by category.
 * 
 * Provides shared functionality:
 * 1. Tool registration and retrieval
 * 2. Grouping tools by category
 * 3. Generating prompt sections for tool categories
 * 
 * Subclasses implement the meta-tool specific behavior:
 * - HierarchicalToolProvider: uses list_tool_details
 * - DelegatingToolProvider: uses delegate_task
 */
export abstract class BaseToolProvider {
  protected readonly toolsMap = new Map<string, Tool>();

  constructor(tools: Tool[]) {
    for (const tool of tools) {
      this.toolsMap.set(tool.name, tool);
    }
  }

  /**
   * Add tools dynamically (e.g., from MCP servers).
   */
  addTools(tools: Tool[]): void {
    for (const tool of tools) {
      this.toolsMap.set(tool.name, tool);
    }
  }

  /**
   * Get a tool by name.
   */
  getTool(name: string): Tool | undefined {
    return this.toolsMap.get(name);
  }

  /**
   * Get all registered tools (excluding meta-tools).
   */
  getAllTools(): Tool[] {
    return Array.from(this.toolsMap.values());
  }

  /**
   * Get the meta-tool for this provider (e.g., list_tool_details or delegate_task).
   * Subclasses must implement this.
   */
  abstract getMetaTool(): Tool;

  /**
   * Get all tools plus the meta-tool.
   */
  getAllToolsWithMetaTool(): Tool[] {
    return [...this.getAllTools(), this.getMetaTool()];
  }

  /**
   * Get always-available tools (meta-tool + tools in TaskCompletionCategory).
   */
  getAlwaysAvailableTools(): Tool[] {
    const alwaysAvailable = this.getAllTools().filter(
      tool => tool.category.name === TaskCompletionCategory.name
    );
    return [...alwaysAvailable, this.getMetaTool()];
  }

  /**
   * Group tools by their category name (excluding always-available tools).
   */
  protected getToolsByCategory(): Map<string, { category: ToolCategory; tools: Tool[] }> {
    const byCategory = new Map<string, { category: ToolCategory; tools: Tool[] }>();
    
    const alwaysAvailableTools = this.getAlwaysAvailableTools();
    const categorizedTools = this.getAllTools().filter(
      tool => !alwaysAvailableTools.some(t => t.name === tool.name) && tool.category !== InteractionsCategory
    );

    for (const tool of categorizedTools) {
      const categoryName = tool.category.name;
      const existing = byCategory.get(categoryName);
      if (existing) {
        existing.tools.push(tool);
      } else {
        byCategory.set(categoryName, { category: tool.category, tools: [tool] });
      }
    }
    
    return byCategory;
  }

  /**
   * Generate prompt lines listing tools by category.
   * Each tool is shown with a truncated description for better tool selection.
   */
  generateToolsByCategoryPromptLines(): string {
    const toolsByCategory = this.getToolsByCategory();
    if (toolsByCategory.size === 0) {
      return "There are NO tools you can pass to delegated task."
    }

    const lines: string[] = ['AVAILABLE TOOLS (by category):', ''];

    const sortedCategories = Array.from(toolsByCategory.keys()).sort();

    for (const categoryName of sortedCategories) {
      const { category, tools } = toolsByCategory.get(categoryName)!;
      
      lines.push(`Category: ${category.name}`);
      lines.push(`Description:${category.description}`);
      lines.push('');
      
      // List each tool with a short description
      for (const tool of tools.sort((a, b) => a.name.localeCompare(b.name))) {
        const shortDesc = this.truncateDescription(tool.description, 300);
        lines.push(`- ${tool.name}: ${shortDesc}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Truncate a description to a maximum length, adding ellipsis if needed.
   */
  private truncateDescription(description: string, maxLength: number): string {
    // Get first line only (remove any line breaks)
    const lines = description.split('\n');
    const firstLine = lines.find(line => line.trim().length > 0)?.trim() ?? '';
    
    if (firstLine.length <= maxLength) {
      return firstLine;
    }
    
    // Truncate at word boundary if possible
    const truncated = firstLine.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    
    if (lastSpace > maxLength * 0.7) {
      return truncated.substring(0, lastSpace) + '...';
    }
    
    return truncated + '...';
  }

  /**
   * Generate the tools section for the system prompt.
   * Subclasses should override to add meta-tool specific instructions.
   */
  abstract generateToolsPromptSection(): string;

  /**
   * Get category summary with tool counts.
   */
  getCategorySummary(): Array<{ category: string; description: string; toolCount: number; tools: string[] }> {
    const toolsByCategory = this.getToolsByCategory();
    
    return Array.from(toolsByCategory.entries())
      .map(([categoryName, { category, tools }]) => ({
        category: categoryName,
        description: category.description,
        toolCount: tools.length,
        tools: tools.map(t => t.name).sort()
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }
}
