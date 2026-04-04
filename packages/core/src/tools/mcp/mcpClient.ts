import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { MCPServerConfig, MCPCallToolResult } from './types';
import { createHttpTransport } from './transports/httpStreamTransport';
import { createStdioTransport } from './transports/stdioTransport';
import { Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js';

export class MCPClient {
  private client: Client;
  private transport: Transport | null = null;
  private connected = false;

  readonly config: MCPServerConfig;

  constructor(config: MCPServerConfig) {
    this.config = config;
    this.client = new Client(
      { name: `ai-agent-${config.name}`, version: '1.0.0' },
      { capabilities: {} }
    );
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    this.transport = this.config.transport === 'http'
      ? createHttpTransport(this.config)
      : createStdioTransport(this.config);

    await this.client.connect(this.transport);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected || !this.transport) return;

    await this.client.close();
    this.connected = false;
    this.transport = null;
  }

  async listTools(): Promise<MCPTool[]> {
    await this.ensureConnected();
    const result = await this.client.listTools();
    return result.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPCallToolResult> {
    await this.ensureConnected();
    const result = await this.client.callTool({ name, arguments: args });
    return result as MCPCallToolResult;
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await this.connect();
    }
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get serverName(): string {
    return this.config.name;
  }
}
