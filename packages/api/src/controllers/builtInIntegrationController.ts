import { Request, Response } from 'express';
import { BuiltInIntegration } from '../types';
import { MicrosoftDefenderIntegration, SlackIntegration, GitHubIntegration, GitLabIntegration, JiraIntegration, AWSIntegration, ICustomIntegrationRepository, DefenderConfig, SlackConfig, GitHubConfig, GitLabConfig, JiraConfig, AWSConfig } from '@batta/shared';
import { v4 as uuidv4 } from 'uuid';

export class BuiltInIntegrationController {
  constructor(private customIntegrationRepository: ICustomIntegrationRepository) {}

  async getBuiltInIntegrations(_req: Request, res: Response): Promise<void> {
    const integrations: BuiltInIntegration[] = [
      {
        id: 'microsoft-defender-cloud',
        name: 'Microsoft Azure',
        description: 'Query cloud resources and security assessments from Microsoft Azure',
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
        authModes: [
          {
            id: 'oauth',
            label: 'GitHub App (OAuth)',
            description: 'Recommended. Installs the Batta GitHub App on your organization.',
            oauth: {
              authorizeUrl: `https://github.com/apps/${encodeURIComponent(process.env.GITHUB_APP_SLUG!)}/installations/new?redirect_uri=${encodeURIComponent(process.env.GITHUB_REDIRECT_URI!)}`,
            },
          },
          {
            id: 'token',
            label: 'Personal Access Token',
            description: 'Use a classic PAT with repo scope.',
            configSchema: [
              {
                key: 'personalAccessToken',
                displayName: 'Personal Access Token',
                description: 'Classic PAT or fine-grained token with repo scope.',
                placeholder: 'ghp_…',
                required: true,
                secret: true,
                type: 'password',
              },
            ],
          },
        ],
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
      {
        id: 'amazon-aws',
        name: 'Amazon AWS',
        description: 'Query cloud security findings from AWS Security Hub, GuardDuty, Config, and IAM Access Analyzer',
        category: 'aws',
        uiCategory: 'security',
        type: 'custom',
        config: {
          accountIds: '',
          regions: '',
          roleArn: '',
          externalId: '',
        },
        configSchema: [
          {
            key: 'accountIds',
            displayName: 'Account IDs',
            description: 'Comma-separated list of AWS Account IDs to connect (e.g. 123456789012,987654321098).',
            placeholder: '123456789012',
            required: true,
            secret: false,
            type: 'string',
          },
          {
            key: 'regions',
            displayName: 'Regions',
            description: 'Comma-separated list of AWS regions to index (e.g. us-east-1,eu-west-1).',
            placeholder: 'us-east-1',
            required: true,
            secret: false,
            type: 'string',
          },
          {
            key: 'roleArn',
            displayName: 'Cross-Account Role ARN (optional)',
            description: 'ARN of the IAM role to assume for cross-account access. Leave blank to use the ambient instance profile or environment credentials.',
            placeholder: 'arn:aws:iam::123456789012:role/BattaAIReadOnly',
            required: false,
            secret: false,
            type: 'string',
          },
          {
            key: 'externalId',
            displayName: 'External ID (optional)',
            description: 'ExternalId for assume-role security. Required only if your role trust policy enforces it.',
            placeholder: '',
            required: false,
            secret: true,
            type: 'password',
          },
        ],
      },
      {
        id: 'jira',
        name: 'Jira',
        description: 'Query and manage Jira issues, sprints, and projects',
        category: 'jira',
        uiCategory: 'development',
        type: 'custom',
        config: {
          baseUrl: '',
          userEmail: '',
          apiToken: '',
          projectKeys: '',
        },
        configSchema: [
          {
            key: 'baseUrl',
            displayName: 'Jira Base URL',
            description: 'Your Atlassian Cloud URL, e.g. https://yourcompany.atlassian.net',
            placeholder: 'https://yourcompany.atlassian.net',
            required: true,
            secret: false,
            type: 'string',
          },
          {
            key: 'userEmail',
            displayName: 'Account Email',
            description: 'The email address associated with your Jira account.',
            placeholder: 'you@company.com',
            required: true,
            secret: false,
            type: 'string',
          },
          {
            key: 'apiToken',
            displayName: 'API Token',
            description: 'Generate one at id.atlassian.com/manage-profile/security/api-tokens',
            placeholder: 'ATATT3x…',
            required: true,
            secret: true,
            type: 'password',
          },
          {
            key: 'projectKeys',
            displayName: 'Project Keys (optional)',
            description: 'Comma-separated project keys to scope searches, e.g. ENG,OPS. Leave blank to search all.',
            placeholder: 'ENG,OPS',
            required: false,
            secret: false,
            type: 'string',
          },
        ],
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

    if (integrationId === 'amazon-aws') {
      try {
        const { config } = req.body;
        const { tenantId } = (req as any).auth || {};
        const result = await AWSIntegration.validate({
          tenantId: tenantId ?? '',
          accountIds: config?.accountIds ?? '',
          regions: config?.regions ?? '',
          roleArn: config?.roleArn || undefined,
          externalId: config?.externalId || undefined,
        } as AWSConfig);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ valid: false, error: err?.message ?? String(err) });
      }
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

    if (integrationId === 'jira') {
      try {
        const { config } = req.body;
        const result = await JiraIntegration.validate({
          tenantId: '',
          baseUrl: config.baseUrl,
          userEmail: config.userEmail,
          apiToken: config.apiToken,
        } as JiraConfig);
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
