import path from 'path';
import { createGitTools, GitToolConfig } from '../git';
import { Tool } from '../types';
import { createFileTools } from '../files';
import { createCommandTools } from '../command';

export interface CodeIntegrationConfig {
  name: string;
  description?: string;
  workspacePath: string;
  tools: Tool[];
  // Added fields to expose repository and branch information to callers
  repoName?: string;
  mainBranch?: string;
  currentBranch?: string;
}

export interface CodeIntegrationRepository {
  name: string;
  url: string;
  language?: string;
  defaultBranch?: string;
}

export interface CodeIntegrationHandlerInfo {
  id: string;
  name: string;
  description: string;
  getAccessToken: () => Promise<string>;
  getCodingTools: (config: GitToolConfig) => Tool[];
  repositories?: CodeIntegrationRepository[];
}

export interface CodeIntegrationInfo {
  id: string;
  name: string;
  description: string;
  repoUrl: string;
}

export class CodeIntegrationProvider {
  // Cache coding tools per repository (keyed by repository name like "owner/repo").
  private codingTools: Map<string, Tool[]> = new Map();
  private handlers: CodeIntegrationHandlerInfo[];
  private workspaceBasePath: string;

  constructor(
    handlers: CodeIntegrationHandlerInfo[],
    workspaceBasePath?: string
  ) {
    this.handlers = handlers;
    this.workspaceBasePath = workspaceBasePath || process.cwd();
  }

  public getCodeIntegrationsInfo(): CodeIntegrationInfo[] {
    return this.handlers.flatMap(handler => {
      if (handler.repositories && handler.repositories.length > 0) {
        return handler.repositories.map(repo => ({
          id: `${handler.id}(${repo.name})`,
          name: repo.name,
          description: handler.description || '',
          repoUrl: repo.url
        }));
      } 

      return [];
    });
  }

  getCodePromptSection(): string {
    const codeIntegrations = this.getCodeIntegrationsInfo();
    return codeIntegrations.length > 0
      ? `\n\n### Available Code Integrations

The following code integrations are available for tasks that require coding, git operations, or repository analysis:

${codeIntegrations.map(ci => `- **${ci.name}** (id: \`${ci.id}\`) ${ci.repoUrl} - ${ci.description ?? ''}`).join('\n')}

To use a code integration in a sub-task, specify the \`codeIntegrationId\` field with the integration's ID.
Once you use code integration, you will get the path to the repository and the relevant tools for coding (files, commands, git).
Use code integrations when the task involves:
- Reading, writing, or analyzing code files
- Git operations (clone, commit, push, pull, branch management)
- Repository exploration or dependency analysis
- Code review or refactoring tasks`
      : '';
  }

  async getConfig(codeIntegrationId: string): Promise<CodeIntegrationConfig> {
    // Support ids in the form: handlerId(repoName)
    let repoName = codeIntegrationId;
    let handlerId: string | undefined;

    const parsed = codeIntegrationId.match(/^(.+)\((.+)\)$/);
    if (parsed) {
      handlerId = parsed[1];
      repoName = parsed[2];
    } 

    let handler: CodeIntegrationHandlerInfo | undefined;
    if (handlerId) {
      handler = this.handlers.find(h => h.id === handlerId);
    } else {
      handler = this.handlers.find(h => h.repositories?.some(r => r.url.toLowerCase().includes(repoName.toLowerCase())));
    }
    
    if (!handler) {
      throw new Error(`Code integration ${handlerId} not found`);
    }

    // If a repoName was provided, try to find that repository on the handler.
    let repoObj = (handler.repositories || []).find(r => r.url.toLowerCase().includes(repoName.toLowerCase()));
    
    if (!repoObj) {
      throw new Error(`Repository ${repoName} not found for integration ${handlerId}`);
    }

    // Derive repository as "owner/repo" from the repo URL (strip leading slash and optional .git)
    const repoUrl = repoObj.url;
    let repository: string;
    try {
      const parsedUrl = new URL(repoUrl);
      repository = parsedUrl.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
    } catch {
      // Fallback for non-HTTP git URLs like "git@github.com:owner/repo.git"
      repository = repoUrl.replace(/^.*[:\/]+/, '').replace(/\.git$/i, '');
    }
    const gitProviderUrl = new URL(repoObj.url).origin;

    const defaultBranch = repoObj.defaultBranch!;
    // Create a deterministic branch name here so it can be returned in the config
    const currentBranch = `agent/fix/task-${Date.now()}`;
    const workspacePath = path.join('workspaces', (repoObj.name || repository).replace('/','_').replace('\\', '_'));
    const accessToken = await handler.getAccessToken();
    // Pass currentBranch through so the tools and returned config are aligned
    const tools = await this.getCodingTools(handler, repository, gitProviderUrl, defaultBranch, workspacePath, accessToken, currentBranch);
    
    return {
      name: repoName ? `${handler.name} - ${repoObj.name}` : handler.name,
      description: handler.description,
      workspacePath,
      tools,
      repoName: repoObj.name,
      mainBranch: defaultBranch,
      currentBranch
    };
  }

  private async getCodingTools(handler: CodeIntegrationHandlerInfo, repository: string, gitProviderUrl: string, defaultBranch: string, workspaceRelativePath: string, accessToken: string, currentBranch: string): Promise<Tool[]> {
    // Return cached tools for this repository if present
    if (this.codingTools.has(repository)) {
      return this.codingTools.get(repository)!;
    }

    const workspacePath = path.join(this.workspaceBasePath, workspaceRelativePath);
    const config = {
      workspacePath,
      gitProviderUrl,
      accessToken,
      repository,
      currentBranch,
      mainBranch: defaultBranch
    };
    const gitTools = await createGitTools(config);

    const tools = [...handler.getCodingTools(config), ...createFileTools({ workspacePath }), ...createCommandTools({ workspacePath }), ...gitTools];
    this.codingTools.set(repository, tools);
    return tools;
  }
}
