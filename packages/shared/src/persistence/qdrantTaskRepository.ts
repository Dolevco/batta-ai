import { QdrantClient } from '@qdrant/js-client-rest';
import type { TaskResponse } from '../types';
import type { ITaskRepository, TaskFilters, RepositoryConfig } from './interfaces';
import { createQdrantConfig } from './qdrantUtils';

const DEFAULT_CONFIG = {
  qdrantUrl: 'http://localhost:6333',
  qdrantApiKey: '',
  collectionName: 'agent_tasks',
};

/**
 * Qdrant-based implementation of task repository.
 * Uses Qdrant as a document store (no vector search needed for tasks).
 */
export class QdrantTaskRepository implements ITaskRepository {
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
        // Create collection without vectors (payload-only storage)
        // We use a dummy 1-dimensional vector since Qdrant requires vector config
        await this.client.createCollection(this.config.collectionName, {
          vectors: {
            size: 1,
            distance: 'Cosine',
          },
          // Enable payload indexing for efficient filtering
          optimizers_config: {
            indexing_threshold: 0,
          },
        });

        // Create payload index for common filter fields
        await this.client.createPayloadIndex(this.config.collectionName, {
          field_name: 'status',
          field_schema: 'keyword',
        });

        await this.client.createPayloadIndex(this.config.collectionName, {
          field_name: 'createdAt',
          field_schema: 'datetime',
        });

        await this.client.createPayloadIndex(this.config.collectionName, {
          field_name: 'tenantId',
          field_schema: 'keyword',
        });

        console.log(`TaskRepository: Created collection '${this.config.collectionName}'`);
      }

      this.initialized = true;
    } catch (error) {
      console.error('TaskRepository: Failed to initialize', error);
      throw error;
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  async create(task: TaskResponse): Promise<TaskResponse> {
    await this.ensureInitialized();

    try {
      await this.client.upsert(this.config.collectionName, {
        wait: true,
        points: [
          {
            id: task.id,
            vector: [0], // Dummy vector since we're not doing vector search
            payload: task as any,
          },
        ],
      });

      return task;
    } catch (error) {
      console.error('TaskRepository: Failed to create task', error);
      throw error;
    }
  }

  async update(id: string, updates: Partial<TaskResponse>): Promise<TaskResponse> {
    await this.ensureInitialized();

    try {
      // Get existing task
      const existing = await this.getById(id);
      if (!existing) {
        throw new Error(`Task with id ${id} not found`);
      }

      // Merge updates with existing task
      const updated: TaskResponse = {
        ...existing,
        ...updates,
        id, // Ensure ID doesn't change
        updatedAt: new Date().toISOString(),
      };

      // Upsert the updated task
      await this.client.upsert(this.config.collectionName, {
        wait: true,
        points: [
          {
            id: updated.id,
            vector: [0],
            payload: updated as any,
          },
        ],
      });

      return updated;
    } catch (error) {
      console.error('TaskRepository: Failed to update task', error);
      throw error;
    }
  }

  async getById(id: string): Promise<TaskResponse | null> {
    await this.ensureInitialized();

    try {
      const results = await this.client.retrieve(this.config.collectionName, {
        ids: [id],
        with_payload: true,
      });

      if (results.length === 0) {
        return null;
      }

      return results[0].payload as unknown as TaskResponse;
    } catch (error) {
      console.error('TaskRepository: Failed to get task', error);
      throw error;
    }
  }

  async getAll(filters?: TaskFilters): Promise<TaskResponse[]> {
    await this.ensureInitialized();

    try {
      // Build filter conditions
      const filterConditions: any[] = [];

      // Add tenantId filter if provided
      if (filters?.tenantId) {
        filterConditions.push({
          key: 'tenantId',
          match: { value: filters.tenantId },
        });
      }

      if (filters?.status) {
        if (Array.isArray(filters.status)) {
          filterConditions.push({
            key: 'status',
            match: { any: filters.status },
          });
        } else {
          filterConditions.push({
            key: 'status',
            match: { value: filters.status },
          });
        }
      }

      if (filters?.createdAfter) {
        filterConditions.push({
          key: 'createdAt',
          range: { gte: filters.createdAfter },
        });
      }

      if (filters?.createdBefore) {
        filterConditions.push({
          key: 'createdAt',
          range: { lte: filters.createdBefore },
        });
      }

      // Use scroll to get all matching tasks
      const scrollResult = await this.client.scroll(this.config.collectionName, {
        filter: filterConditions.length > 0 ? { must: filterConditions } : undefined,
        with_payload: true,
        with_vector: false,
        limit: 100, // Adjust as needed
      });

      return scrollResult.points.map((point: any) => point.payload as TaskResponse);
    } catch (error) {
      console.error('TaskRepository: Failed to get all tasks', error);
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureInitialized();

    try {
      await this.client.delete(this.config.collectionName, {
        wait: true,
        points: [id],
      });

      return true;
    } catch (error) {
      console.error('TaskRepository: Failed to delete task', error);
      return false;
    }
  }
}
