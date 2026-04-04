import { QdrantClient } from '@qdrant/js-client-rest';
import { v4 as uuidv4 } from 'uuid';
import type { IMCPIntegrationRepository, RepositoryConfig } from './interfaces';
import type { MCPIntegration } from '../types';
import { createQdrantConfig } from './qdrantUtils';

export class QdrantMCPIntegrationRepository implements IMCPIntegrationRepository {
  private client: QdrantClient;
  private collectionName: string;
  private initialized = false;

  constructor(config: RepositoryConfig = {}) {
    const url = config.qdrantUrl || process.env.QDRANT_URL || 'http://localhost:6333';
    const apiKey = config.qdrantApiKey || process.env.QDRANT_API_KEY;

    this.client = new QdrantClient(createQdrantConfig(url, apiKey));

    this.collectionName = config.collectionName || 'mcp_integrations';
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.client.getCollection(this.collectionName);
    } catch (error) {
      await this.client.createCollection(this.collectionName, {
        vectors: {
          size: 1,
          distance: 'Cosine',
        },
      });

      // Create index for tenantId
      await this.client.createPayloadIndex(this.collectionName, {
        field_name: 'tenantId',
        field_schema: 'keyword',
      });
    }

    this.initialized = true;
  }

  async create(integration: MCPIntegration): Promise<MCPIntegration> {
    await this.initialize();

    const integrationWithType: MCPIntegration = {
      ...integration,
      type: 'mcp',
    };

    const point = {
      id: integrationWithType.id,
      vector: [0],
      payload: integrationWithType as unknown as Record<string, unknown>,
    };

    await this.client.upsert(this.collectionName, {
      wait: true,
      points: [point],
    });

    return integrationWithType;
  }

  async update(id: string, updates: Partial<MCPIntegration>): Promise<MCPIntegration> {
    await this.initialize();

    // Get tenantId from updates if it's a full object, or fetch existing
    const tenantId = (updates as MCPIntegration).tenantId;
    const existing = tenantId ? await this.getById(id, tenantId) : null;
    
    if (!existing) {
      throw new Error(`MCP integration not found: ${id}`);
    }

    const updated: MCPIntegration = {
      ...existing,
      ...updates,
      type: 'mcp',
      id: existing.id,
      tenantId: existing.tenantId, // Preserve original tenantId
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    await this.client.upsert(this.collectionName, {
      wait: true,
      points: [
        {
          id: updated.id,
          vector: [0],
          payload: updated as unknown as Record<string, unknown>,
        },
      ],
    });

    return updated;
  }

  async getById(id: string, tenantId: string): Promise<MCPIntegration | null> {
    await this.initialize();

    try {
      const result = await this.client.scroll(this.collectionName, {
        filter: {
          must: [
            { key: 'id', match: { value: id } },
            { key: 'tenantId', match: { value: tenantId } },
          ],
        },
        limit: 1,
        with_payload: true,
        with_vector: false,
      });

      if (result.points.length === 0) return null;

      return result.points[0].payload as unknown as MCPIntegration;
    } catch (error) {
      return null;
    }
  }

  async getAll(tenantId: string, enabledOnly = false): Promise<MCPIntegration[]> {
    await this.initialize();

    const mustConditions: any[] = [
      { key: 'tenantId', match: { value: tenantId } },
    ];

    if (enabledOnly) {
      mustConditions.push({ key: 'enabled', match: { value: true } });
    }

    const result = await this.client.scroll(this.collectionName, {
      filter: {
        must: mustConditions,
      },
      limit: 100,
      with_payload: true,
      with_vector: false,
    });

    return result.points.map((point) => point.payload as unknown as MCPIntegration);
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    await this.initialize();

    try {
      // First verify the integration exists and belongs to the tenant
      const integration = await this.getById(id, tenantId);
      if (!integration) {
        return false;
      }

      await this.client.delete(this.collectionName, {
        wait: true,
        points: [id],
      });
      return true;
    } catch (error) {
      return false;
    }
  }
}
