import type { StoredPlan, Tool, GitToolConfig } from "@ai-agent/core";

// Canonical types for code indexing
export * from './types/canonical.types';

// Asset Types
export interface AssetCategory {
  type: string;
  label: string;
  count: number;
}

export interface Asset {
  id: string;
  type: string;
  name: string;
  owner?: string;
  businessCriticality?: 'critical' | 'high' | 'medium' | 'low';
  riskScore?: number;
  metadata: Record<string, any>;
}

// Agent Types
export interface Agent {
  id: string;
  name: string;
  role: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

// Task Types
export interface TaskResponse {
  id: string;
  description: string;
  agentId?: string;
  tenantId: string;
  tools?: string[];
  status: 'pending' | 'planning' | 'completed' | 'failed';
  plan?: StoredPlan;
  createdAt: string;
  updatedAt: string;
  chatMessages?: ChatMessage[];
  feedbacks?: Feedback[];
}

// Chat Message Types
export interface ChatMessage {
  id: string;
  conversationId: string;
  taskId?: string;
  tenantId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  metadata?: Record<string, any>;
}

export interface ConversationSummary {
  conversationId: string;
  taskId?: string;
  messageCount: number;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
}

// Base Integration
export interface BaseIntegration {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

// MCP Integration Types
export interface MCPIntegration extends BaseIntegration {
  type: 'mcp';
  transport: 'http' | 'stdio';
  config: MCPHttpConfig | MCPStdioConfig;
}

export interface MCPHttpConfig {
  url: string;
  headers?: Record<string, string>;
}

export interface MCPStdioConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

// Custom Integration Types
export interface CustomIntegration extends BaseIntegration {
  type: 'custom' | 'code';
  config: Record<string, string>;
}

export type Integration = MCPIntegration | CustomIntegration;

// Task Run Types
export interface TaskRun {
  id: string;
  taskId: string;
  taskName?: string;
  tenantId: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  result?: any;
  error?: string;
  chainOfThoughts: ChainThoughtEvent[];
  workerId?: string; // Container ID (Docker) or execution name (Azure) for cancellation
  environment?: 'local' | 'azure' | 'debug'; // Execution environment
}

export interface ChainThoughtEvent {
  id: string;
  timestamp: string;
  type: 'toolUse' | 'planStepStart' | 'planStepResult' | 'other';
  name?: string;
  reason?: string;
  message?: string;
  error?: string;
  result?: any;
  status?: 'pending' | 'running' | 'success' | 'failed';
  data?: any;
}

// Feedback Types
export interface Feedback {
  id: string;
  taskId: string;
  taskRunId?: string;
  tenantId: string;
  role: 'user' | 'system';
  content: string;
  createdAt: string;
  rating?: 'like' | 'dislike';
}

// Integration Handler Types
export interface CustomIntegrationHandler {
  id: string;
  name: string;
  // Return the tools exposed by the integration at runtime
  getTools(): Tool[];
}

export interface CodeIntegrationHandler extends CustomIntegrationHandler {
  getCodingTools: (config: GitToolConfig) => Tool[];
  getAccessToken: () => Promise<string>;
  getRepositories: () => Promise<CodeIntegrationRepository[]>;
}

export interface CodeIntegrationRepository {
  name: string;
  url: string;
  language?: string;
  description?: string;
  defaultBranch?: string;
}

// Security Review Types
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
}

export interface SecurityTask {
  id: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  principle: string;
}

export interface SecurityAttestation {
  taskId: string;
  handled: boolean;
  notes: string;
}

// ── Policy Template Types ──────────────────────────────────────────────────────

export type PolicyTemplateType = 'security_review' | 'responsible_ai' | 'privacy';

export interface PolicyTaskRule {
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
}

/**
 * Updated architecture sections submitted by the agent at attest time.
 * Scoped to a specific linked feature so diffs can be computed per-feature.
 */
export interface AttestationArchitectureUpdate {
  /** Feature ID this update applies to (must be in linkedFeatureIds) */
  featureId: string;
  /** Updated data flow entries as they exist after this feature was implemented */
  updatedDataFlowSummary: FeatureDataFlowEntry[];
  /** Updated data classification entries as they exist after this feature was implemented */
  updatedDataClassification: ReviewDataClassificationEntry[];
  /**
   * Concise explanation (1-3 sentences) of why the data flows or classifications changed.
   * Written by the agent; shown to security architects as the human-readable justification
   * alongside the structured diff. Should name specific flows added/removed, data types
   * introduced, and reasons for any security property changes.
   */
  dfdChangeRationale: string;
}

// ── Threat Model Types ────────────────────────────────────────────────────────

export interface ThreatModelNode {
  id: string;
  type: string;
  label: string;
  severity?: string;
  trustZone?: 'external' | 'dmz' | 'internal' | 'trusted';
  metadata?: Record<string, any>;
  link?: string;
  /** Per-threat exploitability results, populated by Step 8 of the pipeline. */
  exploitabilityResults?: import('./types/canonical.types').ExploitabilityResult[];
}

export interface ThreatModelEdge {
  id: string;
  from: string;
  to: string;
  type: string;
  confidence: string;
  label?: string;
  /** True when this edge is part of at least one computed attack path. */
  isOnAttackPath?: boolean;
  attackPathIds?: string[];
}

export interface ThreatModelGraph {
  nodes: ThreatModelNode[];
  edges: ThreatModelEdge[];
  capturedAt: string;
  explanation?: string;
}

export interface ThreatModelChange {
  /** Short label shown in the change list */
  title: string;
  /** Entity id(s) involved */
  entityIds: string[];
  /** 'added' | 'removed' | 'modified' | 'trust_boundary' | 'data_sensitivity' | 'relationship' */
  changeType: string;
  /** Severity of the change from a security perspective */
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  /** One-sentence explanation of the security implication */
  securityImplication: string;
  /** Recommended follow-up action, if any */
  recommendation?: string;
}

export interface ThreatModelAiAnalysis {
  /** Short executive summary (1–3 sentences) */
  summary: string;
  /** Overall security posture change */
  overallImpact: 'positive' | 'neutral' | 'negative' | 'mixed';
  /** Per-change breakdown produced by the LLM */
  changes: ThreatModelChange[];
  /** Broader risk narrative (markdown) */
  riskNarrative: string;
  /** Timestamp when the analysis was generated */
  generatedAt: string;
  /** LLM model used */
  model?: string;
}

export interface ThreatModelDiff {
  previousReviewId: string | null;
  addedNodes: ThreatModelNode[];
  removedNodes: ThreatModelNode[];
  modifiedNodes: Array<{ before: ThreatModelNode; after: ThreatModelNode }>;
  addedEdges: ThreatModelEdge[];
  removedEdges: ThreatModelEdge[];
  /** AI-generated narrative analysis of the diff */
  aiAnalysis?: ThreatModelAiAnalysis;
}

/**
 * Slim feature info returned by start_security_review (matchedFeatures).
 * Contains only business-level context to help the agent identify which
 * feature(s) the change applies to, without loading DFD / classification data
 * into the planning context prematurely.
 *
 * Full DFD and classification baseline is returned by submit_security_answers
 * (featureSecurityContext) once the agent has selected a feature.
 */
export interface FeatureContext {
  id: string;
  name: string;
  businessValue: string;
  description: string;
}

/**
 * @deprecated Use FeatureContext (slim) for matchedFeatures in start_security_review.
 * Full DFD data is now carried by FeatureSecurityContext returned from submit_security_answers.
 * Kept for backwards-compat with any stored reviews that include the old shape.
 */
export interface FeatureContextFull extends FeatureContext {
  userStories: string[];
  dataFlowSummary: FeatureDataFlowEntry[];
  dataClassificationSummary: Array<{
    classification: string;
    dataTypes: string[];
    protectionMechanisms: string[];
  }>;
}

/** A single data flow entry surfaced to the agent in submit_security_answers */
export interface FeatureDataFlowEntry {
  from: string;
  to: string;
  dataTypes: string[];
  protocol: string;
  encrypted: boolean;
  authRequired: boolean;
}

/** A single data classification entry provided by the agent at attest time */
export interface ReviewDataClassificationEntry {
  classification: string;
  dataTypes: string[];
  protectionMechanisms: string[];
}

/** Diff result for a single data classification entry */
export interface DataClassificationDiffEntry {
  /** 'added' | 'removed' | 'changed' | 'unchanged' */
  changeType: 'added' | 'removed' | 'changed' | 'unchanged';
  /** The baseline entry (from featureSecurityContext); null when added */
  baseline: ReviewDataClassificationEntry | null;
  /** The updated entry submitted at attest time; null when removed */
  updated: ReviewDataClassificationEntry | null;
}

/** Diff result for a single data flow entry */
export interface DataFlowDiffEntry {
  /** 'added' | 'removed' | 'changed' | 'unchanged' */
  changeType: 'added' | 'removed' | 'changed' | 'unchanged';
  /** The baseline entry (from featureSecurityContext); null when added */
  baseline: FeatureDataFlowEntry | null;
  /** The updated entry submitted at attest time; null when removed */
  updated: FeatureDataFlowEntry | null;
}

/** Computed diff between the baseline and updated architecture sections */
export interface ArchitectureDiff {
  /** Which feature this diff belongs to */
  featureId: string;
  featureName: string;
  dataClassificationDiff: DataClassificationDiffEntry[];
  dataFlowDiff: DataFlowDiffEntry[];
  /** true when any entry is 'added' | 'removed' | 'changed' */
  hasChanges: boolean;
  /**
   * Agent-authored rationale explaining why the architecture changed.
   * Displayed alongside the structured diff for security architects.
   */
  dfdChangeRationale?: string;
}

/** Enriched security context for a linked feature, returned in submit_security_answers */
export interface FeatureSecurityContext {
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


/** Git metadata captured when start_security_review is called (from Claude Code CLI or CI).
 * Data classification: INTERNAL — contains repo metadata.
 * authorEmail / authorName are PII — stored encrypted at rest, never logged.
 */
export interface ReviewGitContext {
  branchName?: string;        // feature/fix branch, max 255 chars
  commitSha?: string;         // full 40-char SHA
  commitShortSha?: string;    // first 7 chars
  /** PII — never logged */
  authorEmail?: string;
  /** PII — never logged */
  authorName?: string;
  commitMessage?: string;     // subject line, max 500 chars
  commitTimestamp?: string;   // ISO 8601
  baseBranch?: string;        // target / main branch
  remoteUrl?: string;         // sanitised remote origin URL
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
  weight: number;               // contribution to correlationScore
  detail?: string;
}

/** Correlated PR or MR data resolved from GitHub / GitLab.
 * Data classification: INTERNAL
 */
export interface CorrelatedPR {
  provider: 'github' | 'gitlab';
  repository: string;           // "org/repo"
  prNumber: number;
  prUrl: string;                // html_url / web_url
  prTitle: string;
  prState: 'open' | 'closed' | 'merged';
  prAuthorLogin: string;
  headSha: string;
  headBranch: string;
  baseBranch: string;
  openedAt: string;             // ISO 8601
  mergedAt?: string;            // ISO 8601
  closedAt?: string;            // ISO 8601
  correlationScore: number;     // 0–100; how confident the match is
  correlationSignals: CorrelationSignal[];
}

/** Provider-agnostic PR/MR shape used internally by the correlation service. */
export interface NormalisedPR {
  provider: 'github' | 'gitlab';
  repository: string;
  prNumber: number;
  prUrl: string;
  prTitle: string;
  prState: 'open' | 'closed' | 'merged';
  prAuthorLogin: string;
  prAuthorEmail?: string;       // not always available from the API
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
  /** Short, PR-style title for the review (e.g. "feat: add PR link to security review") */
  title?: string;
  /** Full one-sentence description of the feature being reviewed */
  featureDescription: string;
  /** AI agent that initiated the review (e.g. "Claude Code", "GitHub Copilot", "Cursor") */
  agentName?: string;
  /** Human developer responsible for the change (display name from the verified JWT) */
  humanResponsible?: string;
  /** Packages / services involved in the change (e.g. ["api", "shared", "ui"]) */
  services?: string[];
  /** Repository (or monorepo) context where the change is being made (e.g. "my-org/my-repo") */
  repository?: string;
  /** Link to the associated pull request (e.g. "https://github.com/org/repo/pull/42") */
  prLink?: string;
  status: SecurityReviewStatus;
  questions: SecurityReviewQuestion[];
  answers: SecurityReviewAnswer[];
  tasks: SecurityTask[];
  attestations: SecurityAttestation[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  /** Lightweight feature records matched from the services list (set by start_security_review) */
  matchedFeatures?: FeatureContext[];
  /** Feature IDs this review is associated with (derived from the feature_scope answer) */
  linkedFeatureIds?: string[];
  /**
   * Enriched security context for linked features (set by submit_security_answers).
   * Also populated for the "new feature" path: a synthetic entry representing the
   * merged cross-service DFD is appended so both paths share the same baseline field.
   */
  featureSecurityContext?: FeatureSecurityContext[];
  /**
   * Updated architecture sections submitted by the agent at attest time.
   * One entry per linked feature. Stored as CONFIDENTIAL alongside the review.
   */
  architectureUpdates?: AttestationArchitectureUpdate[];
  /**
   * Computed diff between the baseline (featureSecurityContext) and the
   * architectureUpdates submitted at attest time. Populated by the service
   * when attestations are submitted.
   */
  architectureDiff?: ArchitectureDiff[];
  /** Threat model state captured after the feature is implemented */
  threatModelSnapshot?: ThreatModelGraph;
  threatModelDiff?: ThreatModelDiff;
  /** Version of the PolicyTemplate that was active when this review was created */
  policyTemplateVersion?: number;
  /** Type of policy template used to create this review */
  policyTemplateType?: PolicyTemplateType;
  /** Snapshotted task rules from the policy at review creation time */
  snapshotTaskRules?: PolicyTaskRule[];
  /** Snapshotted baseline tasks from the policy at review creation time */
  snapshotBaselineTasks?: Omit<SecurityTask, 'id'>[];

  /**
   * Git context captured at review creation time (from Claude Code CLI or CI).
   * Data classification: INTERNAL. authorEmail/authorName are PII — never logged.
   */
  gitContext?: ReviewGitContext;

  /**
   * Correlated PR/MR data (populated asynchronously after creation or on demand).
   * Data classification: INTERNAL.
   */
  correlatedPR?: CorrelatedPR;

  /** When the PR correlation was last attempted (ISO 8601). */
  correlationAttemptedAt?: string;
}

// ── Overview / Dashboard Types ─────────────────────────────────────────────────

export interface OverviewFinding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  asset: string;
  review: string;
  reviewId: string;
  owner: string;
}

export interface OverviewReviewEntry {
  id: string;
  title: string;
  status: 'completed' | 'in-progress';
  findings: number;
  date: string;
}

export interface OverviewAssetRisk {
  name: string;
  score: number;
  entityType?: string;
}

export interface OverviewStats {
  criticalFindings: number;
  reviewsCompleted: number;
  servicesScanned: number;
  servicesTotal: number;
  vulnerabilitiesResolved: number;
  findings: OverviewFinding[];
  recentReviews: OverviewReviewEntry[];
  assetRisks: OverviewAssetRisk[];
  funnelPhases: { label: string; count: number }[];
}
