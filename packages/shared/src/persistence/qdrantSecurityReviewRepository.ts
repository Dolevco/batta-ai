import { QdrantClient } from '@qdrant/js-client-rest';
import type { ISecurityReviewRepository, RepositoryConfig } from './interfaces';
import type { SecurityReview } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { createQdrantConfig } from './qdrantUtils';

/** Parse a field that may have been stored as a JSON-stringified array back into an array. */
function parseArrayField<T>(value: unknown, fallback: T[] = []): T[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* ignore */ }
  }
  return fallback;
}

/** Normalize a SecurityReview read from Qdrant, fixing any fields stored as JSON strings. */
function normalizeReview(review: SecurityReview): SecurityReview {
  return {
    ...review,
    services: parseArrayField(review.services),
    questions: parseArrayField(review.questions),
    answers: parseArrayField(review.answers),
    tasks: parseArrayField(review.tasks),
    attestations: parseArrayField(review.attestations),
  };
}

/** Filters for querying security reviews. */
export interface SecurityReviewFilters {
  prUrl?: string;
  branchName?: string;
  repository?: string;
}

export class QdrantSecurityReviewRepository implements ISecurityReviewRepository {
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
    this.collectionName = config.collectionName || 'security_reviews';
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
        field_name: 'status',
        field_schema: 'keyword',
      });

      // New indexes for PR correlation filtering
      await this.client.createPayloadIndex(this.collectionName, {
        field_name: 'gitContext.branchName',
        field_schema: 'keyword',
      });

      await this.client.createPayloadIndex(this.collectionName, {
        field_name: 'correlatedPR.prUrl',
        field_schema: 'keyword',
      });

      await this.client.createPayloadIndex(this.collectionName, {
        field_name: 'correlatedPR.prNumber',
        field_schema: 'integer',
      });
    }

    this.initialized = true;
  }

  async create(review: SecurityReview): Promise<SecurityReview> {
    await this.initialize();

    const id = review.id || uuidv4();
    const reviewWithId = { ...review, id };

    await this.client.upsert(this.collectionName, {
      points: [{ id, vector: [0], payload: reviewWithId }],
    });

    return reviewWithId;
  }

  async getById(id: string, tenantId: string): Promise<SecurityReview | null> {
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
    return normalizeReview(result.points[0].payload as unknown as SecurityReview);
  }

  async getAll(tenantId: string): Promise<SecurityReview[]> {
    await this.initialize();

    const result = await this.client.scroll(this.collectionName, {
      filter: { must: [{ key: 'tenantId', match: { value: tenantId } }] },
      limit: 1000,
      with_payload: true,
      with_vector: false,
    });

    return result.points.map(p => normalizeReview(p.payload as unknown as SecurityReview));
  }

  async update(id: string, tenantId: string, updates: Partial<SecurityReview>): Promise<SecurityReview> {
    await this.initialize();

    const existing = await this.getById(id, tenantId);
    if (!existing) throw new Error(`SecurityReview not found: ${id}`);

    const updated: SecurityReview = {
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
