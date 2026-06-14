import { Pool } from 'pg';
import type { SecurityReview } from '../../types';
import type { ISecurityReviewRepository, RepositoryConfig } from '../interfaces';
import { getPool } from '../client';

export class PostgresSecurityReviewRepository implements ISecurityReviewRepository {
  private readonly pool: Pool;

  constructor(_config: RepositoryConfig = {}) {
    this.pool = getPool();
  }

  async initialize(): Promise<void> {
    // Table created by schema.sql
  }

  async create(review: SecurityReview): Promise<SecurityReview> {
    await this.pool.query(
      `INSERT INTO security_reviews (id, tenant_id, status, payload, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (tenant_id, id) DO UPDATE
         SET status = EXCLUDED.status, payload = EXCLUDED.payload, updated_at = now()`,
      [review.id, review.tenantId, review.status ?? '', JSON.stringify(review)]
    );
    return review;
  }

  async update(id: string, tenantId: string, updates: Partial<SecurityReview>): Promise<SecurityReview> {
    const existing = await this.getById(id, tenantId);
    if (!existing) throw new Error(`SecurityReview not found: ${id}`);
    const updated = { ...existing, ...updates, id, tenantId, updatedAt: new Date().toISOString() };
    await this.pool.query(
      `UPDATE security_reviews SET status = $1, payload = $2, updated_at = now()
       WHERE tenant_id = $3 AND id = $4`,
      [updated.status ?? '', JSON.stringify(updated), tenantId, id]
    );
    return updated;
  }

  async getById(id: string, tenantId: string): Promise<SecurityReview | null> {
    const res = await this.pool.query(
      'SELECT payload FROM security_reviews WHERE tenant_id = $1 AND id = $2',
      [tenantId, id]
    );
    return (res.rows[0]?.payload as SecurityReview) ?? null;
  }

  async getAll(tenantId: string): Promise<SecurityReview[]> {
    const res = await this.pool.query(
      'SELECT payload FROM security_reviews WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantId]
    );
    return res.rows.map(r => r.payload as SecurityReview);
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const res = await this.pool.query(
      'DELETE FROM security_reviews WHERE tenant_id = $1 AND id = $2',
      [tenantId, id]
    );
    return (res.rowCount ?? 0) > 0;
  }
}
