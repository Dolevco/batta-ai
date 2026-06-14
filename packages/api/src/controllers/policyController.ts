import type { Request, Response } from 'express';
import type { PolicyService } from '@batta/shared';
import type { PolicyTemplateType } from '@batta/shared';

function resolveTenantId(req: Request): string {
  if (req.auth?.tenantId) {
    return req.auth?.tenantId;
  }

  throw new Error('Cannot fetch tenantId');
}

const VALID_TYPES: PolicyTemplateType[] = ['security_review', 'responsible_ai', 'privacy', 'work_item_review'];

export class PolicyController {
  constructor(private service: PolicyService) {}

  async listPolicies(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const policies = await this.service.getAll(tenantId);
      res.json(policies);
    } catch (error) {
      console.error('[Policy] listPolicies error:', error);
      res.status(500).json({ error: 'Failed to list policies' });
    }
  }

  async getPolicy(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const { id } = req.params;
      const policy = await this.service.getById(id, tenantId);
      if (!policy) {
        res.status(404).json({ error: 'Policy not found' });
        return;
      }
      res.json(policy);
    } catch (error) {
      console.error('[Policy] getPolicy error:', error);
      res.status(500).json({ error: 'Failed to get policy' });
    }
  }

  async updatePolicy(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const { id } = req.params;
      const { questions, taskRules, baselineTasks, isActive, name, description, jiraActionItems } = req.body;

      const policy = await this.service.updatePolicy(id, tenantId, {
        ...(questions !== undefined && { questions }),
        ...(taskRules !== undefined && { taskRules }),
        ...(baselineTasks !== undefined && { baselineTasks }),
        ...(isActive !== undefined && { isActive }),
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(jiraActionItems !== undefined && { jiraActionItems }),
      });
      res.json(policy);
    } catch (error: any) {
      const isNotFound = error.message?.includes('not found');
      console.error('[Policy] updatePolicy error:', error);
      res.status(isNotFound ? 404 : 500).json({ error: error.message || 'Failed to update policy' });
    }
  }

  async resetToDefaults(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const { type } = req.params;

      if (!VALID_TYPES.includes(type as PolicyTemplateType)) {
        res.status(400).json({ error: `Invalid policy type. Must be one of: ${VALID_TYPES.join(', ')}` });
        return;
      }

      const policy = await this.service.resetToDefaults(tenantId, type as PolicyTemplateType);
      res.json(policy);
    } catch (error) {
      console.error('[Policy] resetToDefaults error:', error);
      res.status(500).json({ error: 'Failed to reset policy to defaults' });
    }
  }

  async seedDefaults(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const policies = await this.service.seedDefaultPolicies(tenantId);
      res.json(policies);
    } catch (error) {
      console.error('[Policy] seedDefaults error:', error);
      res.status(500).json({ error: 'Failed to seed default policies' });
    }
  }
}
