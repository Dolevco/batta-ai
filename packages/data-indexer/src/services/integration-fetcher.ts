/**
 * Integration Fetcher Service
 * 
 * Fetches and initializes integrations dynamically from Qdrant
 * based on tenant ID
 */

import { GitHubIntegration, GitLabIntegration, MicrosoftDefenderIntegration } from '@ai-agent/shared';
import { QdrantCustomIntegrationRepository } from '@ai-agent/shared';
import type { CustomIntegration } from '@ai-agent/shared';
import type { CodeIntegrationHandler } from '@ai-agent/shared';

export interface IntegrationFetcherConfig {
  qdrantUrl?: string;
  qdrantApiKey?: string;
}

export interface FetchedIntegrations {
  /** All configured code integrations (GitHub, GitLab, …). May be empty. */
  codeIntegrations: CodeIntegrationHandler[];
  /**
   * @deprecated Use `codeIntegrations[0]` instead.
   * Kept for backwards-compat; returns the first code integration or undefined.
   */
  codeIntegration?: CodeIntegrationHandler;
  cloudIntegration?: MicrosoftDefenderIntegration;
}

/**
 * Service to fetch and initialize integrations from Qdrant
 */
export class IntegrationFetcher {
  private customRepo: QdrantCustomIntegrationRepository;

  constructor(config: IntegrationFetcherConfig = {}) {
    const url = config.qdrantUrl || process.env.QDRANT_URL || 'http://localhost:6333';
    const apiKey = config.qdrantApiKey || process.env.QDRANT_API_KEY;

    this.customRepo = new QdrantCustomIntegrationRepository({ qdrantUrl: url, qdrantApiKey: apiKey });
  }

  /**
   * Initialize repositories
   */
  async initialize(): Promise<void> {
    await this.customRepo.initialize();
  }

  /**
   * Fetch integrations for a tenant
   */
  async fetchIntegrations(tenantId: string): Promise<FetchedIntegrations> {
    const codeIntegrations: CodeIntegrationHandler[] = [];

    // Fetch all custom integrations
    const customIntegrations = await this.customRepo.getAll(tenantId, true);
    
    // Find GitHub integration (type: 'code')
    const githubIntegration = customIntegrations.find(i => 
      i.type === 'code' && i.name?.toLowerCase().includes('github')
    );
    
    if (githubIntegration) {
      codeIntegrations.push(this.createGitHubIntegration(tenantId, githubIntegration));
    }

    // Find GitLab integration (type: 'code', name contains 'gitlab')
    const gitlabIntegration = customIntegrations.find(i =>
      i.type === 'code' && i.name?.toLowerCase().includes('gitlab')
    );

    if (gitlabIntegration) {
      codeIntegrations.push(this.createGitLabIntegration(tenantId, gitlabIntegration));
    }

    // Find Microsoft Defender integration
    const defenderIntegration = customIntegrations.find(i => 
      i.name?.toLowerCase().includes('defender') || 
      i.name?.toLowerCase().includes('microsoft') ||
      (i.config.clientId && i.config.clientSecret)
    );

    const result: FetchedIntegrations = {
      codeIntegrations,
      // backwards-compat alias
      codeIntegration: codeIntegrations[0],
    };

    if (defenderIntegration) {
      result.cloudIntegration = this.createDefenderIntegration(defenderIntegration);
    }

    return result;
  }

  /**
   * Create GitHub integration from custom integration config
   */
  private createGitHubIntegration(tenantId: string, integration: CustomIntegration): GitHubIntegration {
    // Parse installation ID from config
    const installationId = integration.config.installationId;
    
    if (!installationId) {
      throw new Error(`GitHub integration ${integration.id} missing installationId in config`);
    }

    return new GitHubIntegration({
      tenantId,
      installationId: installationId.toString(),
    });
  }

  /**
   * Create GitLab integration from custom integration config
   */
  private createGitLabIntegration(tenantId: string, integration: CustomIntegration): GitLabIntegration {
    const { groupAccessToken, groupId, baseUrl } = integration.config;

    if (!groupAccessToken) {
      throw new Error(`GitLab integration ${integration.id} missing groupAccessToken in config`);
    }

    return new GitLabIntegration({
      tenantId,
      groupAccessToken,
      groupId: groupId || undefined,
      baseUrl: baseUrl || undefined,
    });
  }

  /**
   * Create Microsoft Defender integration from custom integration config
   */
  private createDefenderIntegration(integration: CustomIntegration): MicrosoftDefenderIntegration {
    const config = integration.config;
    
    if (!config.tenantId || !config.clientId || !config.clientSecret) {
      throw new Error(`Microsoft Defender integration ${integration.id} missing required config (tenantId, clientId, clientSecret)`);
    }

    return new MicrosoftDefenderIntegration({
      tenantId: config.tenantId,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      subscriptionId: config.subscriptionId,
    });
  }
}
