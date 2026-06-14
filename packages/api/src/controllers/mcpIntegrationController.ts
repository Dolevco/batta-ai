import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';
import type { IMCPIntegrationRepository } from '@batta/shared';
import type { 
  CreateMCPIntegrationRequest, 
  UpdateMCPIntegrationRequest, 
  MCPIntegration, 
  DockerMCPServer,
  MCPIntegrationDetails
} from '../types';
import { MCPClient } from '@batta/core';

export class MCPIntegrationController {
  private repository: IMCPIntegrationRepository;

  constructor(repository: IMCPIntegrationRepository) {
    this.repository = repository;
  }

  async createIntegration(req: Request, res: Response): Promise<void> {
    try {
      const request: CreateMCPIntegrationRequest = req.body;
      const tenantId = req.auth!.tenantId;

      const integration: MCPIntegration = {
        id: uuidv4(),
        type: 'mcp',
        name: request.name,
        description: request.description,
        transport: request.transport,
        config: request.config,
        enabled: request.enabled ?? true,
        tenantId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const created = await this.repository.create(integration);
      res.status(201).json(created);
    } catch (error) {
      console.error('Error creating MCP integration:', error);
      res.status(500).json({ error: 'Failed to create MCP integration' });
    }
  }

  async getIntegration(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.auth!.tenantId;
      const integration = await this.repository.getById(id, tenantId);

      if (!integration) {
        res.status(404).json({ error: 'MCP integration not found' });
        return;
      }

      res.json(integration);
    } catch (error) {
      console.error('Error getting MCP integration:', error);
      res.status(500).json({ error: 'Failed to get MCP integration' });
    }
  }

