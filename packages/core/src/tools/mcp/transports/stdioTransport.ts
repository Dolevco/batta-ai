import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MCPStdioServerConfig } from '../types';

function buildEnv(configEnv?: Record<string, string>): Record<string, string> | undefined {
  if (!configEnv) return undefined;
  
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return { ...env, ...configEnv };
}

export function createStdioTransport(config: MCPStdioServerConfig): StdioClientTransport {
  return new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: buildEnv(config.env)
  });
}
