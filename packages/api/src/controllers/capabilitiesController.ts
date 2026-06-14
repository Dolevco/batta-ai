import type { Request, Response } from 'express';
import type { CapabilityService } from '@batta/shared';

export class CapabilitiesController {
  constructor(private readonly capabilityService: CapabilityService) {}

  async getCapabilities(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.auth!.tenantId;
      res.json(await this.capabilityService.getCapabilities(tenantId));
    } catch (error) {
      console.error('[CapabilitiesController] getCapabilities error:', error);
      res.status(500).json({ error: 'Failed to load capabilities.' });
    }
  }
}
