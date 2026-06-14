import { Pool } from 'pg';
import type { CustomIntegration } from '../../types';
import type { ICustomIntegrationRepository, RepositoryConfig } from '../interfaces';
import { getPool } from '../client';

export class PostgresCustomIntegrationRepository implements ICustomIntegrationRepository {
  private readonly pool: Pool;

  constructor(_config: RepositoryConfig = {}) {
    this.pool = getPool();
  }

  async initialize(): Promise<void> {
    // Table created by schema.sql
  }

  async create(integration: CustomIntegration): Promise<CustomIntegration> {
    await this.pool.query(
      `INSERT INTO custom_integrations (id, tenant_id, enabled, payload, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (tenant_id, id) DO UPDATE
         SET enabled = EXCLUDED.enabled, payload = EXCLUDED.payload, updated_at = now()`,
      [integration.id, integration.tenantId, integration.enabled ?? true, JSON.stringify(integration)]
    );
    return integration;
  }

  async update(id: string, updates: Partial<CustomIntegration>): Promise<CustomIntegration> {
    const tenantId = (updates as CustomIntegration).tenantId;
    const existing = await this.getById(id, tenantId);
    if (!existing) throw new Error(`CustomIntegration not found: ${id}`);
    const updated = { ...existing, ...updates, id, tenantId: existing.tenantId, updatedAt: new Date().toISOString() };
    await this.pool.query(
      `UPDATE custom_integrations SET enabled = $1, payload = $2, updated_at = now()
       WHERE tenant_id = $3 AND id = $4`,
      [updated.enabled ?? true, JSON.stringify(updated), existing.tenantId, id]
    );
    return updated;
  }

  async getById(id: string, tenantId: string): Promise<CustomIntegration | null> {
    const res = await this.pool.query(
      'SELECT payload FROM custom_integrations WHERE tenant_id = $1 AND id = $2',
      [tenantId, id]
    );
    return (res.rows[0]?.payload as CustomIntegration) ?? null;
  }

  async getAll(tenantId: string, enabledOnly?: boolean): Promise<CustomIntegration[]> {
    const params: any[] = [tenantId];
    let sql = 'SELECT payload FROM custom_integrations WHERE tenant_id = $1';
    if (enabledOnly) {
      sql += ' AND enabled = true';
    }
    sql += ' ORDER BY created_at DESC';
    const res = await this.pool.query(sql, params);
    return res.rows.map(r => r.payload as CustomIntegration);
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const res = await this.pool.query(
      'DELETE FROM custom_integrations WHERE tenant_id = $1 AND id = $2',
      [tenantId, id]
    );
    return (res.rowCount ?? 0) > 0;
  }
}
