import { ToolConfig } from '../types';

export type MCPTransportType = 'http' | 'stdio';

export interface MCPServerConfigBase {
  name: string;
  transport: MCPTransportType;
}

export interface MCPHttpServerConfig extends MCPServerConfigBase {
  transport: 'http';
  url: string;
  headers?: Record<string, string>;
}

export interface MCPStdioServerConfig extends MCPServerConfigBase {
  transport: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export type MCPServerConfig = MCPHttpServerConfig | MCPStdioServerConfig;

export interface MCPToolConfig extends ToolConfig {
  serverName: string;
}

export interface MCPCallToolResult {
  content: Array<{
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}
