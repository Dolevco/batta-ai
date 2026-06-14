import { Octokit } from '@octokit/rest';
import { getInstallationToken } from './github-auth';
import { decrypt } from '../../utils/encryption';
import { Tool, ToolResult, ToolCategory, GitToolConfig } from '@batta/core';
import { CodeIntegrationHandler, CodeIntegrationRepository } from '../../types';
import type { NormalisedPR } from '../../types';

const GitHubCategory: ToolCategory = {
  name: 'github',
  description: 'GitHub repository and issue management tools',
  keywords: ['github', 'repository', 'issue', 'code'],
};

export interface GitHubConfig {
  tenantId: string;
  authType?: 'oauth' | 'token';
  // OAuth fields
  installationId?: string;
  appId?: string;
  // PAT fields
  personalAccessToken?: string;
  tokenScope?: string;
  accountLogin?: string;
}

export class GitHubIntegration implements CodeIntegrationHandler {
  id = 'github';
  name = 'GitHub';

  // Cache for installation token to avoid creating tokens on every call
  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor(private config: GitHubConfig) {}
  
  static async validate(config: GitHubConfig): Promise<{ valid: boolean; error?: string }> {
    if (config.authType === 'token') {
      if (!config.personalAccessToken) {
        return { valid: false, error: 'GitHub personalAccessToken is required' };
      }
      try {
        const instance = new GitHubIntegration(config);
        const token = await instance.getAccessToken();
        const octokit = new Octokit({ auth: token });
        await octokit.rest.users.getAuthenticated();
        return { valid: true };
      } catch (error: any) {
        return { valid: false, error: error?.message || 'Failed to validate GitHub token' };
      }
    }

    if (!config.installationId) {
      return { valid: false, error: 'GitHub installationId is required' };
    }

    try {
      const instance = new GitHubIntegration(config);
      const token = await instance.getAccessToken();
      const octokit = new Octokit({ auth: token });
      await octokit.rest.apps.listReposAccessibleToInstallation();
      return { valid: true };
    } catch (error: any) {
      return { valid: false, error: error?.message || 'Failed to validate GitHub installation' };
    }
  }

  getCodingTools(config: GitToolConfig): Tool[] {
    return [
      this.createCreatePullRequestTool(config),
    ];
  }

  getTools(): Tool[] {
    return [
    ];
  }

  private createCreatePullRequestTool(githubConfig: GitToolConfig): Tool {
    return {
      name: 'githubCreatePullRequest',
      category: GitHubCategory,
      description: `Create a pull request in a repository. using the current fix branch as head and repostitory default branch as base`,
      parameters: [
        { name: 'title', description: 'Pull request title', required: true, type: 'string' },
        { name: 'body', description: 'PR body', required: true, type: 'string' },
        { name: 'draft', description: 'Create as draft', required: false, type: 'boolean' }
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, any>): Promise<ToolResult> => {
        try {
          const token = await this.getAccessToken();
          const octokit = new Octokit({ auth: token });
          const [owner, repo] = githubConfig.repository.split('/');

          const { data } = await octokit.rest.pulls.create({
            owner,
            repo,
            title: params.title,
            head: githubConfig.currentBranch,
            base: githubConfig.mainBranch,
            body: params.body,
            draft: params.draft === true || params.draft === 'true',
          });

          return {
            success: true,
            message: 'Pull request created successfully',
            result: {
              id: data.id,
              number: data.number,
              title: data.title,
              url: data.html_url,
              state: data.state,
            },
          };
        } catch (error: any) {
          return {
            success: false,
            message: error?.message || 'Failed to create pull request',
            error: error?.toString?.(),
          };
        }
      },
    };
  }

  public async getAccessToken(): Promise<string> {
    if (this.config.authType === 'token') {
      if (!this.config.personalAccessToken) throw new Error('personalAccessToken is not configured');
      return decrypt(this.config.personalAccessToken);
    }

    // OAuth installation token path (cached)
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 5000) {
      return this.tokenCache.token;
    }

    const installationId = this.config.installationId;
    const authResult = await getInstallationToken(Number(installationId));
    const token = authResult.token;
    const expiresAt = authResult.expiresAt ? new Date(authResult.expiresAt).getTime() : (now + 55 * 60 * 1000);

