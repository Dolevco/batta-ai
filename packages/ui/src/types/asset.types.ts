import type { ThreatSeverity, BusinessCriticality } from './common.types';

export type { ThreatSeverity, BusinessCriticality };

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
  businessCriticality?: BusinessCriticality;
  riskScore?: number;
  metadata: Record<string, unknown>;
}

interface ThreatModelDfd {
  dataFlowDiagram: unknown;
  featuresCovered: string[];
  reasoning: string;
  generatedAt: string;
}

export interface AssetDetail extends Asset {
  responsibility?: string;
  threatModel?: unknown;
  serviceDfd?: ThreatModelDfd;
  serviceThreatModel?: unknown;
  fullEntity: unknown;
  link?: string;
}

export interface DataStoreServiceAccess {
  serviceId: string;
  serviceName: string;
  accessPattern: 'read' | 'write' | 'read_write';
  dataTypes: string[];
  resourceNames?: string[];
  featureIds: string[];
  evidence: 'dfd' | 'static_analysis' | 'both';
}

export interface DataStoreSummary {
  id: string;
  name: string;
  storeType: string;
  technology?: string;
  dataClassification?: string;
  encryptionAtRest?: boolean;
  cloudResourceName?: string;
  serviceCount: number;
  featureCount: number;
  dataTypes: string[];
  responsibility?: string;
  lastIndexedAt?: string;
}

export interface DataStoreDetail extends DataStoreSummary {
  cloudResourceId?: string;
  encryptionInTransit?: boolean;
  serviceAccess: DataStoreServiceAccess[];
  featureIds: string[];
  featureNames?: string[];
  metadata: Record<string, unknown>;
}

interface RelationshipNode {
  id: string;
  type: string;
  name: string;
  metadata: Record<string, unknown>;
}

interface RelationshipEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  metadata: Record<string, unknown>;
}

interface RelationshipGraphNode {
  id: string;
  type: string;
  label: string;
  severity?: string;
  metadata?: Record<string, unknown>;
  relatedEntities?: Array<{
    id: string;
    type: string;
    label: string;
    relationshipType: string;
    metadata?: Record<string, unknown>;
    link?: string;
  }>;
  link?: string;
}

interface RelationshipGraphEdge {
  id: string;
  from: string;
  to: string;
  type: string;
  confidence: string;
  label?: string;
}

export interface RelationshipGraph {
  nodes: RelationshipNode[];
  edges: RelationshipEdge[];
  graph?: {
    nodes: RelationshipGraphNode[];
    edges: RelationshipGraphEdge[];
    focusNodeId?: string;
    explanation?: string;
  };
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
  businessCriticality?: BusinessCriticality;
  serviceIds?: string[];
  link?: string;
  repositoryName?: string;
  metadata: Record<string, unknown>;
}

export interface RepositoryArtifacts {
  repositoryId: string;
  services: RepositoryArtifact[];
  builds: RepositoryArtifact[];
  deployments: RepositoryArtifact[];
  modules: RepositoryArtifact[];
  cloudResources: RepositoryArtifact[];
}

export type ScanDomain = 'iac' | 'services' | 'service_relationships' | 'features';

export interface ScanOptions {
  enableCloudDiscovery: boolean;
  scope?: 'all' | 'code' | 'cloud';
  repositories?: string[];
  runType?: 'full' | 'incremental';
  domains?: ScanDomain[];
}

export interface ScanRepositoryInfo {
  name: string;
  url: string;
  defaultBranch: string;
}

type ScanStatus = 'queued' | 'running' | 'completed' | 'failed';

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
  repositoriesDiscovered?: number;
  tasksEnqueued?: number;
  stages: ScanStageInfo[];
  error?: string;
}

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
