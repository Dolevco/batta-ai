/**
 * Qdrant-backed IndexingRun repository.
 *
 * Data classification: INTERNAL — operational metadata only (repo URLs, commit SHAs,
 * timestamps, counts, generic error messages). No PII or secret material is stored.
 *
 * Security:
 * - Every query filters by tenantId first to enforce multi-tenant isolation.
 * - Collection: `indexing_runs` (append-only audit trail for indexing operations).
 * - Follows the same pattern as QdrantTaskRunRepository.
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import type { IIndexingRunRepository, RepositoryConfig } from './interfaces';
import type { IndexingRun } from '../types';
import { createQdrantConfig } from './qdrantUtils';

export class QdrantIndexingRunRepository implements IIndexingRunRepository {
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
    this.collectionName = config.collectionName || 'indexing_runs';
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    let collectionExists = false;
    try {
      await this.client.getCollection(this.collectionName);
      collectionExists = true;
    } catch {
      // Collection does not exist yet — create it.
    }

    if (!collectionExists) {
      try {
        await this.client.createCollection(this.collectionName, {
          vectors: { size: 1, distance: 'Cosine' },
        });
      } catch (createErr: unknown) {
        // Another concurrent caller already created the collection — that's fine.
        const msg = createErr instanceof Error ? createErr.message : String(createErr);
        if (!msg.includes('Conflict')) throw createErr;
      }
    }

    // Always ensure payload indices exist (idempotent — Qdrant ignores duplicates).
    // Security: tenant isolation index — every query must filter by tenantId
    await this.client.createPayloadIndex(this.collectionName, {
      field_name: 'tenantId',
      field_schema: 'keyword',
    });

    await this.client.createPayloadIndex(this.collectionName, {
      field_name: 'status',
      field_schema: 'keyword',
    });

    await this.client.createPayloadIndex(this.collectionName, {
      field_name: 'startedAt',
      field_schema: 'keyword',
    });

    // Index for repository-scoped queries
    await this.client.createPayloadIndex(this.collectionName, {
      field_name: 'scope.repositories',
      field_schema: 'keyword',
    });

    this.initialized = true;
  }

  async create(run: IndexingRun): Promise<IndexingRun> {
    await this.initialize();

    const runWithId = { ...run };

    await this.client.upsert(this.collectionName, {
      points: [
        {
          id: run.id,
          vector: [0],
          payload: runWithId as unknown as Record<string, unknown>,
        },
      ],
    });

    return runWithId;
  }

  async update(id: string, tenantId: string, updates: Partial<IndexingRun>): Promise<IndexingRun> {
    await this.initialize();

    const existing = await this.getById(id, tenantId);
    if (!existing) throw new Error(`IndexingRun not found: ${id}`);

    const updated: IndexingRun = {
      ...existing,
      ...updates,
      // Security: always preserve original id and tenantId
      id: existing.id,
      tenantId: existing.tenantId,
    };

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

  async getById(id: string, tenantId: string): Promise<IndexingRun | null> {
    await this.initialize();

    // Security: filter by tenantId FIRST to enforce tenant isolation
    const result = await this.client.scroll(this.collectionName, {
      filter: {
        must: [
          { key: 'tenantId', match: { value: tenantId } },
          { key: 'id', match: { value: id } },
        ],
      },
      limit: 1,
      with_payload: true,
      with_vector: false,
    });

    if (result.points.length === 0) return null;
    return result.points[0].payload as unknown as IndexingRun;
  }

  async getAll(tenantId: string): Promise<IndexingRun[]> {
    await this.initialize();

    // Security: filter exclusively by tenantId
    const result = await this.client.scroll(this.collectionName, {
      filter: {
        must: [{ key: 'tenantId', match: { value: tenantId } }],
      },
      limit: 100,
      with_payload: true,
      with_vector: false,
    });

    return (result.points || [])
      .map(p => p.payload as unknown as IndexingRun)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }

  /**
   * Returns the most-recently completed IndexingRun for a given repository URL.
   *
   * Security:
   * - tenantId is the FIRST filter applied. The repositoryUrl filter is additive.
   * - Scroll limit of 50 prevents excessive memory consumption.
   * - Results are sorted client-side by startedAt desc.
   * - repositoryUrl comes from the internal task record, not directly from user input.
   */
  async deleteByTenant(tenantId: string): Promise<void> {
    await this.initialize();

    // Security: filter by tenantId only — deletes all records for this tenant
    await this.client.delete(this.collectionName, {
      filter: {
        must: [{ key: 'tenantId', match: { value: tenantId } }],
      },
    });
  }

  async getLatestCompletedForRepository(tenantId: string, repositoryUrl: string): Promise<IndexingRun | null> {
    await this.initialize();

    // Security: tenantId filter first, then status + repository filters
    const result = await this.client.scroll(this.collectionName, {
      filter: {
        must: [
          { key: 'tenantId', match: { value: tenantId } },
          { key: 'status', match: { value: 'completed' } },
          { key: 'scope.repositories', match: { value: repositoryUrl } },
        ],
      },
      limit: 50,
      with_payload: true,
      with_vector: false,
    });

    const runs = (result.points || [])
      .map(p => p.payload as unknown as IndexingRun)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    return runs[0] ?? null;
  }
}