    this.tokenCache = { token, expiresAt };
    return token;
  }

  // Return a list of repository objects accessible to this installation
  public async getRepositories(): Promise<CodeIntegrationRepository[]> {
    try {
      const token = await this.getAccessToken();
      const octokit = new Octokit({ auth: token });
      const per_page = 100;
      let page = 1;
      const repos: CodeIntegrationRepository[] = [];

      const maxPages = 10;
      while (page <= maxPages) {
        let response: any;
        if (this.config.authType === 'token') {
          response = await octokit.rest.repos.listForAuthenticatedUser({ per_page, page, visibility: 'all' });
        } else {
          response = await octokit.rest.apps.listReposAccessibleToInstallation({
            per_page,
            page,
            installation_id: Number(this.config.installationId),
          });
        }

        const reposArray: any[] = Array.isArray(response.data)
          ? response.data
          : (response.data as any).repositories || [];

        for (const repo of reposArray) {
          const fullName = repo.full_name || repo.fullName || (repo.owner?.login && repo.name ? `${repo.owner.login}/${repo.name}` : repo.name);
          if (!fullName) continue;
          repos.push({
            name: fullName.split('/').pop() || fullName,
            url: repo.html_url || repo.htmlUrl || `https://github.com/${fullName}`,
            language: repo.language,
            description: repo.description,
            defaultBranch: repo.default_branch || repo.defaultBranch || 'main',
          });
        }

        if (reposArray.length < per_page) break;
        page++;
      }

      return repos;
    } catch {
      // On error, return empty list so callers can handle gracefully
      return [];
    }
  }

  // ── PR correlation methods ────────────────────────────────────────────────

  /**
   * Resolve the HEAD commit SHA of a repository branch via the GitHub API.
   * Used by the orchestrator to skip enqueueing repos with no new commits.
   *
   * Security: repoUrl comes from the internal integration config. owner/repo
   * are extracted from the URL and passed as discrete Octokit fields — never
   * shell-interpolated.  The returned SHA is validated against the 40-char hex
   * format before being stored.
   */
  public async getHeadCommitSha(repoUrl: string, branch?: string): Promise<string | undefined> {
    try {
      // Parse owner/repo from the HTTPS URL, e.g. https://github.com/owner/repo
      const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/);
      if (!match) return undefined;
      const [, owner, repo] = match;

      const token = await this.getAccessToken();
      const octokit = new Octokit({ auth: token });

      // Fall back to the repo's default branch if none supplied
      const ref = branch ?? (await octokit.rest.repos.get({ owner, repo })).data.default_branch;

      const { data } = await octokit.rest.repos.getBranch({ owner, repo, branch: ref });
      const sha = data.commit?.sha;

      // Security: validate format before returning — prevents downstream injection
      if (sha && /^[0-9a-f]{40}$/i.test(sha)) return sha;
      return undefined;
    } catch {
      // Network / auth failures are non-fatal — caller falls back to full enqueue
      return undefined;
    }
  }

  /**
   * List open and closed PRs for a branch.
   *
   * Security: [Critical-3] — owner, repo, and branch are passed as discrete parameters
   * to octokit; octokit encodes them in the URL internally — no string concatenation.
   */
  public async listPRsForBranch(owner: string, repo: string, branch: string): Promise<NormalisedPR[]> {
    const token = await this.getAccessToken();
    const octokit = new Octokit({ auth: token });

    const results: NormalisedPR[] = [];
    for (const state of ['open', 'closed'] as const) {
      const { data } = await octokit.rest.pulls.list({
        owner,
        repo,
        head: `${owner}:${branch}`,
        state,
        per_page: 30,
      });
      results.push(...data.map(pr => this.normalisePR(pr, `${owner}/${repo}`)));
    }
    return results;
  }

  /**
   * Fetch PRs associated with a specific commit SHA.
   *
   * Security: [Critical-3] — owner, repo, and sha are discrete octokit parameters.
   */
  public async listPRsForCommit(owner: string, repo: string, sha: string): Promise<NormalisedPR[]> {
    const token = await this.getAccessToken();
    const octokit = new Octokit({ auth: token });

    const { data } = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
      owner,
      repo,
      commit_sha: sha,
    });
    return data.map(pr => this.normalisePR(pr, `${owner}/${repo}`));
  }

  /**
   * List recently-updated PRs (open + closed) updated since a given ISO timestamp.
   * Used as a broad candidate pool when no commit SHA or branch name is available.
   *
   * Security: [Critical-3] — all parameters are passed as discrete octokit fields;
   * no raw user input is interpolated into query strings.
   */
  public async listRecentPRs(
    owner: string,
    repo: string,
    since?: string,
    perPage = 50,
  ): Promise<NormalisedPR[]> {
    const token = await this.getAccessToken();
    const octokit = new Octokit({ auth: token });
    const results: NormalisedPR[] = [];

    for (const state of ['open', 'closed'] as const) {
      try {
        const { data } = await octokit.rest.pulls.list({
          owner,
          repo,
          state,
          sort: 'updated',
          direction: 'desc',
          per_page: perPage,
        });
        // Filter client-side to the requested time window (GitHub list doesn't support `since` for PRs)
        const filtered = since
          ? data.filter(pr => new Date(pr.updated_at).getTime() >= new Date(since).getTime())
          : data;
        results.push(...filtered.map(pr => this.normalisePR(pr, `${owner}/${repo}`)));
      } catch {
        // [Medium-12] Swallow upstream errors; partial results returned
      }
    }

    return results;
  }

  /**
   * Fetch a single PR by number.
   *
   * Security: [Critical-3] — owner, repo, pull_number are discrete octokit parameters.
   */
  public async getPR(owner: string, repo: string, prNumber: number): Promise<NormalisedPR> {
    const token = await this.getAccessToken();
    const octokit = new Octokit({ auth: token });

    const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
    return this.normalisePR(data, `${owner}/${repo}`);
  }

  /** Normalise a GitHub REST PR response into the provider-agnostic NormalisedPR shape. */
  private normalisePR(pr: any, repository: string): NormalisedPR {
    const state: NormalisedPR['prState'] =
      pr.merged_at ? 'merged' :
      pr.state === 'closed' ? 'closed' :
      'open';

    return {
      provider: 'github',
      repository,
      prNumber: pr.number,
      prUrl: pr.html_url,
      prTitle: pr.title,
      prState: state,
      prAuthorLogin: pr.user?.login ?? '',
      headSha: pr.head?.sha ?? '',
      headBranch: pr.head?.ref ?? '',
      baseBranch: pr.base?.ref ?? '',
      openedAt: pr.created_at,
      ...(pr.merged_at ? { mergedAt: pr.merged_at } : {}),
      ...(pr.closed_at ? { closedAt: pr.closed_at } : {}),
    };
  }
}
