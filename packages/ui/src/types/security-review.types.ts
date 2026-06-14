import type { ThreatSeverity } from './common.types';

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
  rationale?: string;
  evidence?: string[];
  confidence?: 'high' | 'medium' | 'low';
}

export interface SecurityTask {
  id: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  principle: string;
  jiraIssueKey?: string;
  jiraIssueUrl?: string;
  jiraExportedAt?: string;
  jiraExportError?: string;
}

export type ReviewSource = 'code' | 'cloud' | 'jira_work_item';

export type ReviewAgentStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface JiraWorkItemContext {
  issueKey: string;
  issueUrl: string;
  summary: string;
  issueType: string;
  projectKey: string;
  description?: string;
  labels?: string[];
  components?: string[];
  linkedPrUrl?: string;
  reporter?: string;
  assignee?: string;
  priority?: string;
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
    type?: string;
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

export interface DataClassificationDiffEntry {
  changeType: 'added' | 'removed' | 'changed' | 'unchanged';
  baseline: ReviewDataClassificationEntry | null;
  updated: ReviewDataClassificationEntry | null;
}

export interface DataFlowDiffEntry {
  changeType: 'added' | 'removed' | 'changed' | 'unchanged';
  baseline: FeatureDataFlowEntry | null;
  updated: FeatureDataFlowEntry | null;
}

export interface ArchitectureDiff {
  featureId: string;
  featureName: string;
  dataClassificationDiff: DataClassificationDiffEntry[];
  dataFlowDiff: DataFlowDiffEntry[];
  hasChanges: boolean;
  dfdChangeRationale?: string;
}

interface FeatureDataFlowEntry {
  from: string;
  to: string;
  dataTypes: string[];
  protocol: string;
  encrypted: boolean;
  authRequired: boolean;
}

interface ReviewDataClassificationEntry {
  classification: string;
  dataTypes: string[];
  protectionMechanisms: string[];
}

interface AttestationArchitectureUpdate {
  featureId: string;
  updatedDataFlowSummary: FeatureDataFlowEntry[];
  updatedDataClassification: ReviewDataClassificationEntry[];
  dfdChangeRationale: string;
}

interface ThreatModelNode {
  id: string;
  type: string;
  label: string;
  severity?: string;
  trustZone?: 'external' | 'dmz' | 'internal' | 'trusted';
  metadata?: Record<string, any>;
  link?: string;
  exploitabilityResults?: unknown[];
}

interface ThreatModelEdge {
  id: string;
  from: string;
  to: string;
  type: string;
  confidence: string;
  label?: string;
  dataFlow?: unknown;
  isOnAttackPath?: boolean;
  attackPathIds?: string[];
}

interface ThreatModelGraph {
  nodes: ThreatModelNode[];
  edges: ThreatModelEdge[];
  capturedAt: string;
  explanation?: string;
}

interface ThreatModelChange {
  title: string;
  entityIds: string[];
  changeType: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  securityImplication: string;
  recommendation?: string;
}

interface ThreatModelAiAnalysis {
  summary: string;
  overallImpact: 'positive' | 'neutral' | 'negative' | 'mixed';
  changes: ThreatModelChange[];
  riskNarrative: string;
  generatedAt: string;
  model?: string;
}

interface ThreatModelDiff {
  previousReviewId: string | null;
  addedNodes: ThreatModelNode[];
  removedNodes: ThreatModelNode[];
  modifiedNodes: Array<{ before: ThreatModelNode; after: ThreatModelNode }>;
  addedEdges: ThreatModelEdge[];
  removedEdges: ThreatModelEdge[];
  aiAnalysis?: ThreatModelAiAnalysis;
}

interface FeatureContext {
  id: string;
  name: string;
  businessValue: string;
  description: string;
}

interface FeatureSecurityContext {
  featureId: string;
  featureName: string;
  complianceConsiderations: string[];
  dataClassificationSummary: Array<{
    classification: string;
    dataTypes: string[];
    protectionMechanisms: string[];
  }>;
  dataFlowSummary: FeatureDataFlowEntry[];
  overallRiskScore: number;
  securityRecommendations: string[];
  existingThreats: Array<{
    id: string;
    title: string;
    category: string;
    severity: string;
    status: string;
  }>;
}

interface ReviewGitContext {
  branchName?: string;
  commitSha?: string;
  commitShortSha?: string;
  authorEmail?: string;
  authorName?: string;
  commitMessage?: string;
  commitTimestamp?: string;
  baseBranch?: string;
  remoteUrl?: string;
}

interface CorrelationSignal {
  signal: 'branchName' | 'commitSha' | 'authorEmail' | 'authorName' | 'timeWindow' | 'repository' | 'manual';
  matched: boolean;
  weight: number;
  detail?: string;
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

type PRValidationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
type PRValidationOutcome = 'confirmed' | 'disputed' | 'unverifiable';
type PRValidationOverallOutcome = 'clean' | 'attention' | 'critical';

interface PRValidationFinding {
  questionId: string;
  questionText: string;
  agentAnswer: string;
  outcome: PRValidationOutcome;
  rationale: string;
  relevantFiles: string[];
}

interface PRValidationAdditionalRisk {
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  relevantFiles: string[];
}

interface PRValidationReport {
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
  gitContext?: ReviewGitContext;
  correlatedPR?: CorrelatedPR;
  correlationAttemptedAt?: string;
  prValidationReport?: PRValidationReport;
  source?: ReviewSource;
  jiraWorkItemContext?: JiraWorkItemContext;
  agentStatus?: ReviewAgentStatus;
  agentError?: string;
  agentCompletedAt?: string;
  jiraExportError?: string;
  jiraExportedAt?: string;
}

export interface SecurityReviewAttestationSummary {
  reviewId: string;
  featureDescription: string;
  status: SecurityReviewStatus;
  totalTasks: number;
  handledTasks: number;
  unhandledTasks: number;
  pendingTasks: number;
  criticalUnhandledCount: number;
  criticalUnhandled: { id: string; title: string }[];
  completedAt?: string;
}

export type PolicyTemplateType = 'security_review' | 'responsible_ai' | 'privacy' | 'work_item_review';

export interface JiraActionItemsConfig {
  autoCreate: boolean;
  severityThreshold: 'critical' | 'high' | 'medium' | 'low';
  targetProjectKey: string;
  issueType: string;
  priorityMap: { critical: string; high: string; medium: string; low: string };
}

interface PolicyTaskRule {
  questionId: string;
  tasks: Omit<SecurityTask, 'id'>[];
}

export interface PolicyTemplate {
  id: string;
  tenantId: string;
  type: PolicyTemplateType;
  name: string;
  description: string;
  questions: SecurityReviewQuestion[];
  taskRules: PolicyTaskRule[];
  baselineTasks: Omit<SecurityTask, 'id'>[];
  version: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  jiraActionItems?: JiraActionItemsConfig;
}

export interface ExportToJiraOptions {
  severityThreshold?: 'critical' | 'high' | 'medium' | 'low';
  targetProjectKey: string;
  issueType?: string;
  priorityMap?: { critical: string; high: string; medium: string; low: string };
  onlyUnhandled?: boolean;
}

export interface ExportToJiraResult {
  exported: number;
  skipped: number;
  failed: number;
  tasks: SecurityTask[];
}

// Re-export ThreatSeverity so consumers can import from this file
export type { ThreatSeverity };
