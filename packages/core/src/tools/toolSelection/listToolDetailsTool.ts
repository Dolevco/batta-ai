import { BaseTool } from "../baseTool";
import { Tool, ToolCategory, ToolConfig, ToolParameter, ToolResult } from "../types";

export const TOOL_SELECTION_CATEGORY: ToolCategory = {
  name: 'tool_selection',
  description: 'Tools for discovering and understanding available tools',
  keywords: ['list', 'details', 'tools', 'discover']
};

/**
 * Meta-tool that returns full details for specified tools.
 */
export class ListToolDetailsTool extends BaseTool<{ tools: string[]; [key: string]: unknown }> {
  name = 'list_tool_details';
  category = TOOL_SELECTION_CATEGORY;
  description = 
    'Get full details (description and parameters) for specific tools. ' +
    'Use this before calling a tool to understand its parameters.';

  parameters: ToolParameter[] = [
    {
      name: 'tools',
      description: 'Array of tool names (category name is not supported) to get details for',
      required: true,
      type: 'object'
    }
  ];

  private toolLookup: (name: string) => Tool | undefined;

  constructor(toolLookup: (name: string) => Tool | undefined, config?: ToolConfig) {
    super(config);
    this.toolLookup = toolLookup;
  }

  async execute(params: { tools: string[] }): Promise<ToolResult> {
    const toolNames = params.tools.map(name => name.includes('.') ? name.split('.')[1] : name);

    if (!toolNames || !Array.isArray(toolNames) || toolNames.length === 0) {
      return {
        success: false,
        message: 'Please provide an array of tool names',
        error: 'Missing or invalid "tools" parameter'
      };
    }

    const results: string[] = [];
    const notFound: string[] = [];

    for (const name of toolNames) {
      const tool = this.toolLookup(name);
      if (tool) {
        results.push(this.formatTool(tool));
      } else {
        notFound.push(name);
      }
    }

    let message = results.length > 0 
      ? `Tool Details:\n\n${results.join('\n\n---\n\n')}`
      : 'No tools found';

    if (notFound.length > 0) {
      message += `\n\nNot found: ${notFound.join(', ')}`;
    }

    return { success: results.length > 0, message };
  }

  private formatTool(tool: Tool): string {
    const params = tool.parameters.length > 0
      ? tool.parameters.map(p => 
          `  - ${p.name} (${p.type}${p.required ? ', required' : ''}): ${p.description}`
        ).join('\n')
      : '  (no parameters)';

    return `[${tool.name}]\n${tool.description}\nParameters:\n${params}`;
  }
}