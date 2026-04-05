import { Request, Response } from 'express';
import { BuiltInIntegration } from '../types';
import { MicrosoftDefenderIntegration, SlackIntegration, GitHubIntegration, GitLabIntegration, ICustomIntegrationRepository, DefenderConfig, SlackConfig, GitHubConfig, GitLabConfig } from '@ai-agent/shared';
import { v4 as uuidv4 } from 'uuid';

export class BuiltInIntegrationController {
  constructor(private customIntegrationRepository: ICustomIntegrationRepository) {}

  async getBuiltInIntegrations(_req: Request, res: Response): Promise<void> {
    const integrations: BuiltInIntegration[] = [
      {
        id: 'microsoft-defender-cloud',
        name: 'Microsoft Defender for Cloud',
        description: 'Query security assessments and recommendations from Microsoft Defender for Cloud',
        category: 'msdefender',
        uiCategory: 'security',
        type: 'custom',
        config: {
          tenantId: '',
          clientId: '',
          clientSecret: '',
          subscriptionId: '',
        },
        configSchema: [
          {
            key: 'tenantId',
            displayName: 'Azure Tenant ID',
            description: 'The Azure Active Directory tenant where the app registration exists (GUID).',
            placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
            required: true,
            secret: false,
            type: 'string',
          },
          {
            key: 'clientId',
            displayName: 'Azure Client ID',
            description: 'The application (client) ID for the service principal used to authenticate.',
            placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
            required: true,
            secret: false,
            type: 'string',
          },
          {
            key: 'clientSecret',
            displayName: 'Azure Client Secret',
            description: 'The client secret for the service principal (kept secret).',
            placeholder: '••••••••',
            required: true,
            secret: true,
            type: 'password',
          },
          {
            key: 'subscriptionId',
            displayName: 'Azure Subscription ID',
            description: 'The subscription ID containing the resources to query.',
            placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
            required: false,
            secret: false,
            type: 'string',
          },
        ],
      },
      {
        id: 'slack',
        name: 'Slack',
        description: 'Send messages and interact with Slack channels',
        category: 'slack',
        uiCategory: 'communication',
        type: 'custom',
        config: {
          botToken: '',
          userToken: '',
        },
        configSchema: [
        ],
        // Expose OAuth metadata so the UI can construct a consent link generically
        oauth: {
          // Relative path to backend endpoint that initiates Slack OAuth
          authorizeUrl: `https://slack.com/oauth/v2/authorize?` +
              `client_id=${encodeURIComponent(process.env.SLACK_CLIENT_ID!)}` +
              `&scope=${encodeURIComponent([
              'channels:read',
              'groups:read',
              'channels:history',
              'groups:history',
              'chat:write',
              'users:read',
              'search:read.im',
              'im:write',
            ].join(','))}` +
              `&redirect_uri=${encodeURIComponent(process.env.SLACK_REDIRECT_URI!)}` +
              `&state=${encodeURIComponent(uuidv4())}`,
          scopes: [
            'channels:read',
            'groups:read',
            'channels:history',
            'groups:history',
            'chat:write',
            'users:read',
            'search:read',
          ],
        },
      },
      {
        id: 'github',
        name: 'GitHub',
        description: 'Access GitHub repositories, issues, and manage code',
        category: 'development',
        type: 'code',
        config: {
          installationId: '',
        },
        configSchema: [],
        oauth: {
          // For app-based integrations, the UI should direct users to the App
          // installation page. The backend's authorize endpoint will redirect
          // to that page when GITHUB_APP_SLUG is configured.
          authorizeUrl: `https://github.com/apps/${encodeURIComponent(process.env.GITHUB_APP_SLUG!)}/installations/new?redirect_uri=${encodeURIComponent(process.env.GITHUB_REDIRECT_URI!)}`,
        },
      },
      {
        id: 'gitlab',
        name: 'GitLab',
        description: 'Access GitLab groups and repositories, manage merge requests and issues',
        category: 'development',
        uiCategory: 'development',
        type: 'code',
        config: {
          groupAccessToken: '',
          groupId: '',
          baseUrl: 'https://gitlab.com',
        },
        configSchema: [
          {
            key: 'groupAccessToken',
            displayName: 'Group Access Token',
            description: 'A GitLab Group Access Token with api and read_repository scopes.',
            placeholder: 'glpat-xxxxxxxxxxxxxxxxxxxx',
            required: true,
            secret: true,
            type: 'password',
          },
          {
            key: 'groupId',
            displayName: 'Group ID or Path (optional)',
            description: 'Namespace/path of the group to scope repository discovery (e.g. my-org). Leave blank to use all groups accessible to the token.',
            placeholder: 'my-org',
            required: false,
            secret: false,
            type: 'string',
          },
          {
            key: 'baseUrl',
            displayName: 'GitLab Base URL (optional)',
            description: 'For self-hosted GitLab instances. Leave blank for gitlab.com.',
            placeholder: 'https://gitlab.example.com',
            required: false,
            secret: false,
            type: 'string',
          },
        ],
        // No oauth block — token is entered directly in the form
      },
    ];

    res.json(integrations);
  }

