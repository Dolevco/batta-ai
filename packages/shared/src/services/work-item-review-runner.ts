import type { ISecurityReviewRepository, IPolicyTemplateRepository } from '../persistence/interfaces';
import type { SecurityReviewAnswer } from '../types';
import type { JiraIssueService } from './jira-issue.service';
import type { ExportSecurityTasksToJiraOptions, SecurityReviewJiraExportService } from './security-review-jira-export.service';

export interface WorkItemReviewInput {
  tenantId: string;
  reviewId: string;
}

/**
 * Narrow interface over DataIndexerAgentRegistry so shared/ does not depend on
 * data-indexer at runtime — the concrete registry is injected from the API layer.
 */
export interface IAgentRegistry {
  createTask(agentType: string): {
    execute(prompt: string): Promise<{ requiredOutput?: { [key: string]: unknown } }>;
  };
}

/**
 * Explicit background runner for autonomous work item reviews.
 *
 * Responsibilities:
 *  - Marks agentStatus as running before the agent starts.
 *  - Fetches the full Jira issue if needed.
 *  - Runs the WORK_ITEM_REVIEW_AGENT via the injected registry.
 *  - Submits answers and acknowledges tasks through SecurityReviewService.
 *  - Stamps success or failure on the review.
 *  - If the active work_item_review policy has jiraActionItems.autoCreate, exports
 *    tasks to Jira after agent completion (no attestation step required).
 *
 * The controller creates the review, calls dispatch(), and returns immediately.
 * This runner owns the entire lifecycle after that point.
 */
export class WorkItemReviewRunner {
  constructor(
    private reviewRepository: ISecurityReviewRepository,
    private policyRepository: IPolicyTemplateRepository | undefined,
    private jiraService: JiraIssueService,
    private agentRegistry: IAgentRegistry,
    private submitAnswers: (id: string, tenantId: string, answers: SecurityReviewAnswer[]) => Promise<any>,
    private acknowledgeTasks: (id: string, tenantId: string) => Promise<any>,
    private exportService?: SecurityReviewJiraExportService,
  ) {}

  async dispatch(input: WorkItemReviewInput): Promise<void> {
    setImmediate(() => this.run(input).catch(err => {
      console.error('[WorkItemReviewRunner] unhandled error in background run:', err?.message ?? err);
    }));
  }

  private async run(input: WorkItemReviewInput): Promise<void> {
    const { tenantId, reviewId } = input;

    await this.reviewRepository.update(reviewId, tenantId, { agentStatus: 'running' });

    try {
      const review = await this.reviewRepository.getById(reviewId, tenantId);
      if (!review) throw new Error(`Review not found: ${reviewId}`);
      if (!review.jiraWorkItemContext) throw new Error('Review has no jiraWorkItemContext');

      // Re-fetch Jira issue for full context (stored description may be truncated)
      let issueContext: Record<string, unknown> = { ...review.jiraWorkItemContext };
      try {
        const fresh = await this.jiraService.getIssue(tenantId, review.jiraWorkItemContext.issueKey);
        issueContext = { ...issueContext, ...fresh };
      } catch {
        // Non-fatal: proceed with snapshot stored at creation time
      }

      const prompt = buildPrompt(issueContext, review.questions);
      const task = this.agentRegistry.createTask('work-item-review');
      const result = await task.execute(prompt);

      const answers = result.requiredOutput?.answers;
      if (!Array.isArray(answers) || answers.length === 0) {
        throw new Error('Work item review agent did not return any answers');
      }

      await this.submitAnswers(reviewId, tenantId, answers);
      await this.acknowledgeTasks(reviewId, tenantId);

      await this.reviewRepository.update(reviewId, tenantId, {
        agentStatus: 'completed',
        agentCompletedAt: new Date().toISOString(),
        agentError: undefined,
      });

      // Auto-export to Jira if the active work_item_review policy has autoCreate enabled.
      // This runs after agent completion — not on attestation — because work item reviews
      // are auto-acknowledged and never go through the attestation flow.
      await this.maybeAutoExport(tenantId, reviewId);
    } catch (err: any) {
      const message = err?.message ?? String(err);
      console.error(`[WorkItemReviewRunner] review ${reviewId} failed:`, message);
      await this.reviewRepository.update(reviewId, tenantId, {
        agentStatus: 'failed',
        agentError: message.slice(0, 500),
      }).catch(() => { /* best-effort */ });
    }
  }

