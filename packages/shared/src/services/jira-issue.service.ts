import { decrypt } from '../utils/encryption';
import type { ICustomIntegrationRepository } from '../persistence/interfaces';

export interface JiraIssueSummary {
  issueKey: string;
  issueUrl: string;
  summary: string;
  issueType: string;
  projectKey: string;
  projectName?: string;
  description?: string;
  labels?: string[];
  components?: string[];
  reporter?: string;
  assignee?: string;
  priority?: string;
  linkedPrUrls?: string[];
}

export interface CreateJiraIssueInput {
  projectKey: string;
  issueType: string;
  summary: string;
  description: string;
  priority?: string;
  labels?: string[];
}

interface JiraCredentials {
  baseUrl: string;
  userEmail: string;
  apiToken: string;
}

const SECRET_PATTERN = /(?:password|secret|token|api[_-]?key|auth)[^\s]*\s*[:=]\s*\S+/gi;

function redactText(text: string): string {
  return text.replace(SECRET_PATTERN, '[REDACTED]');
}

function truncate(text: string | undefined, maxLen: number): string | undefined {
  if (!text) return undefined;
  const redacted = redactText(text);
  return redacted.length > maxLen ? redacted.slice(0, maxLen) : redacted;
}

function extractPlainText(descriptionField: unknown): string | undefined {
  if (!descriptionField) return undefined;
  if (typeof descriptionField === 'string') return descriptionField;
  // Atlassian Document Format
  const doc = descriptionField as any;
  if (doc.type === 'doc' && Array.isArray(doc.content)) {
    return extractAdfText(doc.content);
  }
  return undefined;
}

function extractAdfText(nodes: any[]): string {
  return nodes.map(node => {
    if (node.type === 'text') return node.text ?? '';
    if (Array.isArray(node.content)) return extractAdfText(node.content);
    return '';
  }).join('').trim();
}

export class JiraIssueService {
  constructor(private integrationRepository: ICustomIntegrationRepository) {}

  async hasConfiguredJira(tenantId: string): Promise<boolean> {
    const creds = await this.loadCredentials(tenantId);
    return creds !== null;
  }

  async getBaseUrl(tenantId: string): Promise<string> {
    const creds = await this.requireCredentials(tenantId);
    return creds.baseUrl.replace(/\/$/, '');
  }

  async getIssue(tenantId: string, issueKey: string): Promise<JiraIssueSummary> {
    const creds = await this.requireCredentials(tenantId);
    const safe = encodeURIComponent(issueKey);
    const [data, commentsData] = await Promise.all([
      this.jiraFetch(creds, `/rest/api/3/issue/${safe}?expand=renderedFields`),
      this.jiraFetch(creds, `/rest/api/3/issue/${safe}/comment?maxResults=10`).catch(() => null),
    ]);
    return this.mapIssue(data, creds.baseUrl, commentsData);
  }

  async createIssue(tenantId: string, input: CreateJiraIssueInput): Promise<{ issueKey: string; issueUrl: string }> {
    const creds = await this.requireCredentials(tenantId);
    const body: Record<string, any> = {
      fields: {
        project: { key: input.projectKey },
        summary: input.summary.slice(0, 255),
        issuetype: { name: input.issueType },
      },
    };

    if (input.description) {
      body.fields.description = {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: input.description }] }],
      };
    }
    if (input.priority) body.fields.priority = { name: input.priority };
    if (input.labels?.length) body.fields.labels = input.labels;

    const data = await this.jiraFetch(creds, '/rest/api/3/issue', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const baseUrl = creds.baseUrl.replace(/\/$/, '');
    return {
      issueKey: data.key,
      issueUrl: `${baseUrl}/browse/${data.key}`,
    };
  }

  private mapIssue(data: any, baseUrl: string, commentsData?: any): JiraIssueSummary {
    const fields = data.fields ?? {};
    const rendered = data.renderedFields ?? {};
    const base = baseUrl.replace(/\/$/, '');

    // Prefer ADF extraction, fall back to rendered HTML stripped of tags
    const rawDescription = extractPlainText(fields.description)
      ?? (rendered.description ? rendered.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : undefined);

    // Append top comments so the agent has more signal
    let commentText: string | undefined;
    const comments: any[] = commentsData?.comments ?? [];
    if (comments.length > 0) {
      const excerpts = comments
        .slice(0, 5)
        .map((c: any) => {
          const body = extractPlainText(c.body) ?? '';
          const author = c.author?.displayName ?? 'unknown';
          return body ? `[${author}]: ${body.slice(0, 400)}` : null;
        })
        .filter(Boolean);
      if (excerpts.length) commentText = excerpts.join('\n');
    }

    const combined = [rawDescription, commentText].filter(Boolean).join('\n\n---\n\n');
    const description = truncate(combined || undefined, 3000);

    const components: string[] = (fields.components ?? []).map((c: any) => c.name).filter(Boolean);
    const labels: string[] = (fields.labels ?? []).filter((l: string) => typeof l === 'string');

    return {
      issueKey: data.key,
      issueUrl: `${base}/browse/${data.key}`,
      summary: (fields.summary ?? '').slice(0, 500),
      issueType: fields.issuetype?.name ?? 'Unknown',
      projectKey: fields.project?.key ?? data.key.split('-')[0],
      projectName: fields.project?.name,
      description,
      labels: labels.length ? labels : undefined,
      components: components.length ? components : undefined,
      reporter: fields.reporter?.displayName,
      assignee: fields.assignee?.displayName,
      priority: fields.priority?.name,
    };
  }

  private async loadCredentials(tenantId: string): Promise<JiraCredentials | null> {
    try {
      const integrations = await this.integrationRepository.getAll(tenantId, true);
      const jiraIntegration = integrations.find(i =>
        i.id === 'jira' || (i as any).type === 'jira' || i.name?.toLowerCase() === 'jira'
      );
      if (!jiraIntegration) return null;

      const config = (jiraIntegration as any).config ?? {};
      if (!config.baseUrl || !config.userEmail || !config.apiToken) return null;

      let apiToken: string;
      try {
        apiToken = decrypt(config.apiToken);
      } catch {
        // Token stored as plaintext (not yet encrypted)
        apiToken = config.apiToken;
      }

      return { baseUrl: config.baseUrl, userEmail: config.userEmail, apiToken };
    } catch {
      return null;
    }
  }

  private async requireCredentials(tenantId: string): Promise<JiraCredentials> {
    const creds = await this.loadCredentials(tenantId);
    if (!creds) throw new JiraNotConfiguredError('Jira integration is not configured for this tenant');
    return creds;
  }

  private async jiraFetch(creds: JiraCredentials, path: string, options: RequestInit = {}): Promise<any> {
    const base = creds.baseUrl.replace(/\/$/, '');
    const authHeader = `Basic ${Buffer.from(`${creds.userEmail}:${creds.apiToken}`).toString('base64')}`;
    const url = `${base}${path}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options.headers ?? {}),
      },
    });

    if (response.status === 401) throw new Error('Jira authentication failed: invalid credentials');
    if (response.status === 403) throw new Error('Jira authorization failed: token lacks permission');
    if (response.status === 404) throw new JiraNotFoundError('Jira resource not found');
    if (response.status === 429) throw new Error('Jira rate limit exceeded, please retry later');

    if (!response.ok) {
      throw new Error(`Jira API error ${response.status}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
}

export class JiraNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JiraNotConfiguredError';
  }
}

export class JiraNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JiraNotFoundError';
  }
}
