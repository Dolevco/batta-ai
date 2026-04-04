import { QdrantClient } from '@qdrant/js-client-rest';
import type { IPolicyTemplateRepository, RepositoryConfig } from './interfaces';
import type { PolicyTemplate, PolicyTemplateType } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { createQdrantConfig } from './qdrantUtils';

export class QdrantPolicyTemplateRepository implements IPolicyTemplateRepository {
  private client: QdrantClient;
  private collectionName: string;
  private initialized = false;

  constructor(config?: RepositoryConfig) {
    this.client = new QdrantClient(
      createQdrantConfig(
        config?.qdrantUrl || process.env.QDRANT_URL || 'http://localhost:6333',
        config?.qdrantApiKey || process.env.QDRANT_API_KEY
      )
    );
    this.collectionName = config?.collectionName || 'policy_templates';
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.client.getCollection(this.collectionName);
    } catch {
      await this.client.createCollection(this.collectionName, {
        vectors: { size: 1, distance: 'Cosine' },
      });

      await this.client.createPayloadIndex(this.collectionName, {
        field_name: 'tenantId',
        field_schema: 'keyword',
      });

      await this.client.createPayloadIndex(this.collectionName, {
        field_name: 'type',
        field_schema: 'keyword',
      });
    }

    this.initialized = true;
  }

  async create(template: PolicyTemplate): Promise<PolicyTemplate> {
    await this.initialize();

    const id = template.id || uuidv4();
    const withId = { ...template, id };

    await this.client.upsert(this.collectionName, {
      points: [{ id, vector: [0], payload: withId as unknown as Record<string, unknown> }],
    });

    return withId;
  }

  async getById(id: string, tenantId: string): Promise<PolicyTemplate | null> {
    await this.initialize();

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
    return result.points[0].payload as unknown as PolicyTemplate;
  }

  async getAll(tenantId: string): Promise<PolicyTemplate[]> {
    await this.initialize();

    const result = await this.client.scroll(this.collectionName, {
      filter: { must: [{ key: 'tenantId', match: { value: tenantId } }] },
      limit: 1000,
      with_payload: true,
      with_vector: false,
    });

    return result.points.map(p => p.payload as unknown as PolicyTemplate);
  }

  async getActiveByType(tenantId: string, type: PolicyTemplateType): Promise<PolicyTemplate | null> {
    await this.initialize();

    const result = await this.client.scroll(this.collectionName, {
      filter: {
        must: [
          { key: 'tenantId', match: { value: tenantId } },
          { key: 'type', match: { value: type } },
          { key: 'isActive', match: { value: true } },
        ],
      },
      limit: 1,
      with_payload: true,
      with_vector: false,
    });

    if (result.points.length === 0) return null;
    return result.points[0].payload as unknown as PolicyTemplate;
  }

  async update(id: string, tenantId: string, updates: Partial<PolicyTemplate>): Promise<PolicyTemplate> {
    await this.initialize();

    const existing = await this.getById(id, tenantId);
    if (!existing) throw new Error(`PolicyTemplate not found: ${id}`);

    const updated: PolicyTemplate = {
      ...existing,
      ...updates,
      id: existing.id,
      tenantId: existing.tenantId,
      updatedAt: new Date().toISOString(),
    };

    await this.client.upsert(this.collectionName, {
      points: [{ id, vector: [0], payload: updated as unknown as Record<string, unknown> }],
    });

    return updated;
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    await this.initialize();

    const existing = await this.getById(id, tenantId);
    if (!existing) return false;

    await this.client.delete(this.collectionName, { points: [id] });
    return true;
  }
}
