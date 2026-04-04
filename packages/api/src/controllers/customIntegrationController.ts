import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { ICustomIntegrationRepository } from '@ai-agent/shared';
import type { CustomIntegration, CreateCustomIntegrationRequest, UpdateCustomIntegrationRequest } from '../types';

export class CustomIntegrationController {
  private repository: ICustomIntegrationRepository;

  constructor(repository: ICustomIntegrationRepository) {
    this.repository = repository;
  }

  async createIntegration(req: Request, res: Response): Promise<void> {
    try {
      const request: CreateCustomIntegrationRequest = req.body;
      const tenantId = req.auth!.tenantId;

      const integration: CustomIntegration = {
        id: uuidv4(),
        type: 'custom',
        name: request.name,
        description: request.description,
        config: request.config,
        enabled: request.enabled ?? true,
        tenantId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as CustomIntegration;

      const created = await this.repository.create(integration);
      res.status(201).json(created);
    } catch (error) {
      console.error('Error creating custom integration:', error);
      res.status(500).json({ error: 'Failed to create custom integration' });
    }
  }

  async getIntegration(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.auth!.tenantId;
      const integration = await this.repository.getById(id, tenantId);

      if (!integration) {
        res.status(404).json({ error: 'Custom integration not found' });
        return;
      }

      res.json(integration);
    } catch (error) {
      console.error('Error getting custom integration:', error);
      res.status(500).json({ error: 'Failed to get custom integration' });
    }
  }

  async getAllIntegrations(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.auth!.tenantId;
      const enabledOnly = req.query.enabled === 'true';
      const integrations = await this.repository.getAll(tenantId, enabledOnly);
      res.json(integrations);
    } catch (error) {
      console.error('Error getting custom integrations:', error);
      res.status(500).json({ error: 'Failed to get custom integrations' });
    }
  }

  // Public method for internal use
  async fetchAll(tenantId: string, enabledOnly: boolean = false) {
    return this.repository.getAll(tenantId, enabledOnly);
  }

  async updateIntegration(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.auth!.tenantId;
      const request: UpdateCustomIntegrationRequest = req.body;

      const existing = await this.repository.getById(id, tenantId);
      if (!existing) {
        res.status(404).json({ error: 'Custom integration not found' });
        return;
      }

      // Merge config safely, removing any undefined values so the result is Record<string,string>
      let mergedConfig: Record<string, string> | undefined = undefined;
      if (request.config) {
        mergedConfig = { ...existing.config };
        for (const [k, v] of Object.entries(request.config)) {
          if (v !== undefined && v !== null) {
            mergedConfig[k] = String(v);
          }
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
      console.error('Error updating custom integration:', error);
      res.status(500).json({ error: 'Failed to update custom integration' });
    }
  }

  async deleteIntegration(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.auth!.tenantId;
      const success = await this.repository.delete(id, tenantId);

      if (!success) {
        res.status(404).json({ error: 'Custom integration not found' });
        return;
      }

      res.status(204).send();
    } catch (error) {
      console.error('Error deleting custom integration:', error);
      res.status(500).json({ error: 'Failed to delete custom integration' });
    }
  }
}
