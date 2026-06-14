import type { Request, Response } from 'express';
import type {
  SecurityReviewService,
  SecurityReviewAnswer,
  SecurityAttestation,
  AttestationArchitectureUpdate,
  JiraIssueService,
  WorkItemReviewRunner,
  SecurityReviewJiraExportService,
} from '@batta/shared';
import { JiraNotConfiguredError, JiraNotFoundError } from '@batta/shared';
import { explainSecurityRequirement, validateSecurityAttestations } from '../security-review/reviewRequirements';

/**
 * Resolves the tenant ID for security review endpoints.
 * Security: [Critical-1] — tenantId always comes from verified JWT; never from request body.
 */
function resolveTenantId(req: Request): string {
  if (req.auth?.tenantId) return req.auth.tenantId;
  throw new Error('Cannot fetch tenantId');
}

const JIRA_KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/;

function sanitizeIssueKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toUpperCase();
  return JIRA_KEY_PATTERN.test(trimmed) ? trimmed : null;
}

export class SecurityReviewController {
  constructor(
    private service: SecurityReviewService,
    private jiraService?: JiraIssueService,
    private workItemRunner?: WorkItemReviewRunner,
    private exportService?: SecurityReviewJiraExportService,
  ) {}

  // ── Existing endpoints ────────────────────────────────────────────────────

