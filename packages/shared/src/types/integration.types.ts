import type { Tool, GitToolConfig } from '@batta/core';

export interface BaseIntegration {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface MCPHttpConfig {
  url: string;
  headers?: Record<string, string>;
}

export interface MCPStdioConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface MCPIntegration extends BaseIntegration {
  type: 'mcp';
  transport: 'http' | 'stdio';
  config: MCPHttpConfig | MCPStdioConfig;
}

export interface CustomIntegration extends BaseIntegration {
  type: 'custom' | 'code';
  config: Record<string, string>;
}

export type Integration = MCPIntegration | CustomIntegration;

export interface CustomIntegrationHandler {
  id: string;
  name: string;
  getTools(): Tool[];
}

export interface CodeIntegrationRepository {
  name: string;
  url: string;
  language?: string;
  description?: string;
  defaultBranch?: string;
}

export interface CodeIntegrationHandler extends CustomIntegrationHandler {
  getCodingTools: (config: GitToolConfig) => Tool[];
  getAccessToken: () => Promise<string>;
  getRepositories: () => Promise<CodeIntegrationRepository[]>;
  /**
   * Resolve the HEAD commit SHA of a repository's default (or specified) branch
   * without cloning the repo.
   *
   * Security: repoUrl is the internal URL from the integration config, not
   * user-supplied input. Implementations must validate it before use.
   *
   * @returns the 40-character hex SHA, or undefined if the API call fails.
   */
  getHeadCommitSha?: (repoUrl: string, branch?: string) => Promise<string | undefined>;
}
