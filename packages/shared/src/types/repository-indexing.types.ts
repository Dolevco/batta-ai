/**
 * Repository Indexing Types
 *
 * Types for the MCP-driven local repository indexing workflow.
 * The coding agent supplies repository understanding; batta validates,
 * persists, and reuses canonical security context.
 *
 * Classification: INTERNAL — no secret values may appear in any field.
 */

import type {
  DataFlowDiagram,
  FeatureThreatModel,
  ServiceThreatModel,
  ServiceDfd,
} from './business-feature.types';

// ─── Stages ──────────────────────────────────────────────────────────────────

export type RepositoryIndexingStage =
  | 'repository_inventory'
  | 'service_extraction'
  | 'feature_extraction'
  | 'dfd_creation'
  | 'threat_model_creation'
  | 'relationship_correlation'
  | 'completeness_check'
  | 'completed';

// ─── Evidence Reference ───────────────────────────────────────────────────────

export interface EvidenceRef {
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  symbol?: string;
  rationale: string;
}

// ─── Stage Submission Payloads ────────────────────────────────────────────────

export interface RepositoryInventorySubmission {
  name: string;
  url?: string;
  defaultBranch?: string;
  languages: string[];
  frameworks: string[];
  buildTools: string[];
  packageManagers: string[];
  serviceCandidates: string[];
  entryPointCandidates: string[];
  importantDirectories: string[];
  deploymentArtifacts: string[];
  buildArtifacts: string[];
  architecturalPatterns: string[];
  deploymentTargets: string[];
  summary: string;
  evidence: EvidenceRef[];
}

export interface ServiceContextSubmission {
  name: string;
  serviceType: 'api' | 'library' | 'worker' | 'other';
  codePath: string;
  language: string;
  techStack: string[];
  responsibility: string;
  businessValue: string;
  entryPointTypes: string[];
  exposedEndpoints: Array<{ method: string; path: string; file: string }>;
  authBoundaries: string[];
  dataStores: string[];
  externalDependencies: Array<{
    name: string;
    type: 'api' | 'cloud' | 'queue' | 'database' | 'cache' | 'storage' | 'identity' | 'other';
    protocol?: string;
    purpose: string;
    dataFlow: 'inbound' | 'outbound' | 'bidirectional';
    dataClassification: 'public' | 'internal' | 'confidential' | 'restricted';
    businessValue: string;
    resourceName?: string;
    endpoints?: string[];
    operations?: string[];
  }>;
  internalDependencies: string[];
  priorityFiles: string[];
  evidence: EvidenceRef[];
}

export interface FeatureContextSubmission {
  name: string;
  description: string;
  businessValue: string;
  userStories: string[];
  technicalSummary: string;
  sourceServiceNames: string[];
  routeEvidence: EvidenceRef[];
  correlationTags: string[];
}

export interface DfdContextSubmission {
  featureName: string;
  dataFlowDiagram: DataFlowDiagram;
  evidence: EvidenceRef[];
}

export interface ThreatModelContextSubmission {
  featureName: string;
  featureThreatModel: FeatureThreatModel;
  serviceThreatModels: Array<{
    serviceName: string;
    threatModel: ServiceThreatModel;
    serviceDfd: ServiceDfd;
  }>;
}

export interface RelationshipSubmission {
  sourceKey: string;
  targetKey: string;
  relationshipType: string;
  confidence: 'deterministic' | 'manual' | 'heuristic';
  rationale: string;
  evidence: EvidenceRef[];
}

export type RepositoryIndexingSubmission =
  | { stage: 'repository_inventory'; inventory: RepositoryInventorySubmission }
  | { stage: 'service_extraction'; services: ServiceContextSubmission[] }
  | { stage: 'feature_extraction'; features: FeatureContextSubmission[] }
  | { stage: 'dfd_creation'; dfds: DfdContextSubmission[] }
  | { stage: 'threat_model_creation'; threatModels: ThreatModelContextSubmission[] }
  | { stage: 'relationship_correlation'; relationships: RelationshipSubmission[] }
  | { stage: 'completeness_check'; notes?: string; acceptedGaps?: string[] };

// ─── Request / Response ───────────────────────────────────────────────────────

export interface RepositoryIndexingRequest {
  sessionId?: string;
  submission?: RepositoryIndexingSubmission;
  forceNewSession?: boolean;
}

export interface ValidationError {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface IndexingGap {
  id: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
  affectedEntity?: string;
  followUp?: string;
}

export interface IndexingCoverage {
  hasRepository: boolean;
  serviceCount: number;
  featureCount: number;
  servicesWithDfd: number;
  featuresWithThreatModel: number;
  overallPercent: number;
}

export interface RepositoryIndexingResponse {
  sessionId: string;
  repository?: string;
  stage: RepositoryIndexingStage;
  status: 'running' | 'completed' | 'failed';
  knownContext: Record<string, unknown>;
  coverage: IndexingCoverage;
  gaps: IndexingGap[];
  questions: string[];
  inspect: string[];
  instructions: string;
  requiredOutputSchema?: Record<string, unknown>;
  validationErrors?: ValidationError[];
  nextAction: string;
  /** Gaps in architectural context — mirrors gaps in MVP, may diverge as gap scoring matures. */
  missingContext?: IndexingGap[];
  /** Overall confidence in the indexed context based on coverage and gap severity. */
  confidence?: 'high' | 'medium' | 'low';
  /** Staleness signal: true when architecture updates have been attested but not yet re-indexed. */
  staleness?: {
    stale: boolean;
    reason?: string;
    lastIndexedAt?: string;
  };
  /** Example queries the agent can ask once indexing is complete. */
  suggestedNextQueries?: string[];
}

export interface RepositoryIndexingStatusResponse {
  sessionId?: string;
  repository?: string;
  stage: RepositoryIndexingStage;
  status: 'running' | 'completed' | 'failed' | 'not_started';
  coverage: IndexingCoverage;
  gaps: IndexingGap[];
  lastUpdated?: string;
  completedStages: RepositoryIndexingStage[];
}

// ─── Run Metadata ─────────────────────────────────────────────────────────────

export interface RepositoryIndexingRunMetadata {
  indexer: 'mcp_agent';
  repository?: string;
  currentStage: RepositoryIndexingStage;
  completedStages: RepositoryIndexingStage[];
  stageVersions: Partial<Record<RepositoryIndexingStage, number>>;
  coverage: IndexingCoverage;
  gaps: IndexingGap[];
  drafts: {
    inventory?: RepositoryInventorySubmission;
    features?: FeatureContextSubmission[];
  };
  validationHistory: Array<{
    stage: RepositoryIndexingStage;
    timestamp: string;
    errors: ValidationError[];
  }>;
  persistedIds?: {
    repositoryId?: string;
    serviceIds?: Record<string, string>;
    featureIds?: Record<string, string>;
    /** Service names that had serviceDfd successfully written during threat_model_creation */
    servicesWithDfd?: string[];
    /** Feature names that had a threat model successfully written */
    featuresWithThreatModel?: string[];
  };
}
