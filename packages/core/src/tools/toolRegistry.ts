import { Tool, ToolResult } from "./types";
import { BaseTool } from "./baseTool";

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  constructor(tools: Tool[] = []) {
    this.tools = new Map(tools.map(tool => {
      return [tool.name, tool];
    }));
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getTools(): Tool[] {
    return [...Array.from(this.tools.values())];
  }

  updateNotificationCallback(callback: (message: string) => Promise<void>): void {
    for (const tool of this.getTools()) {
      if (tool instanceof BaseTool) {
        tool.notificationCallback = callback;
      }
    }
  }

  async execute(name: string, params: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.getTool(name);
    if (!tool) {
      return {
        success: false,
        message: `Tool not found: ${name}`,
        error: `Tool not found: ${name}`
      };
    }

    try {
      return await tool.execute(params);
    } catch (error) {
      return {
        success: false,
        message: `Error executing tool ${name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }
}