  private async maybeAutoExport(tenantId: string, reviewId: string): Promise<void> {
    if (!this.exportService || !this.policyRepository) return;

    try {
      const policy = await this.policyRepository.getActiveByType(tenantId, 'work_item_review');
      const jira = policy?.jiraActionItems;

      if (!jira?.autoCreate || !jira.targetProjectKey) return;

      const opts: ExportSecurityTasksToJiraOptions = {
        severityThreshold: jira.severityThreshold,
        targetProjectKey: jira.targetProjectKey,
        issueType: jira.issueType || 'Task',
        priorityMap: jira.priorityMap,
        onlyUnhandled: true,
      };

      const result = await this.exportService.exportTasks(tenantId, reviewId, opts);
      console.log(`[WorkItemReviewRunner] auto-export: ${result.exported} exported, ${result.failed} failed for review ${reviewId}`);
    } catch (err: any) {
      const message = err?.message ?? String(err);
      console.error(`[WorkItemReviewRunner] auto-export failed for review ${reviewId}:`, message);
      await this.reviewRepository.update(reviewId, tenantId, {
        jiraExportError: message.slice(0, 500),
      }).catch(() => { /* best-effort */ });
    }
  }
}

function buildPrompt(
  issueContext: Record<string, unknown>,
  questions: Array<{ id: string; question: string; hint?: string }>,
): string {
  const lines: string[] = [];

  lines.push('## Jira Work Item Context');
  lines.push('');

  if (issueContext.issueKey)   lines.push(`**Issue Key:** ${issueContext.issueKey}`);
  if (issueContext.issueType)  lines.push(`**Type:** ${issueContext.issueType}`);
  if (issueContext.priority)   lines.push(`**Priority:** ${issueContext.priority}`);
  if (issueContext.projectKey) lines.push(`**Project:** ${issueContext.projectKey}`);
  if (issueContext.summary)    lines.push(`**Summary:** ${issueContext.summary}`);
  if (issueContext.assignee)   lines.push(`**Assignee:** ${issueContext.assignee}`);
  if (issueContext.reporter)   lines.push(`**Reporter:** ${issueContext.reporter}`);

  if (Array.isArray(issueContext.components) && issueContext.components.length > 0) {
    lines.push(`**Components:** ${(issueContext.components as string[]).join(', ')}`);
  }
  if (Array.isArray(issueContext.labels) && issueContext.labels.length > 0) {
    lines.push(`**Labels:** ${(issueContext.labels as string[]).join(', ')}`);
  }
  if (issueContext.description) {
    lines.push('');
    lines.push('**Description:**');
    lines.push(String(issueContext.description).slice(0, 3000));
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Security Questions to Answer');
  lines.push('');
  lines.push('Answer each question based solely on the work item context above.');
  lines.push('');

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    lines.push(`**Q${i + 1} (id: ${q.id}):** ${q.question}`);
    if (q.hint) lines.push(`*Hint: ${q.hint}*`);
    lines.push('');
  }

  lines.push('For each question provide:');
  lines.push('- **answer**: "yes", "no", or "unknown"');
  lines.push('- **rationale**: 1-2 sentences explaining *why* you chose that answer — this is shown to human reviewers, so make it clear and specific');
  lines.push('- **evidence**: up to 5 short phrases pointing to the exact fields or signals you relied on (e.g. "label: data-pipeline", "component: auth-service", "summary mentions PII")');
  lines.push('- **confidence**: "high" (strong signal), "medium" (indirect signal), or "low" (inference/assumption)');
  lines.push('');
  lines.push('**Important:** Even when the issue has minimal detail, reason from whatever IS present');
  lines.push('(title, type, labels, components, comments). Only answer "unknown" when a question truly');
  lines.push('cannot be assessed from any available signal — not simply because the description is empty.');
  lines.push('');
  lines.push('When finished, call `submit_work_item_review` with your answers array.');

  return lines.join('\n');
}