  async getAllIntegrations(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.auth!.tenantId;
      const enabledOnly = req.query.enabled === 'true';
      const integrations = await this.repository.getAll(tenantId, enabledOnly);
      res.json(integrations);
    } catch (error) {
      console.error('Error getting MCP integrations:', error);
      res.status(500).json({ error: 'Failed to get MCP integrations' });
    }
  }

  // Public method for internal use
  async fetchAll(tenantId: string, enabledOnly: boolean = false) {
    return this.repository.getAll(tenantId, enabledOnly);
  }

  async updateIntegration(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const request: UpdateMCPIntegrationRequest = req.body;

      const updates: Partial<MCPIntegration> = {
        ...request,
        updatedAt: new Date().toISOString(),
      };

      const updated = await this.repository.update(id, updates);
      res.json(updated);
    } catch (error) {
      console.error('Error updating MCP integration:', error);
      res.status(500).json({ error: 'Failed to update MCP integration' });
    }
  }

  async deleteIntegration(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.auth!.tenantId;
      const success = await this.repository.delete(id, tenantId);

      if (!success) {
        res.status(404).json({ error: 'MCP integration not found' });
        return;
      }

      res.status(204).send();
    } catch (error) {
      console.error('Error deleting MCP integration:', error);
      res.status(500).json({ error: 'Failed to delete MCP integration' });
    }
  }

  async getIntegrationDetails(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.auth!.tenantId;
      const integration = await this.repository.getById(id, tenantId);

      if (!integration) {
        res.status(404).json({ error: 'MCP integration not found' });
        return;
      }

      const details: MCPIntegrationDetails = {
        ...integration,
        tools: [],
        connectionStatus: 'disconnected',
      };

      // Only try to connect and fetch tools if enabled
      if (integration.enabled) {
        try {
          // Build a transport-specific config so TypeScript's discriminated union for
          // MCP server configs is satisfied (transport must be the specific literal).
          let client: MCPClient;
          if (integration.transport === 'http') {
            const cfg = {
              name: integration.name,
              transport: 'http' as const,
              ...(integration.config as any),
            };
            client = new MCPClient(cfg as any);
          } else if (integration.transport === 'stdio') {
            const cfg = {
              name: integration.name,
              transport: 'stdio' as const,
              ...(integration.config as any),
            };
            client = new MCPClient(cfg as any);
          } else {
            throw new Error(`Unsupported transport: ${integration.transport}`);
          }

          await client.connect();
          const mcpTools = await client.listTools();
          
          details.tools = mcpTools.map((tool: any) => ({
            name: tool.name,
            description: tool.description || '',
            inputSchema: tool.inputSchema,
          }));
          
          details.connectionStatus = 'connected';
          
          await client.disconnect();
        } catch (error) {
          console.error('Error fetching tools for integration:', error);
          details.connectionStatus = 'error';
          details.error = error instanceof Error ? error.message : 'Failed to connect to MCP server';
        }
      }

      res.json(details);
    } catch (error) {
      console.error('Error getting integration details:', error);
      res.status(500).json({ error: 'Failed to get integration details' });
    }
  }

  async listDockerMCPServers(_req: Request, res: Response): Promise<void> {
    try {
      // Only allow in development
      if (process.env.NODE_ENV === 'production') {
        res.status(403).json({ error: 'Docker MCP discovery not available in production' });
        return;
      }

      const servers: DockerMCPServer[] = [];

      // List available Docker MCP servers
      const output = execSync('docker mcp server ls', { 
        encoding: 'utf-8',
        timeout: 10000 
      }).trim();

      if (!output) {
        res.json([]);
        return;
      }

      const serverNames = output.split(',').map(s => s.trim()).filter(Boolean);

      // Inspect each server to get details
      for (const name of serverNames) {
        try {
          const inspectOutput = execSync(`docker mcp server inspect ${name}`, {
            encoding: 'utf-8',
            timeout: 10000
          }).trim();

          const result = JSON.parse(inspectOutput);
          
          servers.push({
            name,
            description: this.extractDescription(result.readme, name),
            toolCount: result.tools?.length || 0,
          });
        } catch (error) {
          console.error(`Failed to inspect server ${name}:`, error);
        }
      }

      res.json(servers);
    } catch (error) {
      console.error('Error listing Docker MCP servers:', error);
      res.status(500).json({ error: 'Failed to list Docker MCP servers' });
    }
  }

  async addDockerMCPIntegration(req: Request, res: Response): Promise<void> {
    try {
      // Only allow in development
      if (process.env.NODE_ENV === 'production') {
        res.status(403).json({ error: 'Docker MCP not available in production' });
        return;
      }

      const { serverName } = req.body;
      const tenantId = req.auth!.tenantId;

      if (!serverName) {
        res.status(400).json({ error: 'serverName is required' });
        return;
      }

      // Check if already exists
      const existing = await this.repository.getAll(tenantId);
      const duplicate = existing.find(i => 
        i.transport === 'stdio' && 
        'command' in i.config &&
        i.config.command === 'docker' &&
        i.name.includes(serverName)
      );

      if (duplicate) {
        res.status(409).json({ error: 'Integration already exists', integration: duplicate });
        return;
      }

      // Get server info
      const inspectOutput = execSync(`docker mcp server inspect ${serverName}`, {
        encoding: 'utf-8',
        timeout: 10000
      }).trim();

      const result = JSON.parse(inspectOutput);
      const description = this.extractDescription(result.readme, serverName);

      // Create integration
      const integration: MCPIntegration = {
        id: uuidv4(),
        type: 'mcp',
        name: `Docker MCP: ${serverName}`,
        description,
        transport: 'stdio',
        config: {
          command: 'docker',
          args: ['mcp', 'gateway', 'run'],
        },
        enabled: true,
        tenantId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const created = await this.repository.create(integration);
      res.status(201).json(created);
    } catch (error) {
      console.error('Error adding Docker MCP integration:', error);
      res.status(500).json({ error: 'Failed to add Docker MCP integration' });
    }
  }

  private extractDescription(readme: string | undefined, serverName: string): string {
    if (!readme) {
      return `Tools from ${serverName} MCP server`;
    }

    const lines = readme.split('\n').filter(l => l.trim());
    let startIdx = 0;

    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#') && !lines[i].startsWith('[')) {
        startIdx = i;
        break;
      }
    }

    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && !line.startsWith('|') && !line.startsWith('-') && line.length > 20) {
        return line.length > 100 ? line.substring(0, 100) + '...' : line;
      }
    }

    return `Tools from ${serverName} MCP server`;
  }
}
