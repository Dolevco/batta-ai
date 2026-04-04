import { BaseTool } from '../baseTool';
import { ToolCategory, ToolParameter, ToolResult } from '../types';
import { MCPClient } from './mcpClient';
import { MCPToolConfig } from './types';
import { Tool as MCPToolDefinition } from '@modelcontextprotocol/sdk/types.js';

export class MCPToolWrapper extends BaseTool<Record<string, unknown>> {
  readonly name: string;
  readonly category: ToolCategory;
  readonly description: string;
  readonly parameters: ToolParameter[];

  private client: MCPClient;
  private originalName: string;

  constructor(toolDef: MCPToolDefinition, client: MCPClient, config?: MCPToolConfig) {
    super(config);
    this.client = client;
    this.originalName = toolDef.name;
    
    // Prefix tool name with server name to avoid collisions
    this.name = toolDef.name;
    this.category = { name: client.serverName, description: 'mcp server', keywords: [] }; // TODO: real description
    this.description = toolDef.description || `MCP tool: ${toolDef.name}`;
    this.parameters = this.convertSchema(toolDef.inputSchema);
  }

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      try {
        const result = await this.client.callTool(this.originalName, params);

        if (result.isError) {
          const errorText = result.content
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('\n');

          return {
            success: false,
            message: `MCP tool ${this.originalName} failed`,
            error: errorText || 'Unknown MCP error'
          };
        }

        const textContent = result.content
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join('\n');

        return {
          success: true,
          message: `MCP tool ${this.originalName} executed successfully`,
          result: textContent || result.content
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to execute MCP tool ${this.originalName}`,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });
  }

  private convertSchema(schema: MCPToolDefinition['inputSchema']): ToolParameter[] {
    if (!schema || typeof schema !== 'object') {
      return [];
    }

    const properties = (schema as any).properties || {};
    const required = (schema as any).required || [];

    return Object.entries(properties).map(([name, prop]: [string, any]) => ({
      name,
      description: prop.description || '',
      required: required.includes(name),
      type: this.mapJsonType(prop.type)
    }));
  }

  private mapJsonType(jsonType: string): 'string' | 'number' | 'boolean' | 'object' {
    switch (jsonType) {
      case 'string': return 'string';
      case 'number':
      case 'integer': return 'number';
      case 'boolean': return 'boolean';
      default: return 'object';
    }
  }
}
