import { execSync } from 'child_process';
import { Tool, ToolCategory } from '../types';
import { MCPToolRegistry } from './mcpToolRegistry';

/**
 * Docker MCP Server info from `docker mcp server inspect`
 */
export interface DockerMCPServerInfo {
  name: string;
  description: string;
  tools: DockerMCPToolInfo[];
}

export interface DockerMCPToolInfo {
  name: string;
  description: string;
  arguments: DockerMCPToolArgument[];
}

export interface DockerMCPToolArgument {
  name: string;
  desc: string;
  type: string;
  optional?: boolean;
}

interface DockerInspectResult {
  tools: Array<{
    name: string;
    description: string;
    arguments?: DockerMCPToolArgument[];
  }>;
  readme?: string;
}

/**
 * Load Docker MCP toolkit servers and create categories for each.
 * 
 * Uses:
 * - `docker mcp server ls` to list available servers
 * - `docker mcp server inspect <name>` to get server details
 */
export class DockerMCPLoader {
  private serverCache = new Map<string, DockerMCPServerInfo>();

  async loadDockerMCPServers(): Promise<Tool[]> {
    const serverNames = this.listServers();
    if (serverNames.length === 0) {
        console.log('   No Docker MCP servers found');
        return [];
    }

    const mcpRegistry = new MCPToolRegistry();
    try {
        await mcpRegistry.addServer({
            name: 'docker-mcp',
            transport: 'stdio',
            command: 'docker',
            args: ['mcp', 'gateway', 'run'],
            });

        console.log('✅ Connected to Docker MCP gateway');
    } catch (error) {
        console.error('❌ Failed to connect to Docker MCP gateway:', error);
        return [];
    }

    const tools = mcpRegistry.getTools();
    
    for (const name of serverNames) {
        const info = this.inspectServer(name);
        if (info) {
            info.tools.forEach(tool => {
                const mcpTool = tools.find(t => t.name === tool.name && t.description.includes(tool.description.substring(15)));
                if (mcpTool) {
                    mcpTool.category = { name: info.name, description: info.description, keywords: [] };
                }
            });
        }
    }

    return tools;
  }

  /**
   * List all available Docker MCP servers.
   */
  listServers(): string[] {
    try {
      const output = execSync('docker mcp server ls', { 
        encoding: 'utf-8',
        timeout: 10000 
      }).trim();

      if (!output) return [];

      // Output format: "server1, server2, server3"
      return output.split(',').map(s => s.trim()).filter(Boolean);
    } catch (error) {
      console.error('DockerMCPLoader: Failed to list servers', error);
      return [];
    }
  }

  /**
   * Inspect a Docker MCP server to get its tools and description.
   */
  inspectServer(serverName: string): DockerMCPServerInfo | null {
    // Check cache first
    if (this.serverCache.has(serverName)) {
      return this.serverCache.get(serverName)!;
    }

    try {
      const output = execSync(`docker mcp server inspect ${serverName}`, {
        encoding: 'utf-8',
        timeout: 10000
      }).trim();

      const result: DockerInspectResult = JSON.parse(output);

      // Extract description from readme or create a default
      const description = this.extractDescription(result.readme, serverName);

      const serverInfo: DockerMCPServerInfo = {
        name: serverName,
        description,
        tools: result.tools.map(t => ({
          name: t.name,
          description: t.description,
          arguments: t.arguments || []
        }))
      };

      this.serverCache.set(serverName, serverInfo);
      return serverInfo;
    } catch (error) {
      console.error(`DockerMCPLoader: Failed to inspect server "${serverName}"`, error);
      return null;
    }
  }

  /**
   * Load all Docker MCP servers and return their info.
   */
  loadAllServers(): DockerMCPServerInfo[] {
    const serverNames = this.listServers();
    const servers: DockerMCPServerInfo[] = [];

    for (const name of serverNames) {
      const info = this.inspectServer(name);
      if (info) {
        servers.push(info);
      }
    }

    return servers;
  }

  /**
   * Create a ToolCategory for a Docker MCP server.
   */
  createCategoryForServer(serverInfo: DockerMCPServerInfo): ToolCategory {
    return {
      name: serverInfo.name,
      description: serverInfo.description,
      keywords: this.extractKeywords(serverInfo),
      tools: serverInfo.tools.map(t => `${serverInfo.name}_${t.name}`)
    };
  }

  /**
   * Load all Docker MCP servers and create categories for each.
   */
  loadCategories(): ToolCategory[] {
    const servers = this.loadAllServers();
    return servers.map(s => this.createCategoryForServer(s));
  }

  /**
   * Extract a short description from the README.
   */
  private extractDescription(readme: string | undefined, serverName: string): string {
    if (!readme) {
      return `Tools from ${serverName} MCP server`;
    }

    // Try to extract first paragraph after the title
    const lines = readme.split('\n').filter(l => l.trim());

    // Skip the title (usually starts with #)
    let startIdx = 0;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#') && !lines[i].startsWith('[')) {
        startIdx = i;
        break;
      }
    }

    // Get the first meaningful line
    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && !line.startsWith('|') && !line.startsWith('-') && line.length > 20) {
        // Truncate if too long
        return line.length > 100 ? line.substring(0, 100) + '...' : line;
      }
    }

    return `Tools from ${serverName} MCP server`;
  }

  /**
   * Extract keywords from server info for category matching.
   */
  private extractKeywords(serverInfo: DockerMCPServerInfo): string[] {
    const keywords = new Set<string>();

    // Add server name parts
    serverInfo.name.split(/[-_]/).forEach(part => {
      if (part.length > 2) keywords.add(part.toLowerCase());
    });

    // Add tool names
    for (const tool of serverInfo.tools) {
      tool.name.split(/[-_]/).forEach(part => {
        if (part.length > 2) keywords.add(part.toLowerCase());
      });
    }

    // Add common words from description
    const descWords = serverInfo.description.toLowerCase().split(/\s+/);
    const importantWords = ['search', 'fetch', 'create', 'update', 'delete', 'list', 'get', 'issue', 'pr', 'pull', 'push', 'commit', 'branch', 'repo', 'file', 'web', 'api'];
    for (const word of descWords) {
      if (importantWords.includes(word)) {
        keywords.add(word);
      }
    }

    return Array.from(keywords);
  }

  /**
   * Clear the server cache.
   */
  clearCache(): void {
    this.serverCache.clear();
  }
}

/**
 * Singleton instance for convenience.
 */
export const dockerMCPLoader = new DockerMCPLoader();