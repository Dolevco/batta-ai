import type { SecurityReview, SecurityTask } from '../types';
import type { JiraIssueService } from './jira-issue.service';
import type { ISecurityReviewRepository } from '../persistence/interfaces';

export interface ExportSecurityTasksToJiraOptions {
  severityThreshold: 'critical' | 'high' | 'medium' | 'low';
  targetProjectKey: string;
  issueType: string;
  priorityMap: { critical: string; high: string; medium: string; low: string };
  onlyUnhandled?: boolean;
  appBaseUrl?: string;
}

export interface ExportResult {
  exported: number;
  skipped: number;
  failed: number;
  tasks: SecurityTask[];
}

const SEVERITY_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

function meetsThreshold(taskSeverity: string, threshold: string): boolean {
  return (SEVERITY_ORDER[taskSeverity] ?? 0) >= (SEVERITY_ORDER[threshold] ?? 0);
}

export class SecurityReviewJiraExportService {
  constructor(
    private jiraService: JiraIssueService,
    private reviewRepository: ISecurityReviewRepository,
  ) {}

  async exportTasks(
    tenantId: string,
    reviewId: string,
    options: ExportSecurityTasksToJiraOptions,
  ): Promise<ExportResult> {
    const review = await this.reviewRepository.getById(reviewId, tenantId);
    if (!review) throw new Error(`SecurityReview not found: ${reviewId}`);
    if (!review.tasks.length) return { exported: 0, skipped: 0, failed: 0, tasks: [] };

    const onlyUnhandled = options.onlyUnhandled !== false;
    const updatedTasks = review.tasks.map(t => ({ ...t }));

    // Separate tasks to export from those to skip
    const toExport: Array<{ task: SecurityTask; index: number }> = [];
    let skipped = 0;

    for (let i = 0; i < updatedTasks.length; i++) {
      const task = updatedTasks[i];
      if (onlyUnhandled && task.jiraIssueKey) { skipped++; continue; }
      if (!meetsThreshold(task.severity, options.severityThreshold)) { skipped++; continue; }
      toExport.push({ task, index: i });
    }

    // Create all Jira issues in parallel
    const results = await Promise.allSettled(
      toExport.map(({ task }) => {
        const description = this.buildDescription(task, review, options.appBaseUrl);
        const priority = options.priorityMap[task.severity as keyof typeof options.priorityMap];
        return this.jiraService.createIssue(tenantId, {
          projectKey: options.targetProjectKey,
          issueType: options.issueType,
          summary: `[Security Review] ${task.title}`.slice(0, 255),
          description,
          priority,
          labels: ['security-review'],
        });
      }),
    );

    let exported = 0;
    let failed = 0;

    for (let i = 0; i < results.length; i++) {
      const { task } = toExport[i];
      const result = results[i];
      if (result.status === 'fulfilled') {
        task.jiraIssueKey = result.value.issueKey;
        task.jiraIssueUrl = result.value.issueUrl;
        task.jiraExportedAt = new Date().toISOString();
        task.jiraExportError = undefined;
        exported++;
      } else {
        task.jiraExportError = result.reason?.message ?? 'Export failed';
        failed++;
      }
    }

    const now = new Date().toISOString();
    // Only clear review-level error when ALL attempted tasks succeeded
    const reviewUpdates: Partial<SecurityReview> = {
      tasks: updatedTasks,
      ...(exported > 0 && { jiraExportedAt: now }),
      ...(failed > 0
        ? { jiraExportError: `${failed} task(s) failed to export` }
        : exported > 0
        ? { jiraExportError: undefined }
        : {}),
    };
    await this.reviewRepository.update(reviewId, tenantId, reviewUpdates);

    return { exported, skipped, failed, tasks: updatedTasks };
  }

  private buildDescription(task: SecurityTask, review: SecurityReview, appBaseUrl?: string): string {
    const lines: string[] = [task.description];
    lines.push('');
    lines.push(`Severity: ${task.severity}`);
    lines.push(`Principle: ${task.principle}`);

    if (review.jiraWorkItemContext?.issueKey) {
      lines.push(`Source Work Item: ${review.jiraWorkItemContext.issueKey} — ${review.jiraWorkItemContext.summary}`);
    }

    if (appBaseUrl) {
      lines.push(`Security Review: ${appBaseUrl}/security-reviews/${review.id}`);
    }

    return lines.join('\n');
  }
}
