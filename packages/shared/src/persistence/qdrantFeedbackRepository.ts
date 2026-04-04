import { QdrantClient } from '@qdrant/js-client-rest';
import type { IFeedbackRepository, RepositoryConfig } from './interfaces';
import type { Feedback } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { createQdrantConfig } from './qdrantUtils';

export class QdrantFeedbackRepository implements IFeedbackRepository {
  private client: QdrantClient;
  private collectionName: string;
  private initialized = false;

  constructor(config: RepositoryConfig) {
    this.client = new QdrantClient(
      createQdrantConfig(
        config.qdrantUrl || 'http://localhost:6333',
        config.qdrantApiKey
      )
    );
    this.collectionName = config.collectionName || 'feedbacks';
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

      // Create indexes for filtering
      await this.client.createPayloadIndex(this.collectionName, {
        field_name: 'tenantId',
        field_schema: 'keyword',
      });

      await this.client.createPayloadIndex(this.collectionName, {
        field_name: 'taskId',
        field_schema: 'keyword',
      });

      await this.client.createPayloadIndex(this.collectionName, {
        field_name: 'taskRunId',
        field_schema: 'keyword',
      });
    }

    this.initialized = true;
  }

  async create(feedback: Feedback): Promise<Feedback> {
    await this.initialize();

    const id = feedback.id || uuidv4();
    const feedbackWithId = { ...feedback, id };

    await this.client.upsert(this.collectionName, {
      points: [
        {
          id: id,
          vector: [0],
          payload: feedbackWithId,
        },
      ],
    });

    return feedbackWithId;
  }

  async getById(id: string, tenantId: string): Promise<Feedback | null> {
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

    if (result.points.length === 0) {
      return null;
    }

    return result.points[0].payload as unknown as Feedback;
  }

  async getByTaskId(taskId: string, tenantId: string): Promise<Feedback[]> {
    await this.initialize();

    const result = await this.client.scroll(this.collectionName, {
      filter: {
        must: [
          { key: 'taskId', match: { value: taskId } },
          { key: 'tenantId', match: { value: tenantId } },
        ],
      },
      limit: 1000,
    });

    return result.points.map((point) => point.payload as unknown as Feedback);
  }

  async getByTaskRunId(taskRunId: string, tenantId: string): Promise<Feedback[]> {
    await this.initialize();

    const result = await this.client.scroll(this.collectionName, {
      filter: {
        must: [
          { key: 'taskRunId', match: { value: taskRunId } },
          { key: 'tenantId', match: { value: tenantId } },
        ],
      },
      limit: 1000,
    });

    return result.points.map((point) => point.payload as unknown as Feedback);
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    await this.initialize();

    // First verify the feedback exists and belongs to the tenant
    const feedback = await this.getById(id, tenantId);
    if (!feedback) {
      return false;
    }

    await this.client.delete(this.collectionName, {
      points: [id],
    });

    return true;
  }

  async update(id: string, tenantId: string, updates: Partial<Feedback>): Promise<Feedback> {
    await this.initialize();

    const existing = await this.getById(id, tenantId);
    if (!existing) throw new Error('Feedback not found');

    const updated = { 
      ...existing, 
      ...updates,
      tenantId: existing.tenantId, // Preserve original tenantId
    } as Feedback;

    await this.client.upsert(this.collectionName, {
      points: [
        {
          id: id,
          vector: [0],
          payload: updated as unknown as Record<string, unknown>,
        },
      ],
    });

    return updated;
  }

  async deleteByTaskId(taskId: string, tenantId: string): Promise<boolean> {
    await this.initialize();

    await this.client.delete(this.collectionName, {
      filter: {
        must: [
          { key: 'taskId', match: { value: taskId } },
          { key: 'tenantId', match: { value: tenantId } },
        ],
      },
    });

    return true;
  }
}
