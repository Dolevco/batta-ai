import { Pool } from 'pg';
import type { MCPIntegration } from '../../types';
import type { IMCPIntegrationRepository, RepositoryConfig } from '../interfaces';
import { getPool } from '../client';

export class PostgresMCPIntegrationRepository implements IMCPIntegrationRepository {
  private readonly pool: Pool;

  constructor(_config: RepositoryConfig = {}) {
    this.pool = getPool();
  }

  async initialize(): Promise<void> {
    // Table created by schema.sql
  }

  async create(integration: MCPIntegration): Promise<MCPIntegration> {
    await this.pool.query(
      `INSERT INTO mcp_integrations (id, tenant_id, enabled, payload, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (tenant_id, id) DO UPDATE
         SET enabled = EXCLUDED.enabled, payload = EXCLUDED.payload, updated_at = now()`,
      [integration.id, integration.tenantId, integration.enabled ?? true, JSON.stringify(integration)]
    );
    return integration;
  }

  async update(id: string, updates: Partial<MCPIntegration>): Promise<MCPIntegration> {
    const tenantId = (updates as MCPIntegration).tenantId;
    const existing = await this.getById(id, tenantId);
    if (!existing) throw new Error(`MCPIntegration not found: ${id}`);
    const updated = { ...existing, ...updates, id, tenantId: existing.tenantId, updatedAt: new Date().toISOString() };
    await this.pool.query(
      `UPDATE mcp_integrations SET enabled = $1, payload = $2, updated_at = now()
       WHERE tenant_id = $3 AND id = $4`,
      [updated.enabled ?? true, JSON.stringify(updated), existing.tenantId, id]
    );
    return updated;
  }

  async getById(id: string, tenantId: string): Promise<MCPIntegration | null> {
    const res = await this.pool.query(
      'SELECT payload FROM mcp_integrations WHERE tenant_id = $1 AND id = $2',
      [tenantId, id]
    );
    return (res.rows[0]?.payload as MCPIntegration) ?? null;
  }

  async getAll(tenantId: string, enabledOnly?: boolean): Promise<MCPIntegration[]> {
    const params: any[] = [tenantId];
    let sql = 'SELECT payload FROM mcp_integrations WHERE tenant_id = $1';
    if (enabledOnly) {
      sql += ' AND enabled = true';
    }
    sql += ' ORDER BY created_at DESC';
    const res = await this.pool.query(sql, params);
    return res.rows.map(r => r.payload as MCPIntegration);
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const res = await this.pool.query(
      'DELETE FROM mcp_integrations WHERE tenant_id = $1 AND id = $2',
      [tenantId, id]
    );
    return (res.rowCount ?? 0) > 0;
  }
}
