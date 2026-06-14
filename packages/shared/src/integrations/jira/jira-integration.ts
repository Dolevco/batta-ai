import { CustomIntegrationHandler } from '../../types';
import { Tool, ToolResult, ToolCategory } from '@batta/core';
import { decrypt } from '../../utils/encryption';

export const JiraCategory: ToolCategory = {
  name: 'jira',
  description: 'Jira project management and issue tracking tools',
  keywords: ['jira', 'issue', 'ticket', 'sprint', 'project', 'backlog', 'task'],
};

export interface JiraConfig {
  tenantId: string;
  baseUrl: string;
  userEmail: string;
  apiToken: string;
  projectKeys?: string;
}

export class JiraIntegration implements CustomIntegrationHandler {
  id = 'jira';
  name = 'Jira';

  constructor(private config: JiraConfig) {}

  static async validate(config: JiraConfig): Promise<{ valid: boolean; error?: string }> {
    try {
      const authHeader = Buffer.from(`${config.userEmail}:${config.apiToken}`).toString('base64');
      const url = `${config.baseUrl.replace(/\/$/, '')}/rest/api/3/myself`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Basic ${authHeader}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });
      if (response.status === 401 || response.status === 403) {
        return { valid: false, error: 'Invalid credentials' };
      }
      if (!response.ok) {
        return { valid: false, error: `Jira returned HTTP ${response.status}` };
      }
      return { valid: true };
    } catch (err: any) {
      return { valid: false, error: err?.message ?? String(err) };
    }
  }

  getTools(): Tool[] {
    return [
      this.createSearchIssuesTool(),
      this.createGetIssueTool(),
      this.createCreateIssueTool(),
      this.createUpdateIssueTool(),
      this.createTransitionIssueTool(),
      this.createAddCommentTool(),
      this.createGetProjectIssuesTool(),
      this.createGetMyIssuesTool(),
      this.createGetSprintIssuesTool(),
      this.createGetProjectsTool(),
    ];
  }

  // Try to decrypt; if the value is not encrypted (e.g. during validate before save), use as-is.
  private static resolveToken(apiToken: string): string {
    try {
      return decrypt(apiToken);
    } catch {
      return apiToken;
    }
  }

  private getAuthHeader(): string {
    const token = JiraIntegration.resolveToken(this.config.apiToken);
    return `Basic ${Buffer.from(`${this.config.userEmail}:${token}`).toString('base64')}`;
  }

  private baseUrl(): string {
    return this.config.baseUrl.replace(/\/$/, '');
  }

  private async jiraSearch(jql: string, fields: string[], maxResults: number): Promise<any> {
    return this.jiraFetch('/rest/api/3/search/jql', {
      method: 'POST',
      body: JSON.stringify({ jql, fields, maxResults }),
    });
  }

  private async jiraFetch(path: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseUrl()}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: this.getAuthHeader(),
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });

    if (response.status === 401) throw new Error('Jira authentication failed: invalid credentials');
    if (response.status === 403) throw new Error('Jira authorization failed: token lacks permission');
    if (response.status === 404) throw new Error('Jira resource not found');
    if (response.status === 429) throw new Error('Jira rate limit exceeded, please retry later');

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Jira API error ${response.status}: ${body}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  // ─── Tool factories ────────────────────────────────────────────────────────

  private createSearchIssuesTool(): Tool {
    return {
      name: 'jiraSearchIssues',
      category: JiraCategory,
      description: `Search Jira issues using JQL (Jira Query Language). Tenant: ${this.config.tenantId}`,
      parameters: [
        { name: 'jql', description: 'JQL query string, e.g. project = ENG AND status = "In Progress"', required: true, type: 'string' },
        { name: 'maxResults', description: 'Maximum number of results to return (default 20)', required: false, type: 'string' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, string>): Promise<ToolResult> => {
        try {
          const max = params.maxResults ? parseInt(params.maxResults, 10) : 20;
          const data = await this.jiraSearch(
            params.jql,
            ['summary', 'status', 'assignee', 'priority', 'issuetype', 'description', 'created', 'updated'],
            max
          );
          return { success: true, message: `Found ${data.issues?.length ?? 0} issues`, result: data };
        } catch (err: any) {
          return { success: false, message: err?.message ?? String(err), error: err?.toString() };
        }
      },
    };
  }

  private createGetIssueTool(): Tool {
    return {
      name: 'jiraGetIssue',
      category: JiraCategory,
      description: `Get full details of a single Jira issue by key (e.g. ENG-123). Tenant: ${this.config.tenantId}`,
      parameters: [
        { name: 'issueKey', description: 'Issue key, e.g. ENG-123', required: true, type: 'string' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, string>): Promise<ToolResult> => {
        try {
          const data = await this.jiraFetch(`/rest/api/3/issue/${encodeURIComponent(params.issueKey)}`);
          return { success: true, message: `Fetched issue ${params.issueKey}`, result: data };
        } catch (err: any) {
          return { success: false, message: err?.message ?? String(err), error: err?.toString() };
        }
      },
    };
  }

  private createCreateIssueTool(): Tool {
    return {
      name: 'jiraCreateIssue',
      category: JiraCategory,
      description: `Create a new Jira issue. Tenant: ${this.config.tenantId}`,
      parameters: [
        { name: 'projectKey', description: 'Project key, e.g. ENG', required: true, type: 'string' },
        { name: 'summary', description: 'Issue summary / title', required: true, type: 'string' },
        { name: 'issueType', description: 'Issue type: Bug, Story, or Task', required: true, type: 'string' },
        { name: 'description', description: 'Issue description (plain text)', required: false, type: 'string' },
        { name: 'priority', description: 'Priority: Highest, High, Medium, Low, Lowest', required: false, type: 'string' },
        { name: 'assignee', description: 'Assignee account ID', required: false, type: 'string' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, string>): Promise<ToolResult> => {
        try {
          const body: Record<string, any> = {
            fields: {
              project: { key: params.projectKey },
              summary: params.summary,
              issuetype: { name: params.issueType },
            },
          };
          if (params.description) {
            body.fields.description = {
              type: 'doc',
              version: 1,
              content: [{ type: 'paragraph', content: [{ type: 'text', text: params.description }] }],
            };
          }
          if (params.priority) body.fields.priority = { name: params.priority };
          if (params.assignee) body.fields.assignee = { id: params.assignee };

          const data = await this.jiraFetch('/rest/api/3/issue', {
            method: 'POST',
            body: JSON.stringify(body),
          });
          return { success: true, message: `Created issue ${data.key}`, result: data };
        } catch (err: any) {
          return { success: false, message: err?.message ?? String(err), error: err?.toString() };
        }
      },
    };
  }

  private createUpdateIssueTool(): Tool {
    return {
      name: 'jiraUpdateIssue',
      category: JiraCategory,
      description: `Update fields of an existing Jira issue. Tenant: ${this.config.tenantId}`,
      parameters: [
        { name: 'issueKey', description: 'Issue key, e.g. ENG-123', required: true, type: 'string' },
        { name: 'summary', description: 'New summary', required: false, type: 'string' },
        { name: 'description', description: 'New description (plain text)', required: false, type: 'string' },
        { name: 'priority', description: 'New priority', required: false, type: 'string' },
        { name: 'assignee', description: 'New assignee account ID', required: false, type: 'string' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, string>): Promise<ToolResult> => {
        try {
          const fields: Record<string, any> = {};
          if (params.summary) fields.summary = params.summary;
          if (params.description) {
            fields.description = {
              type: 'doc',
              version: 1,
              content: [{ type: 'paragraph', content: [{ type: 'text', text: params.description }] }],
            };
          }
          if (params.priority) fields.priority = { name: params.priority };
          if (params.assignee) fields.assignee = { id: params.assignee };

          await this.jiraFetch(`/rest/api/3/issue/${encodeURIComponent(params.issueKey)}`, {
            method: 'PUT',
            body: JSON.stringify({ fields }),
          });
          return { success: true, message: `Updated issue ${params.issueKey}`, result: { issueKey: params.issueKey } };
        } catch (err: any) {
          return { success: false, message: err?.message ?? String(err), error: err?.toString() };
        }
      },
    };
  }

  private createTransitionIssueTool(): Tool {
    return {
      name: 'jiraTransitionIssue',
      category: JiraCategory,
      description: `Change the status of a Jira issue (e.g. move to "In Progress" or "Done"). Tenant: ${this.config.tenantId}`,
      parameters: [
        { name: 'issueKey', description: 'Issue key, e.g. ENG-123', required: true, type: 'string' },
        { name: 'transitionName', description: 'Target status name, e.g. "In Progress", "Done", "To Do"', required: true, type: 'string' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, string>): Promise<ToolResult> => {
        try {
          const transitionsData = await this.jiraFetch(
            `/rest/api/3/issue/${encodeURIComponent(params.issueKey)}/transitions`
          );
          const transitions: any[] = transitionsData.transitions ?? [];
          const match = transitions.find(
            (t: any) => t.name.toLowerCase() === params.transitionName.toLowerCase()
          );
          if (!match) {
            const available = transitions.map((t: any) => t.name).join(', ');
            return {
              success: false,
              message: `Transition "${params.transitionName}" not found. Available: ${available}`,
              error: 'transition_not_found',
            };
          }

          await this.jiraFetch(`/rest/api/3/issue/${encodeURIComponent(params.issueKey)}/transitions`, {
            method: 'POST',
            body: JSON.stringify({ transition: { id: match.id } }),
          });
          return { success: true, message: `Transitioned ${params.issueKey} to "${match.name}"`, result: { issueKey: params.issueKey, transition: match.name } };
        } catch (err: any) {
          return { success: false, message: err?.message ?? String(err), error: err?.toString() };
        }
      },
    };
  }

  private createAddCommentTool(): Tool {
    return {
      name: 'jiraAddComment',
      category: JiraCategory,
      description: `Add a comment to a Jira issue. Tenant: ${this.config.tenantId}`,
      parameters: [
        { name: 'issueKey', description: 'Issue key, e.g. ENG-123', required: true, type: 'string' },
        { name: 'body', description: 'Comment text', required: true, type: 'string' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, string>): Promise<ToolResult> => {
        try {
          const data = await this.jiraFetch(
            `/rest/api/3/issue/${encodeURIComponent(params.issueKey)}/comment`,
            {
              method: 'POST',
              body: JSON.stringify({
                body: {
                  type: 'doc',
                  version: 1,
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: params.body }] }],
                },
              }),
            }
          );
          return { success: true, message: `Comment added to ${params.issueKey}`, result: data };
        } catch (err: any) {
          return { success: false, message: err?.message ?? String(err), error: err?.toString() };
        }
      },
    };
  }

  private createGetProjectIssuesTool(): Tool {
    return {
      name: 'jiraGetProjectIssues',
      category: JiraCategory,
      description: `List issues in a Jira project with optional status and assignee filters. Tenant: ${this.config.tenantId}`,
      parameters: [
        { name: 'projectKey', description: 'Project key, e.g. ENG', required: true, type: 'string' },
        { name: 'status', description: 'Filter by status, e.g. "In Progress"', required: false, type: 'string' },
        { name: 'assignee', description: 'Filter by assignee account ID or "currentUser()"', required: false, type: 'string' },
        { name: 'maxResults', description: 'Maximum results (default 20)', required: false, type: 'string' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, string>): Promise<ToolResult> => {
        try {
          let jql = `project = "${params.projectKey}"`;
          if (params.status) jql += ` AND status = "${params.status}"`;
          if (params.assignee) jql += ` AND assignee = ${params.assignee}`;
          jql += ' ORDER BY updated DESC';

          const max = params.maxResults ? parseInt(params.maxResults, 10) : 20;
          const data = await this.jiraSearch(
            jql,
            ['summary', 'status', 'assignee', 'priority', 'issuetype', 'created', 'updated'],
            max
          );
          return { success: true, message: `Found ${data.issues?.length ?? 0} issues in ${params.projectKey}`, result: data };
        } catch (err: any) {
          return { success: false, message: err?.message ?? String(err), error: err?.toString() };
        }
      },
    };
  }

  private createGetMyIssuesTool(): Tool {
    return {
      name: 'jiraGetMyIssues',
      category: JiraCategory,
      description: `Get Jira issues assigned to the current user. Tenant: ${this.config.tenantId}`,
      parameters: [
        { name: 'status', description: 'Filter by status, e.g. "In Progress"', required: false, type: 'string' },
        { name: 'maxResults', description: 'Maximum results (default 20)', required: false, type: 'string' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, string>): Promise<ToolResult> => {
        try {
          let jql = 'assignee = currentUser()';
          if (params.status) jql += ` AND status = "${params.status}"`;
          jql += ' ORDER BY updated DESC';

          const max = params.maxResults ? parseInt(params.maxResults, 10) : 20;
          const data = await this.jiraSearch(
            jql,
            ['summary', 'status', 'priority', 'issuetype', 'project', 'created', 'updated'],
            max
          );
          return { success: true, message: `Found ${data.issues?.length ?? 0} issues assigned to current user`, result: data };
        } catch (err: any) {
          return { success: false, message: err?.message ?? String(err), error: err?.toString() };
        }
      },
    };
  }

  private createGetSprintIssuesTool(): Tool {
    return {
      name: 'jiraGetSprintIssues',
      category: JiraCategory,
      description: `Get issues in the active (or future/closed) sprint for a project. Resolves the board automatically from the project key. Tenant: ${this.config.tenantId}`,
      parameters: [
        { name: 'projectKey', description: 'Project key, e.g. ENG', required: true, type: 'string' },
        { name: 'sprintState', description: 'Sprint state: active (default), future, or closed', required: false, type: 'string' },
        { name: 'maxResults', description: 'Maximum results (default 50)', required: false, type: 'string' },
      ],
      isInteractionTool: false,
      execute: async (params: Record<string, string>): Promise<ToolResult> => {
        try {
          const state = params.sprintState || 'active';
          const max = params.maxResults ? parseInt(params.maxResults, 10) : 50;

          // Resolve board ID from project key
          const boardsData = await this.jiraFetch(
            `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(params.projectKey)}&type=scrum`
          );
          const boards: any[] = boardsData.values ?? [];
          if (boards.length === 0) {
            return { success: false, message: `No scrum board found for project ${params.projectKey}`, error: 'no_board' };
          }
          const boardId = boards[0].id;

          // Get sprints with the requested state
          const sprintsData = await this.jiraFetch(
            `/rest/agile/1.0/board/${boardId}/sprint?state=${encodeURIComponent(state)}`
          );
          const sprints: any[] = sprintsData.values ?? [];
          if (sprints.length === 0) {
            return { success: false, message: `No ${state} sprint found for project ${params.projectKey}`, error: 'no_sprint' };
          }
          const sprint = sprints[sprints.length - 1]; // most recent

          const issuesData = await this.jiraFetch(
            `/rest/agile/1.0/board/${boardId}/sprint/${sprint.id}/issue?maxResults=${max}&fields=summary,status,assignee,priority,issuetype`
          );
          return {
            success: true,
            message: `Found ${issuesData.issues?.length ?? 0} issues in sprint "${sprint.name}"`,
            result: { sprint, issues: issuesData.issues },
          };
        } catch (err: any) {
          return { success: false, message: err?.message ?? String(err), error: err?.toString() };
        }
      },
    };
  }

  private createGetProjectsTool(): Tool {
    return {
      name: 'jiraGetProjects',
      category: JiraCategory,
      description: `List all Jira projects accessible with the configured credentials. Tenant: ${this.config.tenantId}`,
      parameters: [],
      isInteractionTool: false,
      execute: async (_params: Record<string, string>): Promise<ToolResult> => {
        try {
          const data = await this.jiraFetch('/rest/api/3/project/search?orderBy=name&maxResults=100');
          return { success: true, message: `Found ${data.values?.length ?? 0} projects`, result: data };
        } catch (err: any) {
          return { success: false, message: err?.message ?? String(err), error: err?.toString() };
        }
      },
    };
  }
}
