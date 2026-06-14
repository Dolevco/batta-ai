import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { MCPHttpServerConfig } from '../types';

export function createHttpTransport(config: MCPHttpServerConfig): StreamableHTTPClientTransport {
  return new StreamableHTTPClientTransport(
    new URL(config.url),
    {
      requestInit: config.headers ? { headers: config.headers } : undefined
    }
  );
}
