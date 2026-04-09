import { Tool, ToolResult, ToolCategory, GitToolConfig } from '@ai-agent/core';
import { CodeIntegrationHandler, CodeIntegrationRepository } from '../types';
import type { NormalisedPR } from '../types';

const GitLabCategory: ToolCategory = {
  name: 'gitlab',
  description: 'GitLab repository and issue management tools',
  keywords: ['gitlab', 'repository', 'issue', 'merge-request', 'code'],
};

export interface GitLabConfig {
  tenantId: string;
  /** Long-lived Group Access Token — stored secret */
  groupAccessToken: string;
  /** Optional: namespace/path of the group to scope repository discovery */
  groupId?: string;
  /** Optional: defaults to 'https://gitlab.com' */
  baseUrl?: string;
}

interface GitLabProject {
  id: number;
  name: string;
  name_with_namespace: string;
  path_with_namespace: string;
  description: string | null;
  default_branch: string;
  http_url_to_repo: string;
  web_url: string;
  visibility: string;
  programming_language?: string;
}

interface GitLabIssue {
  id: number;
  iid: number;
  title: string;
  description: string | null;
  state: string;
  web_url: string;
  author: { username: string } | null;
  labels: string[];
  created_at: string;
  updated_at: string;
}

interface GitLabMR {
  id: number;
  iid: number;
  title: string;
  web_url: string;
  state: string;
}

export class GitLabIntegration implements CodeIntegrationHandler {
  id = 'gitlab';
  name = 'GitLab';

  constructor(private config: GitLabConfig) {}

