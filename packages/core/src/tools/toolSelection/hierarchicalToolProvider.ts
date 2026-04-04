import { Tool } from '../types';
import { ListToolDetailsTool } from './listToolDetailsTool';
import { BaseToolProvider } from './baseToolProvider';

/**
 * Tool provider that uses list_tool_details for tool discovery.
 * 
 * The model calls list_tool_details to get full specs before using tools.
 * Tools are organized by category in the system prompt.
 */
export class HierarchicalToolProvider extends BaseToolProvider {
  private readonly listToolDetailsTool: ListToolDetailsTool;

  constructor(tools: Tool[]) {
    super(tools);

    // Create the list_tool_details meta-tool
    this.listToolDetailsTool = new ListToolDetailsTool(
      (name) => this.toolsMap.get(name)
    );
  }

  /**
   * Get the list_tool_details meta-tool.
   */
  override getMetaTool(): Tool {
    return this.listToolDetailsTool;
  }

  /**
   * Generate the tools section with list_tool_details instructions.
   */
  override generateToolsPromptSection(): string {
    return `${this.generateToolsByCategoryPromptLines()}
Use "list_tool_details" with tool names (NOT server names) to get their full descriptions and parameters before using them.`;
  }
}
