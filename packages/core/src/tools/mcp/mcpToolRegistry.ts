import { Tool } from '../types';
import { MCPClient } from './mcpClient';
import { MCPToolWrapper } from './mcpToolWrapper';
import { MCPServerConfig, MCPToolConfig } from './types';

export class MCPToolRegistry {
  private clients = new Map<string, MCPClient>();
  private tools = new Map<string, MCPToolWrapper>();
  private config?: Omit<MCPToolConfig, 'serverName'>;

  constructor(config?: Omit<MCPToolConfig, 'serverName'>) {
    this.config = config;
  }

  async addServer(serverConfig: MCPServerConfig): Promise<MCPToolWrapper[]> {
    if (this.clients.has(serverConfig.name)) {
      throw new Error(`MCP server "${serverConfig.name}" already registered`);
    }

    const client = new MCPClient(serverConfig);
    await client.connect();

    this.clients.set(serverConfig.name, client);

    const mcpTools = await client.listTools();
    const wrappers: MCPToolWrapper[] = [];

    for (const toolDef of mcpTools) {
      const wrapper = new MCPToolWrapper(toolDef, client, {
        ...this.config,
        serverName: serverConfig.name
      });
      this.tools.set(wrapper.name, wrapper);
      wrappers.push(wrapper);
    }

    return wrappers;
  }

  async removeServer(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (!client) return;

    // Remove all tools from this server
    for (const [toolName] of this.tools) {
      if (toolName.startsWith(`${name}_`)) {
        this.tools.delete(toolName);
      }
    }

    await client.disconnect();
    this.clients.delete(name);
  }

  getTool(name: string): MCPToolWrapper | undefined {
    return this.tools.get(name);
  }

  getTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  getServerNames(): string[] {
    return Array.from(this.clients.keys());
  }

  async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.clients.values())
      .map(client => client.disconnect());
    
    await Promise.all(disconnectPromises);
    this.clients.clear();
    this.tools.clear();
  }
}
