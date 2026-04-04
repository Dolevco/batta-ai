import { QdrantClient } from '@qdrant/js-client-rest';
import type { ITaskRunRepository, RepositoryConfig } from './interfaces';
import type { TaskRun } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { createQdrantConfig } from './qdrantUtils';

export class QdrantTaskRunRepository implements ITaskRunRepository {
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
    this.collectionName = config.collectionName || 'task_runs';
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
    }

    this.initialized = true;
  }

  async create(taskRun: TaskRun): Promise<TaskRun> {
    await this.initialize();

    const id = taskRun.id || uuidv4();
    const taskRunWithId = { ...taskRun, id };

    await this.client.upsert(this.collectionName, {
      points: [
        {
          id: id,
          vector: [0],
          payload: taskRunWithId,
        },
      ],
    });

    return taskRunWithId;
  }

  async update(id: string, updates: Partial<TaskRun>): Promise<TaskRun> {
    await this.initialize();

    // Get tenantId from updates if provided
    const tenantId = (updates as TaskRun).tenantId;
    const existing = tenantId ? await this.getById(id, tenantId) : null;
    
    if (!existing) {
      throw new Error('TaskRun not found');
    }

    const updated = { 
      ...existing, 
      ...updates,
      tenantId: existing.tenantId, // Preserve original tenantId
    };

    await this.client.upsert(this.collectionName, {
      points: [
        {
          id: id,
          vector: [0],
          payload: updated,
        },
      ],
    });

    return updated;
  }

  async getById(id: string, tenantId: string): Promise<TaskRun | null> {
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

    return result.points[0].payload as unknown as TaskRun;
  }

  async getByTaskId(taskId: string, tenantId: string): Promise<TaskRun[]> {
    await this.initialize();

    const result = await this.client.scroll(this.collectionName, {
      filter: {
        must: [
          { key: 'taskId', match: { value: taskId } },
          { key: 'tenantId', match: { value: tenantId } },
        ],
      },
      limit: 100,
      with_payload: true,
    });

    return (result.points || [])
      .map((point) => point.payload as unknown as TaskRun)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }

  async getAll(tenantId: string): Promise<TaskRun[]> {
    await this.initialize();

    const result = await this.client.scroll(this.collectionName, {
      filter: {
        must: [
          { key: 'tenantId', match: { value: tenantId } },
        ],
      },
      limit: 100,
      with_payload: true,
    });

    return (result.points || [])
      .map((point) => point.payload as unknown as TaskRun)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }

  async delete(id: string): Promise<boolean> {
    await this.initialize();

    await this.client.delete(this.collectionName, {
      points: [id],
    });

    return true;
  }

  async deleteByTaskId(taskId: string): Promise<boolean> {
    await this.initialize();

    await this.client.delete(this.collectionName, {
      filter: {
        must: [
          {
            key: 'taskId',
            match: {
              value: taskId,
            },
          },
        ],
      },
    });

    return true;
  }
}
