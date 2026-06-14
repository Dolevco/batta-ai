import type { ThreatSeverity } from './common.types';

type DataClassification = 'public' | 'internal' | 'confidential' | 'restricted';

export type TrustBoundaryType = 'INTERNET' | 'IDENTITY' | 'SERVICE' | 'DATA' | 'EXTERNAL';

export type StrideCategory =
  | 'Spoofing'
  | 'Tampering'
  | 'Repudiation'
  | 'InformationDisclosure'
  | 'DenialOfService'
  | 'ElevationOfPrivilege';

interface FeatureCorrelationTag {
  entityType: 'code_service' | 'cloud_resource' | 'data_store' | 'api_endpoint' | 'external_dependency' | 'identity';
  keywords: string[];
  resolvedEntityId?: string;
}

export interface DFDActor {
  id: string;
  label: string;
  type: string;
  trusted: boolean;
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
  originalSeverity?: ThreatSeverity;
  adjustmentReason?: string;
}

interface FeatureThreatModel {
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

export type { ThreatSeverity };