  /** Validate that the token is valid and reachable (calls /api/v4/user). */
  static async validate(config: GitLabConfig): Promise<{ valid: boolean; error?: string }> {
    if (!config.groupAccessToken) {
      return { valid: false, error: 'GitLab groupAccessToken is required' };
    }

    const base = GitLabIntegration.normaliseBaseUrl(config.baseUrl);

    try {
      const res = await fetch(`${base}/api/v4/user`, {
        headers: {
          Authorization: `Bearer ${config.groupAccessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (res.status === 401) {
        return { valid: false, error: 'Invalid or expired GitLab token. Check the Group Access Token value.' };
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { valid: false, error: `GitLab API returned ${res.status}: ${text}` };
      }

      return { valid: true };
    } catch (err: any) {
      return { valid: false, error: err?.message ?? String(err) };
    }
  }

  /** Return the access token — no caching needed; long-lived PAT. */
  public async getAccessToken(): Promise<string> {
    return this.config.groupAccessToken;
  }

  /** Build an authenticated clone URL for the given HTTPS repository URL. */
  public buildCloneUrl(repoUrl: string): string {
    // Ensure we never embed plain http for non-localhost
    const url = GitLabIntegration.enforceHttps(repoUrl);
    // Inject token as basic-auth credential (oauth2 user required by GitLab)
    return url.replace('https://', `https://oauth2:${this.config.groupAccessToken}@`);
  }

  /**
   * List projects accessible to the token.
   * If groupId is set, list group projects; otherwise list all accessible projects.
   */
  public async getRepositories(): Promise<CodeIntegrationRepository[]> {
    const base = GitLabIntegration.normaliseBaseUrl(this.config.baseUrl);
    const repos: CodeIntegrationRepository[] = [];
    const perPage = 100;
    let page = 1;
    const maxPages = 10;

    try {
      while (page <= maxPages) {
        let url: string;

        if (this.config.groupId) {
          const groupId = encodeURIComponent(this.config.groupId);
          url = `${base}/api/v4/groups/${groupId}/projects?include_subgroups=true&per_page=${perPage}&page=${page}&archived=false`;
        } else {
          url = `${base}/api/v4/projects?membership=true&per_page=${perPage}&page=${page}&archived=false`;
        }

        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.config.groupAccessToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (!res.ok) {
          console.error(`[GitLab] Failed to list projects (${res.status})`);
          break;
        }

        const projects: GitLabProject[] = await res.json() as GitLabProject[];

        for (const project of projects) {
          repos.push({
            name: project.path_with_namespace || project.name,
            url: project.http_url_to_repo,
            language: project.programming_language,
            description: project.description ?? undefined,
            defaultBranch: project.default_branch || 'main',
          });
        }

        if (projects.length < perPage) break;
        page++;
      }
    } catch (err: any) {
      console.error('[GitLab] Error listing repositories:', err?.message ?? err);
    }

    return repos;
  }

  /** Tools exposed to the agent runtime (non-coding, general purpose) */
  getTools(): Tool[] {
    return [];
  }

  /** Coding tools: create MR, list issues, create issue */
  getCodingTools(config: GitToolConfig): Tool[] {
    return [
      this.createCreateMergeRequestTool(config),
      this.createListIssuesTool(config),
      this.createCreateIssueTool(config),
    ];
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async fetchJson<T>(path: string): Promise<T> {
    const base = GitLabIntegration.normaliseBaseUrl(this.config.baseUrl);
    const res = await fetch(`${base}${path}`, {
      headers: {
        Authorization: `Bearer ${this.config.groupAccessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GitLab API ${path} returned ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  private async postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const base = GitLabIntegration.normaliseBaseUrl(this.config.baseUrl);
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.groupAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GitLab API POST ${path} returned ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  /**
   * Resolve the numeric project ID from a full path_with_namespace or numeric ID string.
   * GitLab accepts URL-encoded path in place of numeric ID.
   */
  private resolveProjectId(projectRef: string): string {
    // If it looks like a pure number, pass as-is; otherwise URL-encode it
    if (/^\d+$/.test(projectRef)) return projectRef;
    return encodeURIComponent(projectRef);
  }

  private createCreateMergeRequestTool(gitConfig: GitToolConfig): Tool {
    return {
      name: 'gitlabCreateMergeRequest',
      category: GitLabCategory,
      description: `Create a merge request in a GitLab project using the current fix branch as source and the repository default branch as target`,
      parameters: [
        { name: 'title', description: 'Merge request title', required: true, type: 'string' },
        { name: 'description', description: 'MR description / body', required: true, type: 'string' },
        { name: 'draft', description: 'Create as a draft MR', required: false, type: 'boolean' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, any>): Promise<ToolResult> => {
        try {
          const projectId = this.resolveProjectId(gitConfig.repository);
          const title = params.draft === true || params.draft === 'true'
            ? `Draft: ${params.title}`
            : params.title;

          const mr = await this.postJson<GitLabMR>(`/api/v4/projects/${projectId}/merge_requests`, {
            title,
            description: params.description,
            source_branch: gitConfig.currentBranch,
            target_branch: gitConfig.mainBranch,
          });

          return {
            success: true,
            message: 'Merge request created successfully',
            result: {
              id: mr.id,
              iid: mr.iid,
              title: mr.title,
              url: mr.web_url,
              state: mr.state,
            },
          };
        } catch (err: any) {
          return { success: false, message: err?.message ?? 'Failed to create merge request', error: err?.toString?.() };
        }
      },
    };
  }

  private createListIssuesTool(_gitConfig: GitToolConfig): Tool {
    return {
      name: 'gitlabListIssues',
      category: GitLabCategory,
      description: `List issues for a GitLab project. Tenant: ${this.config.tenantId}`,
      parameters: [
        { name: 'project', description: 'Project path (e.g. my-org/my-repo) or numeric project ID', required: true, type: 'string' },
        { name: 'state', description: 'Issue state filter: opened, closed, or all', required: false, type: 'string' },
        { name: 'perPage', description: 'Number of issues to return (max 100)', required: false, type: 'number' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, any>): Promise<ToolResult> => {
        try {
          const projectId = this.resolveProjectId(params.project);
          const state = params.state || 'opened';
          const perPage = params.perPage || 30;
          const issues = await this.fetchJson<GitLabIssue[]>(
            `/api/v4/projects/${projectId}/issues?state=${state}&per_page=${perPage}`
          );

          return {
            success: true,
            message: 'Issues retrieved successfully',
            result: {
              issues: issues.map((issue) => ({
                id: issue.id,
                iid: issue.iid,
                title: issue.title,
                description: issue.description,
                state: issue.state,
                url: issue.web_url,
                author: issue.author?.username,
                labels: issue.labels,
                createdAt: issue.created_at,
                updatedAt: issue.updated_at,
              })),
              tenantId: this.config.tenantId,
            },
          };
        } catch (err: any) {
          return { success: false, message: err?.message ?? 'Failed to list issues', error: err?.toString?.() };
        }
      },
    };
  }

  private createCreateIssueTool(_gitConfig: GitToolConfig): Tool {
    return {
      name: 'gitlabCreateIssue',
      category: GitLabCategory,
      description: `Create a new issue in a GitLab project. Tenant: ${this.config.tenantId}`,
      parameters: [
        { name: 'project', description: 'Project path (e.g. my-org/my-repo) or numeric project ID', required: true, type: 'string' },
        { name: 'title', description: 'Issue title', required: true, type: 'string' },
        { name: 'description', description: 'Issue description', required: false, type: 'string' },
        { name: 'labels', description: 'Comma-separated list of labels', required: false, type: 'string' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, any>): Promise<ToolResult> => {
        try {
          const projectId = this.resolveProjectId(params.project);
          const labels = params.labels ? params.labels.split(',').map((l: string) => l.trim()) : undefined;

          const issue = await this.postJson<GitLabIssue>(`/api/v4/projects/${projectId}/issues`, {
            title: params.title,
            description: params.description,
            ...(labels ? { labels: labels.join(',') } : {}),
          });

          return {
            success: true,
            message: 'Issue created successfully',
            result: {
              id: issue.id,
              iid: issue.iid,
              title: issue.title,
              url: issue.web_url,
              state: issue.state,
              createdAt: issue.created_at,
              tenantId: this.config.tenantId,
            },
          };
        } catch (err: any) {
          return { success: false, message: err?.message ?? 'Failed to create issue', error: err?.toString?.() };
        }
      },
    };
  }

  // ─── PR comment ──────────────────────────────────────────────────────────

  /**
   * Post a comment on an MR.
   *
   * Security: projectRef is resolved to a numeric id; mrIid is an integer;
   * body is plain Markdown composed from internal report data only — no user
   * input is interpolated.
   */
  public async postPRComment(
    projectRef: string,
    mrIid: number,
    body: string,
  ): Promise<void> {
    const pid = this.resolveProjectId(projectRef);
    await this.postJson(
      `/api/v4/projects/${pid}/merge_requests/${mrIid}/notes`,
      { body },
    );
  }

  // ─── MR correlation methods ───────────────────────────────────────────────

  /**
   * List MRs for a source branch.
   * Security: [Critical-3] — projectRef and branch are passed as encodeURIComponent values;
   * never concatenated raw into query strings.
   */
  public async listMRsForBranch(projectRef: string, branch: string): Promise<NormalisedPR[]> {
    const pid = this.resolveProjectId(projectRef);
    const state = 'all';
    const mrs = await this.fetchJson<any[]>(
      `/api/v4/projects/${pid}/merge_requests?source_branch=${encodeURIComponent(branch)}&state=${state}&per_page=30`,
    );
    return mrs.map(mr => this.normaliseMR(mr, projectRef));
  }

  /**
   * List MRs containing a specific commit SHA.
   * Security: [Critical-3] — sha is passed via encodeURIComponent.
   * Note: GitLab 15.6+ required; older versions fall back gracefully (empty array).
   */
  public async listMRsForCommit(projectRef: string, sha: string): Promise<NormalisedPR[]> {
    const pid = this.resolveProjectId(projectRef);
    try {
      const mrs = await this.fetchJson<any[]>(
        `/api/v4/projects/${pid}/repository/commits/${encodeURIComponent(sha)}/merge_requests`,
      );
      return mrs.map(mr => this.normaliseMR(mr, projectRef));
    } catch {
      // GitLab < 15.6 or commit not found — return empty, caller falls back to branch search
      return [];
    }
  }

  /**
   * List recently-updated MRs across all states, optionally since a given ISO timestamp.
   * Used as a broad candidate pool when no commit SHA or branch name is available.
   *
   * Security: [Critical-3] — projectRef is resolved to a numeric id; `since` is
   * encoded as a query parameter; no raw user input is concatenated.
   */
  public async listRecentMRs(
    projectRef: string,
    since?: string,
    perPage = 50,
  ): Promise<NormalisedPR[]> {
    const pid = this.resolveProjectId(projectRef);
    const sinceParam = since ? `&updated_after=${encodeURIComponent(since)}` : '';
    try {
      const mrs = await this.fetchJson<any[]>(
        `/api/v4/projects/${pid}/merge_requests?state=all&order_by=updated_at&sort=desc&per_page=${perPage}${sinceParam}`,
      );
      return mrs.map(mr => this.normaliseMR(mr, projectRef));
    } catch {
      // [Medium-12] Swallow upstream errors gracefully
      return [];
    }
  }

  /**
   * Fetch a single MR by iid.
   * Security: [Critical-3] — mrIid is an integer, no injection risk; projectRef is encoded.
   */
  public async getMR(projectRef: string, mrIid: number): Promise<NormalisedPR> {
    const pid = this.resolveProjectId(projectRef);
    const mr = await this.fetchJson<any>(`/api/v4/projects/${pid}/merge_requests/${mrIid}`);
    return this.normaliseMR(mr, projectRef);
  }

  /** Normalise a GitLab REST MR response into the provider-agnostic NormalisedPR shape. */
  private normaliseMR(mr: any, repository: string): NormalisedPR {
    const state: NormalisedPR['prState'] =
      mr.state === 'merged' ? 'merged' :
      mr.state === 'closed' ? 'closed' :
      'open';

    return {
      provider: 'gitlab',
      repository,
      prNumber: mr.iid,
      prUrl: mr.web_url,
      prTitle: mr.title,
      prState: state,
      prAuthorLogin: mr.author?.username ?? '',
      headSha: mr.sha ?? mr.diff_refs?.head_sha ?? '',
      headBranch: mr.source_branch ?? '',
      baseBranch: mr.target_branch ?? '',
      openedAt: mr.created_at,
      ...(mr.merged_at ? { mergedAt: mr.merged_at } : {}),
      ...(mr.closed_at ? { closedAt: mr.closed_at } : {}),
    };
  }

  // ─── Static utilities ─────────────────────────────────────────────────────
  /** Normalise and validate a GitLab base URL. Defaults to https://gitlab.com. */
  static normaliseBaseUrl(baseUrl?: string): string {
    const url = (baseUrl ? baseUrl : 'https://gitlab.com').trim().replace(/\/$/, '');
    if (!url.startsWith('https://') && !url.startsWith('http://localhost') && !url.startsWith('http://127.')) {
      throw new Error(`GitLab baseUrl must use HTTPS (got: ${url})`);
    }
    return url;
  }

  /** Force https scheme, except for localhost/loopback which may use http. */
  static enforceHttps(url: string): string {
    if (url.startsWith('http://') && !url.includes('localhost') && !url.includes('127.')) {
      return url.replace('http://', 'https://');
    }
    return url;
  }
}
