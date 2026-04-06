export * from './integrations';
export * from './persistence';
export * from './types';
export * from './factory';
export * from './events';
export * from './persistence/qdrantTaskRepository';
export * from './persistence/qdrantTaskRunRepository';
export * from './persistence/qdrantAgentRepository';

// Export services
export { AssetService } from './services/assetService';
export type { AssetDetail, RelationshipNode, RelationshipEdge, RelationshipGraph, RepositoryArtifact, RepositoryArtifacts } from './services/assetService';
export { SecurityReviewService } from './services/securityReviewService';
export { PolicyService } from './services/policyService';
export { FeatureService, FEATURE_ANALYSES_COLLECTION } from './services/featureService';
export type { FeatureSemanticSearchResult } from './services/featureService';
export { PRCorrelationService, sanitiseGitContext, parseRemoteUrl, scorePR } from './services/prCorrelationService';
export type { CorrelationIntegration, ParsedRemote } from './services/prCorrelationService';

// Pipeline output types (new 3-pass pre-analysis)
export type { ServiceFileMap, ServiceSkeleton, ServiceExternalSurface } from './types/canonical.types';

// Script analysis types
export type { ScriptAnalysis, ScriptAnalysisServiceRef } from './types/canonical.types';

// Business feature types
export type {
  BusinessFeature,
  BusinessFeatureSummary,
  DataFlowDiagram,
  DFDActor,
  DFDProcess,
  DFDDataStore,
  DFDFlow,
  FeatureThreatModel,
  STRIDEThreat,
  TrustBoundaryAnalysis,
  DataClassificationSummary,
  CorrelationTag,
  DataClassification,
  TrustBoundaryType,
  ActorType,
  ProcessType,
  FeatureProcessType,
  DataStoreNodeType,
  StrideCategory,
  ThreatSeverity,
  ServiceDfd,
  ServiceThreatModel,
  FeatureChangeLogEntry,
} from './types/business-feature.types';
export { VALID_TRUST_BOUNDARY_TYPES, VALID_FEATURE_PROCESS_TYPES } from './types/business-feature.types';