  async startReview(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const {
        featureDescription,
        repository,
        agentName,
        title,
        services,
        prLink,
        gitContext,
      } = req.body as {
        featureDescription?: string;
        repository?: string;
        agentName?: string;
        title?: string;
        services?: string[];
        prLink?: string;
        gitContext?: Record<string, unknown>;
      };

      if (!featureDescription?.trim()) {
        res.status(400).json({ error: 'featureDescription is required' });
        return;
      }

      const sanitizedRepository = typeof repository === 'string'
        ? repository.trim().slice(0, 200) || undefined
        : undefined;

      let sanitizedPrLink: string | undefined;
      if (typeof prLink === 'string' && prLink.trim()) {
        try {
          const url = new URL(prLink.trim());
          if (url.protocol === 'https:') sanitizedPrLink = url.href.slice(0, 500);
        } catch { /* discard invalid URL */ }
      }

      const review = await this.service.startReview(tenantId, featureDescription.trim(), {
        repository: sanitizedRepository,
        agentName: typeof agentName === 'string' ? agentName.trim().slice(0, 100) : undefined,
        title: typeof title === 'string' ? title.trim().slice(0, 200) : undefined,
        services: Array.isArray(services) ? services : undefined,
        prLink: sanitizedPrLink,
        gitContext: gitContext && typeof gitContext === 'object' ? gitContext : undefined,
      });

      res.status(201).json(review);
    } catch (error) {
      console.error('[SecurityReview] startReview error:', error);
      res.status(500).json({ error: 'Failed to start security review' });
    }
  }

  async submitAnswers(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const { id } = req.params;
      const { answers } = req.body as { answers?: SecurityReviewAnswer[] };

      if (!Array.isArray(answers) || answers.length === 0) {
        res.status(400).json({ error: 'answers array is required' });
        return;
      }

      const review = await this.service.submitAnswers(id, tenantId, answers);
      res.json(review);
    } catch (error: any) {
      const isValidation = error.message?.startsWith('Missing answers') ||
        error.message?.startsWith('Cannot submit');
      console.error('[SecurityReview] submitAnswers error:', error);
      res.status(isValidation ? 400 : 500).json({ error: error.message || 'Failed to submit answers' });
    }
  }

  async acknowledgeTasks(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const { id } = req.params;
      const review = await this.service.acknowledgeTasks(id, tenantId);
      res.json(review);
    } catch (error: any) {
      const isValidation = error.message?.startsWith('Cannot acknowledge');
      console.error('[SecurityReview] acknowledgeTasks error:', error);
      res.status(isValidation ? 400 : 500).json({ error: error.message || 'Failed to acknowledge tasks' });
    }
  }

  async submitAttestations(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const { id } = req.params;
      const { attestations, architectureUpdates } = req.body as {
        attestations?: SecurityAttestation[];
        architectureUpdates?: AttestationArchitectureUpdate[];
      };

      if (!Array.isArray(attestations) || attestations.length === 0) {
        res.status(400).json({ error: 'attestations array is required' });
        return;
      }

      const existing = await this.service.getReview(id, tenantId);
      if (!existing) {
        res.status(404).json({ error: 'Security review not found' });
        return;
      }
      validateSecurityAttestations(attestations, existing.tasks);

      const review = await this.service.submitAttestations(id, tenantId, attestations, architectureUpdates);
      res.json(review);
    } catch (error: any) {
      const isValidation = error.message?.startsWith('Missing attestations') ||
        error.message?.startsWith('Cannot attest') ||
        error.message?.startsWith('Invalid attestation') ||
        error.message?.startsWith('Invalid architecture');
      console.error('[SecurityReview] submitAttestations error:', error);
      res.status(isValidation ? 400 : 500).json({ error: error.message || 'Failed to submit attestations' });
    }
  }

  async getReview(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const { id } = req.params;
      const review = await this.service.getReview(id, tenantId);
      if (!review) {
        res.status(404).json({ error: 'Security review not found' });
        return;
      }
      res.json(review);
    } catch (error) {
      console.error('[SecurityReview] getReview error:', error);
      res.status(500).json({ error: 'Failed to get security review' });
    }
  }

  async listReviews(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const rawPrUrl = typeof req.query.prUrl === 'string' ? req.query.prUrl.trim().slice(0, 500) : undefined;
      const rawBranchName = typeof req.query.branchName === 'string' ? req.query.branchName.trim().slice(0, 255) : undefined;
      const rawRepository = typeof req.query.repository === 'string' ? req.query.repository.trim().slice(0, 200) : undefined;

      let sanitizedPrUrl: string | undefined;
      if (rawPrUrl) {
        try {
          const url = new URL(rawPrUrl);
          if (url.protocol === 'https:') sanitizedPrUrl = url.href;
        } catch { /* discard invalid URL */ }
      }

      const hasFilters = sanitizedPrUrl || rawBranchName || rawRepository;
      const reviews = await this.service.listReviews(
        tenantId,
        hasFilters ? { prUrl: sanitizedPrUrl, branchName: rawBranchName, repository: rawRepository } : undefined,
      );
      res.json(reviews);
    } catch (error) {
      console.error('[SecurityReview] listReviews error:', error);
      res.status(500).json({ error: 'Failed to list security reviews' });
    }
  }

  async getAttestationSummary(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const { id } = req.params;
      const summary = await this.service.getAttestationSummary(id, tenantId);
      res.json(summary);
    } catch (error: any) {
      const isNotFound = error.message?.includes('not found');
      console.error('[SecurityReview] getAttestationSummary error:', error);
      res.status(isNotFound ? 404 : 500).json({ error: error.message || 'Failed to get attestation summary' });
    }
  }

  async explainRequirement(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const { id, taskId } = req.params;
      const review = await this.service.getReview(id, tenantId);
      if (!review) {
        res.status(404).json({ error: 'Security review not found' });
        return;
      }
      const explanation = explainSecurityRequirement(review, taskId);
      res.json(explanation);
    } catch (error: any) {
      const isNotFound = error.message?.includes('not found');
      console.error('[SecurityReview] explainRequirement error:', error);
      res.status(isNotFound ? 404 : 500).json({ error: error.message || 'Failed to explain security requirement' });
    }
  }

  // ── Work Item Review endpoints ─────────────────────────────────────────────

  async previewWorkItem(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      if (!this.jiraService) {
        res.status(503).json({ error: 'Jira service not available' });
        return;
      }

      const issueKey = sanitizeIssueKey(req.body?.jiraIssueKey);
      if (!issueKey) {
        res.status(400).json({ error: 'jiraIssueKey is required and must be a valid Jira key (e.g. ENG-42)' });
        return;
      }

      const issue = await this.jiraService.getIssue(tenantId, issueKey);

      res.json({
        issueKey: issue.issueKey,
        issueUrl: issue.issueUrl,
        issueType: issue.issueType,
        projectKey: issue.projectKey,
        summary: issue.summary,
        assignee: issue.assignee,
        priority: issue.priority,
        labels: issue.labels,
        components: issue.components,
      });
    } catch (error: any) {
      if (error instanceof JiraNotConfiguredError) {
        res.status(422).json({ error: 'Jira integration is not configured for this tenant' });
      } else if (error instanceof JiraNotFoundError) {
        res.status(404).json({ error: `Jira issue not found or not accessible` });
      } else {
        console.error('[SecurityReview] previewWorkItem error:', error);
        res.status(500).json({ error: 'Failed to preview work item' });
      }
    }
  }

  async startWorkItemReview(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      if (!this.jiraService) {
        res.status(503).json({ error: 'Jira service not available' });
        return;
      }

      const issueKey = sanitizeIssueKey(req.body?.jiraIssueKey);
      if (!issueKey) {
        res.status(400).json({ error: 'jiraIssueKey is required and must be a valid Jira key (e.g. ENG-42)' });
        return;
      }

      const hasJira = await this.jiraService.hasConfiguredJira(tenantId);
      if (!hasJira) {
        res.status(422).json({ error: 'Jira integration is not configured for this tenant' });
        return;
      }

      if (!this.workItemRunner) {
        res.status(422).json({
          error: 'Autonomous work item review requires an LLM provider.',
          capability: {
            id: 'autonomousWorkItemReview',
            available: false,
            reasons: ['LLM provider is not configured'],
            setupActions: [{ kind: 'set_env', label: 'Configure LLM and embeddings' }],
          },
        });
        return;
      }

      const issue = await this.jiraService.getIssue(tenantId, issueKey);

      const humanResponsible = typeof req.body?.humanResponsible === 'string'
        ? req.body.humanResponsible.trim().slice(0, 200) || undefined
        : undefined;

      const featureDescription = [issue.summary, issue.description]
        .filter(Boolean).join('\n\n').slice(0, 2000);

      const review = await this.service.startWorkItemReview(tenantId, {
        featureDescription,
        humanResponsible,
        jiraWorkItemContext: {
          issueKey: issue.issueKey,
          issueUrl: issue.issueUrl,
          summary: issue.summary,
          issueType: issue.issueType,
          projectKey: issue.projectKey,
          description: issue.description,
          labels: issue.labels,
          components: issue.components,
          reporter: issue.reporter,
          assignee: issue.assignee,
          priority: issue.priority,
        },
      });

      await this.workItemRunner.dispatch({ tenantId, reviewId: review.id });

      res.status(201).json({ reviewId: review.id, status: review.status });
    } catch (error: any) {
      if (error instanceof JiraNotConfiguredError) {
        res.status(422).json({ error: 'Jira integration is not configured for this tenant' });
      } else if (error instanceof JiraNotFoundError) {
        res.status(404).json({ error: 'Jira issue not found or not accessible' });
      } else {
        console.error('[SecurityReview] startWorkItemReview error:', error);
        res.status(500).json({ error: 'Failed to start work item review' });
      }
    }
  }

  async retryWorkItemReview(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const { id } = req.params;

      if (!this.workItemRunner) {
        res.status(503).json({ error: 'Work item runner not available' });
        return;
      }

      const review = await this.service.getReview(id, tenantId);
      if (!review) {
        res.status(404).json({ error: 'Security review not found' });
        return;
      }
      if (review.source !== 'jira_work_item') {
        res.status(400).json({ error: 'This review is not a work item review' });
        return;
      }
      if (review.agentStatus === 'running') {
        res.status(409).json({ error: 'Agent is already running for this review' });
        return;
      }

      await this.workItemRunner.dispatch({ tenantId, reviewId: id });
      res.json({ reviewId: id, status: 'pending' });
    } catch (error) {
      console.error('[SecurityReview] retryWorkItemReview error:', error);
      res.status(500).json({ error: 'Failed to retry work item review' });
    }
  }

  // ── Export to Jira ─────────────────────────────────────────────────────────

  async exportToJira(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = resolveTenantId(req);
      const { id } = req.params;

      if (!this.exportService) {
        res.status(503).json({ error: 'Jira export service not available' });
        return;
      }

      const {
        severityThreshold = 'high',
        targetProjectKey,
        issueType = 'Task',
        priorityMap,
        onlyUnhandled = true,
      } = req.body as {
        severityThreshold?: 'critical' | 'high' | 'medium' | 'low';
        targetProjectKey?: string;
        issueType?: string;
        priorityMap?: { critical: string; high: string; medium: string; low: string };
        onlyUnhandled?: boolean;
      };

      if (!targetProjectKey?.trim()) {
        res.status(400).json({ error: 'targetProjectKey is required' });
        return;
      }

      const defaultPriorityMap = { critical: 'Highest', high: 'High', medium: 'Medium', low: 'Low' };

      const result = await this.exportService.exportTasks(tenantId, id, {
        severityThreshold,
        targetProjectKey: targetProjectKey.trim().toUpperCase(),
        issueType: issueType || 'Task',
        priorityMap: priorityMap ?? defaultPriorityMap,
        onlyUnhandled,
      });

      res.json(result);
    } catch (error: any) {
      if (error instanceof JiraNotConfiguredError) {
        res.status(422).json({ error: 'Jira integration is not configured for this tenant' });
      } else if (error.message?.includes('not found')) {
        res.status(404).json({ error: error.message });
      } else {
        console.error('[SecurityReview] exportToJira error:', error);
        res.status(500).json({ error: 'Failed to export tasks to Jira' });
      }
    }
  }
}
