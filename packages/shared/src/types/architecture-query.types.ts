/**
 * Architecture Query Types
 *
 * Public types for the three MVP MCP architecture query tools:
 *   query_architecture, get_architecture_baseline, find_architecture_gaps
 *
 * Classification: INTERNAL — no secret values, source blobs, or raw tokens.
 */

// ─── Scope ────────────────────────────────────────────────────────────────────

export type ArchitectureScopeType =
  | 'repository'
  | 'service'
  | 'feature'
  | 'review'
  | 'data_store';

export interface ArchitectureScope {
  type: ArchitectureScopeType;
  id?: string;
  name?: string;
}

// ─── Filters ─────────────────────────────────────────────────────────────────

export interface ArchitectureQueryFilters {
  serviceName?: string;
  featureId?: string;
  featureName?: string;
  dataClassification?: 'public' | 'internal' | 'confidential' | 'restricted';
  trustBoundary?: 'INTERNET' | 'IDENTITY' | 'SERVICE' | 'DATA' | 'EXTERNAL';
  minSeverity?: 'critical' | 'high' | 'medium' | 'low' | 'info';
  relationshipType?: string;
  externalOnly?: boolean;
  authRequired?: boolean;
  encrypted?: boolean;
}

// ─── Request / Response ───────────────────────────────────────────────────────

export interface ArchitectureQueryRequest {
  query?: string;
  scope?: ArchitectureScope;
  filters?: ArchitectureQueryFilters;
  limit?: number;
  includeEvidence?: boolean;
  includeGaps?: boolean;
}

export interface ArchitectureEvidenceRef {
  subjectId: string;
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  symbol?: string;
  rationale: string;
}

export interface ArchitectureQueryMatch {
  entityId: string;
  entityType: string;
  name?: string;
  summary: string;
  score: number;
  matchedFacts: Record<string, unknown>;
  evidence?: ArchitectureEvidenceRef[];
}

export interface ArchitectureGap {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category:
    | 'missing_context'
    | 'stale_context'
    | 'low_confidence'
    | 'security_control'
    | 'evidence'
    | 'architecture_drift';
  description: string;
  affectedEntityId?: string;
  affectedEntityName?: string;
  followUp: string;
  evidence?: ArchitectureEvidenceRef[];
}

export interface ArchitectureQueryResponse {
  answer: string;
  matches: ArchitectureQueryMatch[];
  gaps: ArchitectureGap[];
  confidence: 'high' | 'medium' | 'low';
  suggestedNextAction?: string;
}

// ─── Baseline ─────────────────────────────────────────────────────────────────

export interface ArchitectureBaselineRequest {
  scope: ArchitectureScope;
  includeThreats?: boolean;
  includeRelationships?: boolean;
  includeEvidence?: boolean;
}

export interface ArchitectureBaselineResponse {
  scope: ArchitectureScope;
  repository?: unknown;
  services: unknown[];
  features: unknown[];
  dataFlowDiagrams: unknown[];
  threatModels: unknown[];
  relationships: unknown[];
  evidence: ArchitectureEvidenceRef[];
  gaps: ArchitectureGap[];
  confidence: 'high' | 'medium' | 'low';
}

// ─── Gap-only response ────────────────────────────────────────────────────────

export interface FindArchitectureGapsResponse {
  gaps: ArchitectureGap[];
  suggestedNextAction?: string;
}
