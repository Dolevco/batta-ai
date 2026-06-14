import type { FeatureContext, FeatureSecurityContext, AttestationArchitectureUpdate, ArchitectureDiff } from './feature.types';
import type { ThreatModelGraph, ThreatModelDiff } from './threat-model.types';
import type { PolicyTemplateType, PolicyTaskRule } from './policy.types';

export type ReviewSource = 'code' | 'cloud' | 'jira_work_item';

export type ReviewAgentStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface JiraWorkItemContext {
  /** Jira issue key, e.g. "ENG-42" */
  issueKey: string;
  /** Jira issue URL */
  issueUrl: string;
  /** Issue summary (title) */
  summary: string;
  /** Issue type: Story, Bug, Task, Epic, etc. */
  issueType: string;
  /** Jira project key */
  projectKey: string;
  /** Issue description (plain text, truncated to 2000 chars) */
  description?: string;
  /** Labels attached to the issue */
  labels?: string[];
  /** Jira components e.g. ["auth-service", "payments"] */
  components?: string[];
  /** Linked PR URL if Jira has development info */
  linkedPrUrl?: string;
  /** Reporter display name */
  reporter?: string;
  /** Assignee display name */
  assignee?: string;
  /** Issue priority */
  priority?: string;
}

export type SecurityReviewStatus =
  | 'questionnaire_pending'
  | 'questionnaire_answered'
  | 'tasks_acknowledged'
  | 'attested';

export interface SecurityReviewQuestion {
  id: string;
  question: string;
  hint?: string;
}

export interface SecurityReviewAnswer {
  questionId: string;
  answer: string;
  /** Agent-written rationale for work item reviews. */
  rationale?: string;
  /** Short source pointers, e.g. Jira fields, component names, linked services. No raw secrets. */
  evidence?: string[];
  /** Agent confidence in this answer. */
  confidence?: 'high' | 'medium' | 'low';
}

export interface SecurityTask {
  id: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  principle: string;
  /** Set after export-to-jira; key of the created Jira issue e.g. "SEC-7" */
  jiraIssueKey?: string;
  /** Direct URL to the created Jira issue. */
  jiraIssueUrl?: string;
  /** ISO timestamp when this task was successfully exported. */
  jiraExportedAt?: string;
  /** Per-task export failure, useful when export partially succeeds. */
  jiraExportError?: string;
}

export interface SecurityAttestation {
  taskId: string;
  handled: boolean;
  notes: string;
}

export interface SecurityRequirementExplanation {
  reviewId: string;
  task: SecurityTask;
  policy: {
    type?: PolicyTemplateType;
    version?: number;
    source: 'question_rule' | 'baseline_task';
    questionId?: string;
  };
  triggeringAnswers: SecurityReviewAnswer[];
  relatedContext: {
    matchedFeatures: FeatureContext[];
    linkedFeatureIds: string[];
    featureSecurityContext: FeatureSecurityContext[];
  };
  reason: string;
}

/** Git metadata captured when start_security_review is called.
 * authorEmail / authorName are PII — stored encrypted at rest, never logged.
 */
export interface ReviewGitContext {
  branchName?: string;
  commitSha?: string;
  commitShortSha?: string;
  /** PII — never logged */
  authorEmail?: string;
  /** PII — never logged */
  authorName?: string;
  commitMessage?: string;
  commitTimestamp?: string;
  baseBranch?: string;
  remoteUrl?: string;
}

export interface CorrelationSignal {
  signal:
    | 'branchName'
    | 'commitSha'
    | 'authorEmail'
    | 'authorName'
    | 'authorLogin'
    | 'commitMessage'
    | 'timeWindow'
    | 'repository'
    | 'manual';
  matched: boolean;
  weight: number;
  detail?: string;
}

export type PRValidationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type PRValidationOutcome = 'confirmed' | 'disputed' | 'unverifiable';
export type PRValidationOverallOutcome = 'clean' | 'attention' | 'critical';

export interface PRValidationFinding {
  questionId: string;
  questionText: string;
  agentAnswer: string;
  outcome: PRValidationOutcome;
  rationale: string;
  relevantFiles: string[];
}

export interface PRValidationAdditionalRisk {
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  relevantFiles: string[];
}

export interface PRValidationReport {
  status: PRValidationStatus;
  taskRunId?: string;
  overallOutcome?: PRValidationOverallOutcome;
  executiveSummary?: string;
  findings: PRValidationFinding[];
  additionalRisks: PRValidationAdditionalRisk[];
  filesReviewed: number;
  linesReviewed: number;
  validatedAt?: string;
  errorMessage?: string;
}

export interface CorrelatedPR {
  provider: 'github' | 'gitlab';
  repository: string;
  prNumber: number;
  prUrl: string;
  prTitle: string;
  prState: 'open' | 'closed' | 'merged';
  prAuthorLogin: string;
  headSha: string;
  headBranch: string;
  baseBranch: string;
  openedAt: string;
  mergedAt?: string;
  closedAt?: string;
  correlationScore: number;
  correlationSignals: CorrelationSignal[];
}

export interface NormalisedPR {
  provider: 'github' | 'gitlab';
  repository: string;
  prNumber: number;
  prUrl: string;
  prTitle: string;
  prState: 'open' | 'closed' | 'merged';
  prAuthorLogin: string;
  prAuthorEmail?: string;
  headSha: string;
  headBranch: string;
  baseBranch: string;
  openedAt: string;
  mergedAt?: string;
  closedAt?: string;
}

export interface SecurityReview {
  id: string;
  tenantId: string;
  title?: string;
  featureDescription: string;
  agentName?: string;
  humanResponsible?: string;
  services?: string[];
  repository?: string;
  prLink?: string;
  status: SecurityReviewStatus;
  questions: SecurityReviewQuestion[];
  answers: SecurityReviewAnswer[];
  tasks: SecurityTask[];
  attestations: SecurityAttestation[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  matchedFeatures?: FeatureContext[];
  linkedFeatureIds?: string[];
  featureSecurityContext?: FeatureSecurityContext[];
  architectureUpdates?: AttestationArchitectureUpdate[];
  architectureDiff?: ArchitectureDiff[];
  threatModelSnapshot?: ThreatModelGraph;
  threatModelDiff?: ThreatModelDiff;
  policyTemplateVersion?: number;
  policyTemplateType?: PolicyTemplateType;
  snapshotTaskRules?: PolicyTaskRule[];
  snapshotBaselineTasks?: Omit<SecurityTask, 'id'>[];
  gitContext?: ReviewGitContext;
  correlatedPR?: CorrelatedPR;
  correlationAttemptedAt?: string;
  prValidationReport?: PRValidationReport;

  /** Where this review originated. Defaults to 'code' for backward compatibility. */
  source?: ReviewSource;

  /** Populated when source === 'jira_work_item' */
  jiraWorkItemContext?: JiraWorkItemContext;

  /** Agent lifecycle for autonomous work item reviews. */
  agentStatus?: ReviewAgentStatus;

  /** Set if the work item review agent failed; cleared on re-trigger. */
  agentError?: string;

  /** ISO timestamp when the agent finished answering. */
  agentCompletedAt?: string;

  /** Set when auto-export failed; cleared on manual retry. */
  jiraExportError?: string;

  /** ISO timestamp of last successful Jira export. */
  jiraExportedAt?: string;
}
