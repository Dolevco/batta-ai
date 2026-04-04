import { QdrantClient } from '@qdrant/js-client-rest';
import type { Agent } from '../types';
import type { IAgentRepository, RepositoryConfig } from './interfaces';
import { createQdrantConfig } from './qdrantUtils';

const DEFAULT_CONFIG = {
  qdrantUrl: 'http://localhost:6333',
  qdrantApiKey: '',
  collectionName: 'agents',
};

/**
 * Qdrant-based implementation of agent repository.
 */
export class QdrantAgentRepository implements IAgentRepository {
  private client: QdrantClient;
  private config: Required<RepositoryConfig>;
  private initialized = false;

  constructor(config: RepositoryConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.client = new QdrantClient(
      createQdrantConfig(
        this.config.qdrantUrl,
        this.config.qdrantApiKey || undefined
      )
    );
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(
        (c: any) => c.name === this.config.collectionName
      );

      if (!exists) {
        await this.client.createCollection(this.config.collectionName, {
          vectors: {
            size: 1,
            distance: 'Cosine',
          },
          optimizers_config: {
            indexing_threshold: 0,
          },
        });

        await this.client.createPayloadIndex(this.config.collectionName, {
          field_name: 'name',
          field_schema: 'keyword',
        });

        await this.client.createPayloadIndex(this.config.collectionName, {
          field_name: 'tenantId',
          field_schema: 'keyword',
        });

        console.log(`AgentRepository: Created collection '${this.config.collectionName}'`);
      }

      this.initialized = true;
    } catch (error) {
      console.error('AgentRepository: Failed to initialize', error);
      throw error;
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  async create(agent: Agent): Promise<Agent> {
    await this.ensureInitialized();

    try {
      await this.client.upsert(this.config.collectionName, {
        wait: true,
        points: [
          {
            id: agent.id,
            vector: [0],
            payload: agent as any,
          },
        ],
      });

      return agent;
    } catch (error) {
      console.error('AgentRepository: Failed to create agent', error);
      throw error;
    }
  }

  async update(id: string, updates: Partial<Agent>): Promise<Agent> {
    await this.ensureInitialized();

    try {
      // Note: tenantId should not be updatable, so we don't include it in updates
      const existing = await this.getById(id, (updates as Agent).tenantId);
      if (!existing) {
        throw new Error(`Agent not found: ${id}`);
      }

      const updated = {
        ...existing,
        ...updates,
        id,
        tenantId: existing.tenantId, // Preserve original tenantId
        updatedAt: new Date().toISOString(),
      };

      await this.client.upsert(this.config.collectionName, {
        wait: true,
        points: [
          {
            id,
            vector: [0],
            payload: updated as any,
          },
        ],
      });

      return updated;
    } catch (error) {
      console.error('AgentRepository: Failed to update agent', error);
      throw error;
    }
  }

  async getById(id: string, tenantId: string): Promise<Agent | null> {
    await this.ensureInitialized();

    try {
      const result = await this.client.scroll(this.config.collectionName, {
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

      if (result.points.length === 0) {
        return null;
      }

      return result.points[0].payload as unknown as Agent;
    } catch (error) {
      console.error('AgentRepository: Failed to get agent', error);
      throw error;
    }
  }

  async getAll(tenantId: string): Promise<Agent[]> {
    await this.ensureInitialized();

    try {
      const result = await this.client.scroll(this.config.collectionName, {
        filter: {
          must: [
            { key: 'tenantId', match: { value: tenantId } },
          ],
        },
        limit: 100,
        with_payload: true,
        with_vector: false,
      });

      return result.points.map((point: any) => point.payload as unknown as Agent);
    } catch (error) {
      console.error('AgentRepository: Failed to get all agents', error);
      throw error;
    }
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    await this.ensureInitialized();

    try {
      // First verify the agent exists and belongs to the tenant
      const agent = await this.getById(id, tenantId);
      if (!agent) {
        return false;
      }

      await this.client.delete(this.config.collectionName, {
        wait: true,
        points: [id],
      });

      return true;
    } catch (error) {
      console.error('AgentRepository: Failed to delete agent', error);
      return false;
    }
  }
}
