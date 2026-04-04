import { Request, Response } from 'express';
import axios from 'axios';
import { ICustomIntegrationRepository, CustomIntegration } from '@ai-agent/shared';

export class SlackOAuthController {
  constructor(private customIntegrationRepository: ICustomIntegrationRepository) {}

  /**
   * Completes the Slack OAuth flow: exchanges the code for tokens and stores the
   * integration. This endpoint is intended to be called by the UI OAuth callback
   * page after it receives the OAuth query params.
   */
  async complete(req: Request, res: Response): Promise<void> {
    const { code } = req.body as { code?: string };

    if (!code) {
      res.status(400).json({ success: false, error: 'missing_code' });
      return;
    }

    const clientId = process.env.SLACK_CLIENT_ID;
    const clientSecret = process.env.SLACK_CLIENT_SECRET;
    const redirectUri = process.env.SLACK_REDIRECT_URI; // optional, Slack may require exact match

    if (!clientId || !clientSecret) {
      res.status(500).json({ success: false, error: 'oauth_not_configured' });
      return;
    }

    try {
      const tokenResponse = await axios.post(
        'https://slack.com/api/oauth.v2.access',
        null,
        {
          params: {
            client_id: clientId,
            client_secret: clientSecret,
            code: code as string,
            ...(redirectUri ? { redirect_uri: redirectUri } : {}),
          },
        }
      );

      if (!tokenResponse.data.ok) {
        throw new Error(tokenResponse.data.error || 'Failed to exchange code for token');
      }

      const { access_token, team, authed_user } = tokenResponse.data;
      const workspaceId = team.id;
      const workspaceName = team.name;
      const botUserId = tokenResponse.data.bot_user_id;

      const tenantId = req.auth!.tenantId;

      // Use a fixed GUID so there's only one Slack integration record
      const SLACK_INTEGRATION_ID = 'c6b1a8f2-9e8b-4f6a-9b2a-123456789abc';

      // TODO: Extract actual tenantId from OAuth state parameter for proper multi-tenant support
      const integrationTenantId = tenantId;

      const config: Record<string, string> = {
        tenantId,
        workspaceId,
        workspaceName,
        botToken: access_token,
        userToken: authed_user?.access_token || '',
        botUserId: botUserId || '',
      };

      // If the fixed Slack integration record already exists, update only its config
      const existing = await this.customIntegrationRepository.getById(SLACK_INTEGRATION_ID, integrationTenantId);

      if (existing) {
        await this.customIntegrationRepository.update(SLACK_INTEGRATION_ID, {
          config,
          enabled: true,
          updatedAt: new Date().toISOString(),
        });
      } else {
        const integration: CustomIntegration = {
          id: SLACK_INTEGRATION_ID,
          type: 'custom',
          name: 'Slack',
          description: `Slack workspace: ${workspaceName}`,
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
      console.error('Slack OAuth complete error:', error);
      const errorMsg = error?.response?.data?.error || error?.message || 'unknown_error';
      res.status(500).json({ success: false, error: errorMsg });
    }
  }
}
