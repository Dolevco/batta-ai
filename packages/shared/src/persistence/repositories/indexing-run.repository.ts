import { Pool } from 'pg';
import type { IndexingRun } from '../../types';
import type { IIndexingRunRepository, RepositoryConfig } from '../interfaces';
import { getPool } from '../client';

export class PostgresIndexingRunRepository implements IIndexingRunRepository {
  private readonly pool: Pool;

  constructor(_config: RepositoryConfig = {}) {
    this.pool = getPool();
  }

  async initialize(): Promise<void> {
    // Table created by schema.sql
  }

  async create(run: IndexingRun): Promise<IndexingRun> {
    await this.pool.query(
      `INSERT INTO indexing_runs (id, tenant_id, status, payload, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (tenant_id, id) DO UPDATE
         SET status = EXCLUDED.status, payload = EXCLUDED.payload, updated_at = now()`,
      [run.id, run.tenantId, run.status ?? '', JSON.stringify(run)]
    );
    return run;
  }

  async update(id: string, tenantId: string, updates: Partial<IndexingRun>): Promise<IndexingRun> {
    const existing = await this.getById(id, tenantId);
    if (!existing) throw new Error(`IndexingRun not found: ${id}`);
    const updated = { ...existing, ...updates, id, tenantId, updatedAt: new Date().toISOString() };
    await this.pool.query(
      `UPDATE indexing_runs SET status = $1, payload = $2, updated_at = now()
       WHERE tenant_id = $3 AND id = $4`,
      [updated.status ?? '', JSON.stringify(updated), tenantId, id]
    );
    return updated;
  }

  async getById(id: string, tenantId: string): Promise<IndexingRun | null> {
    const res = await this.pool.query(
      'SELECT payload FROM indexing_runs WHERE tenant_id = $1 AND id = $2',
      [tenantId, id]
    );
    return (res.rows[0]?.payload as IndexingRun) ?? null;
  }

  async getAll(tenantId: string): Promise<IndexingRun[]> {
    const res = await this.pool.query(
      'SELECT payload FROM indexing_runs WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantId]
    );
    return res.rows.map(r => r.payload as IndexingRun);
  }

  async getLatestCompletedForRepository(tenantId: string, repositoryUrl: string): Promise<IndexingRun | null> {
    const res = await this.pool.query(
      `SELECT payload FROM indexing_runs
       WHERE tenant_id = $1
         AND status = 'completed'
         AND payload->'scope'->'repositories' ? $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [tenantId, repositoryUrl]
    );
    return (res.rows[0]?.payload as IndexingRun) ?? null;
  }

  async deleteByTenant(tenantId: string): Promise<void> {
    await this.pool.query('DELETE FROM indexing_runs WHERE tenant_id = $1', [tenantId]);
  }
}