  async validateIntegration(req: Request, res: Response): Promise<void> {
    const { integrationId } = req.body;

    if (!integrationId) {
      res.status(400).json({ valid: false, error: 'Integration ID is required' });
      return;
    }

    // Validate based on integration type
    if (integrationId === 'microsoft-defender-cloud') {
      const { config } = req.body;
      const result = await MicrosoftDefenderIntegration.validate(config as DefenderConfig);
      res.json(result);
      return;
    }

    if (integrationId === 'slack') {
      try {
        const { tenantId } = (req as any).auth || {};
        
        if (!tenantId) {
          res.status(401).json({ valid: false, error: 'Unauthorized' });
          return;
        }

        // Fetch all custom integrations (include disabled ones) and find the Slack entry
        const customIntegrations = await this.customIntegrationRepository.getAll(tenantId, false);
        const slackEntry = customIntegrations.find((ci) => ci.name === 'Slack');

        if (!slackEntry) {
          res.status(404).json({ valid: false, error: 'Slack integration missing consent. try click Connect' });
          return;
        }

        const storedConfig = slackEntry.config || {};

        const slackConfig: SlackConfig = {
          tenantId: storedConfig.tenantId,
          workspaceId: storedConfig.workspaceId,
          botToken: storedConfig.botToken,
          userToken: storedConfig.userToken,
          workspaceName: storedConfig.workspaceName,
        } as SlackConfig;

        const result = await SlackIntegration.validate(slackConfig);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ valid: false, error: err?.message ?? String(err) });
      }

      return;
    }

    if (integrationId === 'github') {
      try {
        const { tenantId } = (req as any).auth || {};
        
        if (!tenantId) {
          res.status(401).json({ valid: false, error: 'Unauthorized' });
          return;
        }

        // Fetch all custom integrations and find the GitHub entry
        const customIntegrations = await this.customIntegrationRepository.getAll(tenantId, false);
        const githubEntry = customIntegrations.find((ci) => ci.name === 'GitHub');

        if (!githubEntry) {
          res.status(404).json({ valid: false, error: 'GitHub integration missing consent. try click Connect' });
          return;
        }

        const storedConfig = githubEntry.config || {};

        const githubConfig: GitHubConfig = {
          tenantId: storedConfig.tenantId,
          installationId: storedConfig.installationId,
          appId: storedConfig.appId || process.env.GITHUB_APP_ID,
        } as GitHubConfig;

        const result = await GitHubIntegration.validate(githubConfig);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ valid: false, error: err?.message ?? String(err) });
      }

      return;
    }

    if (integrationId === 'gitlab') {
      try {
        const { tenantId } = (req as any).auth || {};

        if (!tenantId) {
          res.status(401).json({ valid: false, error: 'Unauthorized' });
          return;
        }

        // Fetch all custom integrations and find the GitLab entry
        const customIntegrations = await this.customIntegrationRepository.getAll(tenantId, false);
        const gitlabEntry = customIntegrations.find((ci) => ci.name === 'GitLab');

        if (!gitlabEntry) {
          // If no stored entry yet, validate using config provided in request body
          const { config } = req.body;
          if (!config?.groupAccessToken) {
            res.status(404).json({ valid: false, error: 'GitLab integration not configured yet.' });
            return;
          }

          const result = await GitLabIntegration.validate({
            tenantId,
            groupAccessToken: config.groupAccessToken,
            groupId: config.groupId,
            baseUrl: config.baseUrl,
          } as GitLabConfig);
          res.json(result);
          return;
        }

        const storedConfig = gitlabEntry.config || {};

        const gitlabConfig: GitLabConfig = {
          tenantId,
          groupAccessToken: storedConfig.groupAccessToken,
          groupId: storedConfig.groupId,
          baseUrl: storedConfig.baseUrl,
        };

        const result = await GitLabIntegration.validate(gitlabConfig);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ valid: false, error: err?.message ?? String(err) });
      }

      return;
    }

    // For other integrations, return success (can be extended later)
    res.json({ valid: true });
  }
}
