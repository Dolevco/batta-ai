import { Request, Response } from 'express';
import { validatePersonalAccessToken, encrypt } from '@batta/shared';
import type { ICustomIntegrationRepository } from '@batta/shared';
import type { CustomIntegration } from '../types';

const GITHUB_INTEGRATION_ID = '9b1d5f6a-7c8e-4a1b-9f2e-3d4c5b6a7e8f';

export class GitHubTokenController {
  constructor(private customIntegrationRepository: ICustomIntegrationRepository) {}

  async configure(req: Request, res: Response): Promise<void> {
    const { personalAccessToken } = req.body as { personalAccessToken?: string };

    if (!personalAccessToken || typeof personalAccessToken !== 'string') {
      res.status(400).json({ error: 'personalAccessToken is required' });
      return;
    }

    const tenantId = req.auth!.tenantId;

    const { valid, login, scopes } = await validatePersonalAccessToken(personalAccessToken);
    if (!valid) {
      res.status(400).json({ error: 'Invalid GitHub token' });
      return;
    }

    const encrypted = encrypt(personalAccessToken);

    const config: Record<string, string> = {
      authType: 'token',
      personalAccessToken: encrypted,
      tokenScope: scopes.join(','),
      accountLogin: login,
      tenantId,
    };

    const existing = await this.customIntegrationRepository.getById(GITHUB_INTEGRATION_ID, tenantId);
    if (existing) {
      await this.customIntegrationRepository.update(GITHUB_INTEGRATION_ID, {
        config,
        description: `GitHub token: ${login}`,
        enabled: true,
        updatedAt: new Date().toISOString(),
      });
    } else {
      const integration: CustomIntegration = {
        id: GITHUB_INTEGRATION_ID,
        type: 'code',
        name: 'GitHub',
        description: `GitHub token: ${login}`,
        config,
        enabled: true,
        tenantId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await this.customIntegrationRepository.create(integration);
    }

    res.json({ success: true, login, scopes });
  }

  async revoke(req: Request, res: Response): Promise<void> {
    const tenantId = req.auth!.tenantId;
    await this.customIntegrationRepository.delete(GITHUB_INTEGRATION_ID, tenantId);
    res.json({ success: true });
  }
}
