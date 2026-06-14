import { Pool } from 'pg';
import type { PolicyTemplate, PolicyTemplateType } from '../../types';
import type { IPolicyTemplateRepository, RepositoryConfig } from '../interfaces';
import { getPool } from '../client';

export class PostgresPolicyTemplateRepository implements IPolicyTemplateRepository {
  private readonly pool: Pool;

  constructor(_config: RepositoryConfig = {}) {
    this.pool = getPool();
  }

  async initialize(): Promise<void> {
    // Table created by schema.sql
  }

  async create(template: PolicyTemplate): Promise<PolicyTemplate> {
    await this.pool.query(
      `INSERT INTO policy_templates (id, tenant_id, template_type, active, payload, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (tenant_id, id) DO UPDATE
         SET template_type = EXCLUDED.template_type,
             active        = EXCLUDED.active,
             payload       = EXCLUDED.payload,
             updated_at    = now()`,
      [template.id, template.tenantId, template.type ?? '', template.isActive ?? true, JSON.stringify(template)]
    );
    return template;
  }

  async update(id: string, tenantId: string, updates: Partial<PolicyTemplate>): Promise<PolicyTemplate> {
    const existing = await this.getById(id, tenantId);
    if (!existing) throw new Error(`PolicyTemplate not found: ${id}`);
    const updated = { ...existing, ...updates, id, tenantId, updatedAt: new Date().toISOString() };
    await this.pool.query(
      `UPDATE policy_templates SET template_type = $1, active = $2, payload = $3, updated_at = now()
       WHERE tenant_id = $4 AND id = $5`,
      [updated.type ?? '', updated.isActive ?? true, JSON.stringify(updated), tenantId, id]
    );
    return updated;
  }

  async getById(id: string, tenantId: string): Promise<PolicyTemplate | null> {
    const res = await this.pool.query(
      'SELECT payload FROM policy_templates WHERE tenant_id = $1 AND id = $2',
      [tenantId, id]
    );
    return (res.rows[0]?.payload as PolicyTemplate) ?? null;
  }

  async getAll(tenantId: string): Promise<PolicyTemplate[]> {
    const res = await this.pool.query(
      'SELECT payload FROM policy_templates WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantId]
    );
    return res.rows.map(r => r.payload as PolicyTemplate);
  }

  async getActiveByType(tenantId: string, type: PolicyTemplateType): Promise<PolicyTemplate | null> {
    const res = await this.pool.query(
      `SELECT payload FROM policy_templates
       WHERE tenant_id = $1 AND template_type = $2 AND active = true
       ORDER BY created_at DESC LIMIT 1`,
      [tenantId, type]
    );
    return (res.rows[0]?.payload as PolicyTemplate) ?? null;
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const res = await this.pool.query(
      'DELETE FROM policy_templates WHERE tenant_id = $1 AND id = $2',
      [tenantId, id]
    );
    return (res.rowCount ?? 0) > 0;
  }
}
