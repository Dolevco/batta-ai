import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { ICustomIntegrationRepository } from '@ai-agent/shared';
import type { CustomIntegration, CreateCustomIntegrationRequest, UpdateCustomIntegrationRequest } from '../types';

/** Integration types managed by this controller. */
type IntegrationType = 'custom' | 'code';

/**
 * Resolve the integration type from the route segment.
 * Routes are mounted as /integrations/:type so req.params.type is either
 * "custom" or "code". Falls back to "custom" for safety.
 */
function resolveType(req: Request): IntegrationType {
  const t = req.params.type;
  return t === 'code' ? 'code' : 'custom';
}

export class CustomIntegrationController {
  private repository: ICustomIntegrationRepository;

  constructor(repository: ICustomIntegrationRepository) {
    this.repository = repository;
  }

  async createIntegration(req: Request, res: Response): Promise<void> {
    try {
      const type = resolveType(req);
      const request: CreateCustomIntegrationRequest = req.body;
      const tenantId = req.auth!.tenantId;

      const config: Record<string, string> = {};
      for (const [k, v] of Object.entries(request.config ?? {})) {
        if (v !== undefined && v !== null) config[k] = String(v);
      }

      const integration: CustomIntegration = {
        id: uuidv4(),
        type,
        name: request.name,
        description: request.description,
        config,
        enabled: request.enabled ?? true,
        tenantId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as CustomIntegration;

      const created = await this.repository.create(integration);
      res.status(201).json(created);
    } catch (error) {
      console.error('Error creating integration:', error);
      res.status(500).json({ error: 'Failed to create integration' });
    }
  }

  async getIntegration(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.auth!.tenantId;
      // No type filter on single-record lookups — UUIDs are globally unique
      const integration = await this.repository.getById(id, tenantId);

      if (!integration) {
        res.status(404).json({ error: 'Integration not found' });
        return;
      }

      res.json(integration);
    } catch (error) {
      console.error('Error getting integration:', error);
      res.status(500).json({ error: 'Failed to get integration' });
    }
  }

  async getAllIntegrations(req: Request, res: Response): Promise<void> {
    try {
      const type = resolveType(req);
      const tenantId = req.auth!.tenantId;
      const enabledOnly = req.query.enabled === 'true';
      const all = await this.repository.getAll(tenantId, enabledOnly);
      res.json(all.filter((i) => i.type === type));
    } catch (error) {
      console.error('Error getting integrations:', error);
      res.status(500).json({ error: 'Failed to get integrations' });
    }
  }

  async updateIntegration(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.auth!.tenantId;
      const request: UpdateCustomIntegrationRequest = req.body;

      // No type filter on single-record lookups — UUIDs are globally unique
      const existing = await this.repository.getById(id, tenantId);
      if (!existing) {
        res.status(404).json({ error: 'Integration not found' });
        return;
      }

      let mergedConfig: Record<string, string> | undefined;
      if (request.config) {
        mergedConfig = { ...existing.config };
        for (const [k, v] of Object.entries(request.config)) {
          if (v !== undefined && v !== null) mergedConfig[k] = String(v);
        }
      }

      const updates: Partial<CustomIntegration> = {
        ...(request.name && { name: request.name }),
        ...(request.description !== undefined && { description: request.description }),
        ...(mergedConfig && { config: mergedConfig }),
        ...(request.enabled !== undefined && { enabled: request.enabled }),
        updatedAt: new Date().toISOString(),
      };

      const updated = await this.repository.update(id, updates);
      res.json(updated);
    } catch (error) {
      console.error('Error updating integration:', error);
      res.status(500).json({ error: 'Failed to update integration' });
    }
  }

  async deleteIntegration(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.auth!.tenantId;

      // No type filter on single-record lookups — UUIDs are globally unique
      const existing = await this.repository.getById(id, tenantId);
      if (!existing) {
        res.status(404).json({ error: 'Integration not found' });
        return;
      }

      await this.repository.delete(id, tenantId);
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting integration:', error);
      res.status(500).json({ error: 'Failed to delete integration' });
    }
  }

  /** Internal: fetch all integrations for a tenant (all types). */
  async fetchAll(tenantId: string, enabledOnly = false) {
    return this.repository.getAll(tenantId, enabledOnly);
  }

  /** Internal: fetch only code-type integrations for a tenant. */
  async fetchAllCode(tenantId: string, enabledOnly = false) {
    const all = await this.repository.getAll(tenantId, enabledOnly);
    return all.filter((i) => i.type === 'code');
  }
}
