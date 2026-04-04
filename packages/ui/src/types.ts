export interface TaskResponse {
  id: string;
  description: string;
  agentId?: string; // Link to agent
  tools?: string[]; // Integration IDs selected for this task
  status: 'pending' | 'planning' | 'completed' | 'failed';
  plan?: StoredPlan;
  createdAt: string;
  updatedAt: string;
  chatMessages?: ChatMessage[]; // Associated chat messages
  feedbacks?: Feedback[]; // User feedback on task runs
}

export interface StoredPlan {
  description: string;
  subTasks: PlannedSubTask[];
  createdAt: string;
}

export interface PlannedSubTask {
  id: string;
  name: string;
  tools: string[];
  toolsCategories?: string[];
  taskType?: string;
  intent: string;
  expectedOutput: string;
  anticipatedSteps?: number;
  dependsOn: number[];
  codeIntegrationId?: string;
  executionPlan?: string;
  reason?: string;
}

// New types for task execution
export interface TaskExecution {
  taskId: string;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  currentStepId?: string;
  executedSteps: StepExecution[];
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface StepExecution {
  stepId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';
  startedAt?: string;
  completedAt?: string;
  duration?: number;
  result?: string;
  error?: string;
  logs: LogEntry[];
}

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  data?: any;
}

// Chat Message Types
export interface ChatMessage {
  id: string;
  conversationId: string;
  taskId?: string; // Optional link to a task
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  metadata?: Record<string, any>; // For additional data like tool calls, etc.
}

export interface CreateChatMessageRequest {
  conversationId: string;
  taskId?: string;
  role: 'user' | 'assistant';
  content: string;
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

export interface CreateTaskRequest {
  description: string;
  agentId?: string; // Link task to an agent
  tools?: string[];
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  conversationId?: string; // Optional conversation ID for linking to chat messages
}

// Integration Types
export type IntegrationType = 'mcp' | 'code' | 'custom';

export interface BaseIntegration {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
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

export interface CreateMCPIntegrationRequest {
  name: string;
  description?: string;
  transport: 'http' | 'stdio';
  config: MCPHttpConfig | MCPStdioConfig;
  enabled?: boolean;
}

export interface UpdateMCPIntegrationRequest {
  name?: string;
  description?: string;
  config?: MCPHttpConfig | MCPStdioConfig;
  enabled?: boolean;
}

export interface DockerMCPServer {
  name: string;
  description: string;
  toolCount: number;
}

export interface MCPIntegrationDetails extends MCPIntegration {
  tools?: MCPToolInfo[];
  connectionStatus?: 'connected' | 'disconnected' | 'error';
  error?: string;
}

export interface MCPToolInfo {
  name: string;
  description: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

// Code Integration Types
export interface CodeIntegration extends BaseIntegration {
  type: 'code';
  config: CodeIntegrationConfig;
}

export interface CodeIntegrationConfig {
  gitUrl: string;
  token: string;
  repositories: string[];
  webhookSecret?: string;
}

export interface CreateCodeIntegrationRequest {
  name: string;
  description?: string;
  config: CodeIntegrationConfig;
  enabled?: boolean;
}

export interface UpdateCodeIntegrationRequest {
  name?: string;
  description?: string;
  config?: Partial<CodeIntegrationConfig>;
  enabled?: boolean;
}

export interface CodeIntegrationDetails extends CodeIntegration {
  repositories?: RepositoryInfo[];
  connectionStatus?: 'connected' | 'disconnected' | 'error';
  error?: string;
}

export interface RepositoryInfo {
  name: string;
  fullName: string;
  branch: string;
  lastCommit?: string;
  lastCommitDate?: string;
}

export type Integration = MCPIntegration | CodeIntegration | CustomIntegration;

// Built-in Integration Types
export type BuiltInIntegrationCategory = 'all' | 'security' | 'communication' | 'development';

export interface CustomIntegrationField {
  key: string;
  displayName: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  secret?: boolean;
  type?: 'string' | 'password' | 'textarea' | 'number' | 'boolean';
}

export type CustomIntegrationConfigSchema = CustomIntegrationField[];

// OAuth metadata that built-in integrations can optionally expose to the UI
export interface BuiltInOAuthConfig {
  authorizeUrl: string;
  scopes?: string[];
  params?: Record<string, string>;
}

export interface BuiltInIntegration {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  uiCategory?: BuiltInIntegrationCategory;
  type: 'mcp' | 'code' | 'custom';
  config: MCPHttpConfig | MCPStdioConfig | CodeIntegrationConfig | Record<string, any>;
  configSchema?: CustomIntegrationConfigSchema;

