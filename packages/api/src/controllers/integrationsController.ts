import { Request, Response } from 'express';
import type { MCPIntegrationController } from './mcpIntegrationController';
import type { CustomIntegrationController } from './customIntegrationController';

export class IntegrationsController {
  private mcpController: MCPIntegrationController;
  private customController: CustomIntegrationController;

  constructor(
    mcpController: MCPIntegrationController,
    customController: CustomIntegrationController
  ) {
    this.mcpController = mcpController;
    this.customController = customController;
  }

  async getAllIntegrations(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.auth!.tenantId;
      const enabledOnly = req.query.enabled === 'true';
      const [mcpIntegrations, customIntegrations] = await Promise.all([
        this.mcpController.fetchAll(tenantId, enabledOnly),
        this.customController.fetchAll(tenantId, enabledOnly),
      ]);

      res.json([...mcpIntegrations, ...customIntegrations]);
    } catch (error) {
      console.error('Error getting all integrations:', error);
      res.status(500).json({ error: 'Failed to get integrations' });
    }
  }
}
