import { Request, Response } from 'express';
import { getInstallationToken } from '@batta/shared';
import type { ICustomIntegrationRepository } from '@batta/shared';
import type { CustomIntegration } from '../types';

export class GitHubOAuthController {
  constructor(private customIntegrationRepository: ICustomIntegrationRepository) {}
  
  /**
   * Completes the GitHub OAuth flow: exchanges the code for tokens and stores the
   * integration. This endpoint is intended to be called by the UI OAuth callback
   * page after it receives the OAuth query params.
   */
  async complete(req: Request, res: Response): Promise<void> {
    // Expect the client to provide the installation id after the user installs
    // the GitHub App. The UI should redirect users to the App installation
    // page and then prompt them to paste the installation id (or the UI can
    // retrieve it if available via the redirect). Here we accept it directly
    // and validate by creating an installation access token using the App JWT.
    const { installationId, accountLogin } = req.body as { installationId?: string; accountLogin?: string };

    if (!installationId) {
      res.status(400).json({ success: false, error: 'missing_installation_id' });
      return;
    }

    try {
      // Request an installation token using the shared helper (wraps Octokit's app auth)
      const authResult = await getInstallationToken(Number(installationId));
      if (!authResult || !authResult.token) {
        res.status(500).json({ success: false, error: 'failed_to_obtain_installation_token' });
        return;
      }

      // Store installationId in the integrations table (single record for GitHub)
      // TODO: Extract actual tenantId from OAuth state parameter for proper multi-tenant support
      const integrationTenantId = req.auth!.tenantId;
      const GITHUB_INTEGRATION_ID = '9b1d5f6a-7c8e-4a1b-9f2e-3d4c5b6a7e8f';

      const config: Record<string, string> = {
        tenantId: integrationTenantId,
        installationId: String(installationId),
        accountLogin: accountLogin || '',
        appId: process.env.GITHUB_APP_ID || '',
      };

      const existing = await this.customIntegrationRepository.getById(GITHUB_INTEGRATION_ID, integrationTenantId);
      if (existing) {
        await this.customIntegrationRepository.update(GITHUB_INTEGRATION_ID, {
          config,
          enabled: true,
          updatedAt: new Date().toISOString(),
        });
      } else {
        const integration: CustomIntegration = {
          id: GITHUB_INTEGRATION_ID,
          type: 'code',
          name: 'GitHub',
          description: `GitHub installation: ${installationId}`,
          config,
          enabled: true,
          tenantId: integrationTenantId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await this.customIntegrationRepository.create(integration);
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error('GitHub integration complete error:', error);
      const errorMsg = error?.response?.data?.message || error?.message || 'unknown_error';
      res.status(500).json({ success: false, error: errorMsg });
    }
  }
}