  // Optional OAuth metadata the UI can use to build consent links
  oauth?: BuiltInOAuthConfig;
}

export interface ValidateIntegrationRequest {
  integrationId: string;
  config: Record<string, any>;
}

export interface ValidateIntegrationResponse {
  valid: boolean;
  error?: string;
}

export interface CustomIntegration extends BaseIntegration {
  type: 'custom';
  config: Record<string, string>;
}

export interface CreateCustomIntegrationRequest {
  name: string;
  description?: string;
  config: Record<string, string>;
  enabled?: boolean;
}

export interface UpdateCustomIntegrationRequest {
  name?: string;
  description?: string;
  config?: Partial<Record<string, string>>;
  enabled?: boolean;
}

// Agent Types
export interface Agent {
  id: string;
  name: string;
  role: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentRequest {
  name: string;
  role: string;
}

export interface UpdateAgentRequest {
  name?: string;
  role?: string;
}

// Task Run Types - for persisting execution history
export interface TaskRun {
  id: string;
  taskId: string;
  taskName?: string;
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
  type: 'toolUse' | 'planStepStart' | 'planStepResult' | 'stepMemoryRetrieved' | 'other';
  name?: string;
  reason?: string;
  message?: string;
  error?: string;
  result?: any;
  status?: 'pending' | 'running' | 'success' | 'failed';
  data?: any;
  insights?: string;
}

// Feedback Types - for user feedback on task runs
export interface Feedback {
  id: string;
  taskId: string;
  taskRunId?: string;
  role: 'user' | 'system';
  content: string;
  createdAt: string;
  rating?: 'like' | 'dislike';
}

export interface CreateFeedbackRequest {
  taskId: string;
  taskRunId?: string;
  content: string;
  rating?: 'like' | 'dislike';
}

// Thought interface for chain of thoughts UI
export interface Thought {
  id: string;
  content?: string; // legacy
  timestamp: Date;
  type?: 'toolUse' | 'toolResult' | 'step' | 'task' | 'error' | 'stepMemoryRetrieved' | 'other';
  name?: string;
  reason?: string;
  message?: string;
  error?: string;
  result?: any;
  parameters?: any; // Original toolUse parameters (e.g., command, path, file)
  status?: 'pending' | 'running' | 'success' | 'failed';
  insights?: string;
  childEventCount?: number; // Number of events between toolUse and toolResult (indicates depth)
}

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

export interface AssetDetail extends Asset {
  responsibility?: string;
  threatModel?: any;
  /** Service-level merged DFD (present on code_service entities after feature extraction) */
  serviceDfd?: {
    dataFlowDiagram: any;
    featuresCovered: string[];
    reasoning: string;
    generatedAt: string;
  };
  /** Service-level STRIDE threat model (present on code_service entities after feature extraction) */
  serviceThreatModel?: any;
  fullEntity: any;
  link?: string;
}

export interface RelationshipNode {
  id: string;
  type: string;
  name: string;
  metadata: Record<string, any>;
}

export interface RelationshipEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  metadata: Record<string, any>;
}

export interface RepositoryArtifact {
  id: string;
  entityType: string;
  name: string;
  codePath?: string;
  language?: string;
  techStack?: string[];
  serviceType?: string;
  buildType?: string;
  deploymentType?: string;
  technology?: string;
  isEntryPoint?: boolean;
  entryType?: string;
  responsibility?: string;
  riskScore?: number;
  businessCriticality?: 'critical' | 'high' | 'medium' | 'low';
  serviceIds?: string[];
  link?: string;
  /** The repository this artifact belongs to (resolved name, not ID) */
  repositoryName?: string;
  metadata: Record<string, any>;
}

export interface RepositoryArtifacts {
  repositoryId: string;
  services: RepositoryArtifact[];
  builds: RepositoryArtifact[];
  deployments: RepositoryArtifact[];
  modules: RepositoryArtifact[];
  cloudResources: RepositoryArtifact[];
}

export interface RelationshipGraph {
  nodes: RelationshipNode[];
  edges: RelationshipEdge[];
  graph?: {
    nodes: Array<{
      id: string;
      type: string;
      label: string;
      severity?: string;
      metadata?: Record<string, any>;
      relatedEntities?: Array<{
        id: string;
        type: string;
        label: string;
        relationshipType: string;
        metadata?: Record<string, any>;
        link?: string;
      }>;
      link?: string;
    }>;
    edges: Array<{
      id: string;
      from: string;
      to: string;
      type: string;
      confidence: string;
      label?: string;
    }>;
    focusNodeId?: string;
    explanation?: string;
  };
}

// Scan Types
export interface ScanOptions {
  enableCloudDiscovery: boolean;
  scope?: 'all' | 'code' | 'cloud';
  /** Optional allow-list of repository names to index; undefined means all. */
  repositories?: string[];
  /**
   * 'incremental' (default) — only re-indexes files changed since the last run.
   * 'full' — re-indexes everything; use when forcing a complete refresh.
   * Falls back to 'full' automatically if no prior run record exists.
   */
  runType?: 'full' | 'incremental';
}

/** Repository info returned by the scan discovery endpoint. */
export interface ScanRepositoryInfo {
  name: string;
  url: string;
  defaultBranch: string;
}

export type ScanStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ScanStageInfo {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: string;
  completedAt?: string;
  itemsProcessed?: number;
  error?: string;
}

export interface ScanRecord {
  scanId: string;
  tenantId: string;
  status: ScanStatus;
  options: ScanOptions;
  startedAt: string;
  completedAt?: string;
  runId?: string;
  repositoriesDiscovered?: number;
  tasksEnqueued?: number;
  stages: ScanStageInfo[];
  error?: string;
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

/** A single data flow entry (baseline or updated) */
export interface FeatureDataFlowEntry {
  from: string;
  to: string;
  dataTypes: string[];
  protocol: string;
  encrypted: boolean;
  authRequired: boolean;
}

export interface SecurityAttestation {
  taskId: string;
  handled: boolean;
  notes: string;
}

/** A single data classification entry provided by the agent at attest time */
export interface ReviewDataClassificationEntry {
  classification: string;
  dataTypes: string[];
  protectionMechanisms: string[];
}

/** Diff result for a single data classification entry */
export interface DataClassificationDiffEntry {
  changeType: 'added' | 'removed' | 'changed' | 'unchanged';
  baseline: ReviewDataClassificationEntry | null;
  updated: ReviewDataClassificationEntry | null;
}

/** Diff result for a single data flow entry */
export interface DataFlowDiffEntry {
  changeType: 'added' | 'removed' | 'changed' | 'unchanged';
  baseline: FeatureDataFlowEntry | null;
  updated: FeatureDataFlowEntry | null;
}

/** Computed diff between baseline and updated architecture sections for one feature */
export interface ArchitectureDiff {
  featureId: string;
  featureName: string;
  dataClassificationDiff: DataClassificationDiffEntry[];
  dataFlowDiff: DataFlowDiffEntry[];
  hasChanges: boolean;
  /** Agent-authored rationale explaining why the architecture changed */
  dfdChangeRationale?: string;
}

/** Updated architecture sections submitted at attest time for one linked feature */
export interface AttestationArchitectureUpdate {
  featureId: string;
  updatedDataFlowSummary: FeatureDataFlowEntry[];
  updatedDataClassification: ReviewDataClassificationEntry[];
  dfdChangeRationale: string;
}

// ── Threat Model Types ────────────────────────────────────────────────────────

export interface AttackPathHop {
  entityId: string;
  entityLabel: string;
  entityType: string;
  relationshipType: string;
  isWeakLink: boolean;
  weaknessReason?: string;
}

export interface AttackPath {
  id: string;
  threatId: string;
  entryPoint: string;
  target: string;
  hops: AttackPathHop[];
  feasibilityScore: number;
  controlsBlocking: string[];
}

export interface MitigationRecommendation {
  id: string;
  title: string;
  description: string;
  priority: 'immediate' | 'short-term' | 'long-term';
  blocksAttackPath: boolean;
  targetComponent?: string;
}

export interface ExploitabilityResult {
  threatId: string;
  threatDescription?: string;
  isExploitable: boolean;
  confidence: 'high' | 'medium' | 'low';
  originalSeverity: ThreatSeverity;
  adjustedSeverity: ThreatSeverity;
  adjustmentReason: string;
  attackPaths: AttackPath[];
  exploitationNarrative: string;
  prerequisites: string[];
  detectionOpportunities: string[];
  mitigationRecommendations: MitigationRecommendation[];
  notExploitableReason?: string;
  analyzedAt: string;
}

export interface ServiceExploitabilityAnalysis {
  results: ExploitabilityResult[];
  analyzedAt: string;
  adjustedRiskScore: number;
}

export interface ThreatModelNode {
  id: string;
  type: string;
  label: string;
  severity?: string;
  trustZone?: 'external' | 'dmz' | 'internal' | 'trusted';
  metadata?: Record<string, any>;
  link?: string;
  exploitabilityResults?: ExploitabilityResult[];
}

export interface DataFlowInfo {
  dataTypes: string[];
  dataClassification: 'public' | 'internal' | 'confidential' | 'restricted';
  direction: 'inbound' | 'outbound' | 'bidirectional';
  protocol?: string;
  encrypted: boolean;
  purpose?: string;
  volume?: 'low' | 'medium' | 'high';
}

export interface ThreatModelEdge {
  id: string;
  from: string;
  to: string;
  type: string;
  confidence: string;
  label?: string;
  dataFlow?: DataFlowInfo;
  isOnAttackPath?: boolean;
  attackPathIds?: string[];
}

export interface ThreatModelGraph {
  nodes: ThreatModelNode[];
  edges: ThreatModelEdge[];
  capturedAt: string;
  explanation?: string;
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

export interface ThreatModelChange {
  title: string;
  entityIds: string[];
  changeType: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  securityImplication: string;
  recommendation?: string;
}

export interface ThreatModelAiAnalysis {
  summary: string;
  overallImpact: 'positive' | 'neutral' | 'negative' | 'mixed';
  changes: ThreatModelChange[];
  riskNarrative: string;
  generatedAt: string;
  model?: string;
}

/** Slim feature info returned by start_security_review (matchedFeatures). */
export interface FeatureContext {
  id: string;
  name: string;
  businessValue: string;
  description: string;
}

/** Full security baseline for a selected feature, returned by submit_security_answers. */
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
  /** Lightweight feature records matched from the services list */
  matchedFeatures?: FeatureContext[];
  /** Feature IDs this review is associated with (derived from the feature_scope answer) */
  linkedFeatureIds?: string[];
  /** Enriched DFD + security context for linked features (set by submit_security_answers) */
  featureSecurityContext?: FeatureSecurityContext[];
  /** Architecture updates submitted at attest time (one per linked feature) */
  architectureUpdates?: AttestationArchitectureUpdate[];
  /** Computed diff between baseline and updated architecture sections */
  architectureDiff?: ArchitectureDiff[];
  /** Threat model state captured after the feature is implemented */
  threatModelSnapshot?: ThreatModelGraph;
  threatModelDiff?: ThreatModelDiff;
  /** Version of the PolicyTemplate that was active when this review was created */
  policyTemplateVersion?: number;
  /** Type of policy template used to create this review */
  policyTemplateType?: PolicyTemplateType;
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

// Export from shared package

// ── Business Feature Types ────────────────────────────────────────────────────

export type DataClassification = 'public' | 'internal' | 'confidential' | 'restricted';
export type ThreatSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * The five canonical trust boundary types.
 *
 * INTERNET  – boundary between public internet clients and the system.
 * IDENTITY  – boundary where authentication / identity validation occurs.
 * SERVICE   – boundary between internal microservices with separate permissions.
 * DATA      – boundary when accessing persistent storage.
 * EXTERNAL  – boundary when calling third-party / SaaS services outside our control.
 */
export type TrustBoundaryType = 'INTERNET' | 'IDENTITY' | 'SERVICE' | 'DATA' | 'EXTERNAL';

export type StrideCategory =
  | 'Spoofing'
  | 'Tampering'
  | 'Repudiation'
  | 'InformationDisclosure'
  | 'DenialOfService'
  | 'ElevationOfPrivilege';

export interface FeatureCorrelationTag {
  entityType: 'code_service' | 'cloud_resource' | 'data_store' | 'api_endpoint' | 'external_dependency' | 'identity';
  keywords: string[];
  resolvedEntityId?: string;
}

export interface DFDActor {
  id: string;
  label: string;
  type: string;
  trusted: boolean;
  /** Trust boundary zone this actor lives in. */
  trustBoundary?: TrustBoundaryType;
  correlationTags: FeatureCorrelationTag[];
}

export interface DFDProcess {
  id: string;
  label: string;
  type: string;
  trustBoundary?: TrustBoundaryType;
  correlationTags: FeatureCorrelationTag[];
}

export interface DFDDataStore {
  id: string;
  label: string;
  type: string;
  dataClassification: DataClassification;
  encryptionAtRest: boolean;
  /** Trust boundary zone this data store lives in. */
  trustBoundary?: TrustBoundaryType;
  correlationTags: FeatureCorrelationTag[];
}

export interface DFDFlow {
  id: string;
  from: string;
  to: string;
  label: string;
  dataTypes: string[];
  dataClassification: DataClassification;
  direction: 'inbound' | 'outbound' | 'bidirectional';
  protocol: string;
  encrypted: boolean;
  authenticationRequired: boolean;
  crossesTrustBoundary: boolean;
}

export interface FeatureDataFlowDiagram {
  actors: DFDActor[];
  processes: DFDProcess[];
  dataStores: DFDDataStore[];
  flows: DFDFlow[];
  /** Canonical trust boundary types referenced by nodes */
  trustBoundaries: TrustBoundaryType[];
}

export interface STRIDEThreat {
  id: string;
  title: string;
  category: StrideCategory;
  description: string;
  affectedComponents: string[];
  affectedFlows: string[];
  severity: ThreatSeverity;
  likelihoodScore: number;
  impactScore: number;
  mitigations: string[];
  status: 'identified' | 'mitigated' | 'accepted' | 'transferred';
  cvssVector?: string;
  /** Original STRIDE-assigned severity, before exploitability adjustment */
  originalSeverity?: ThreatSeverity;
  /** Reason severity was adjusted by exploitability analysis */
  adjustmentReason?: string;
}

export interface FeatureThreatModel {
  strideThreats: STRIDEThreat[];
  trustBoundaryAnalysis: Array<{
    name: string;
    crossingFlows: string[];
    controlsRequired: string[];
    controlsInPlace: string[];
    riskRating: ThreatSeverity;
  }>;
  dataClassificationSummary: Array<{
    classification: DataClassification;
    dataTypes: string[];
    storageLocations: string[];
    transmissionPaths: string[];
    protectionMechanisms: string[];
  }>;
  overallRiskScore: number;
  complianceConsiderations: string[];
  attackVectors: string[];
  securityRecommendations: string[];
}

export interface BusinessFeature {
  id: string;
  tenantId: string;
  entityType: 'feature_analysis';
  name: string;
  description: string;
  businessValue: string;
  userStories: string[];
  technicalSummary: string;
  correlationTags: FeatureCorrelationTag[];
  sourceServiceIds: string[];
  dataFlowDiagram: FeatureDataFlowDiagram;
  threatModel: FeatureThreatModel;
  confidence: 'llm' | 'heuristic';
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface BusinessFeatureSummary {
  id: string;
  name: string;
  description: string;
  sourceServiceIds: string[];
  overallRiskScore: number;
  threatCount: number;
  complianceConsiderations: string[];
  highestSeverity: ThreatSeverity | null;
  createdAt: string;
  updatedAt: string;
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
