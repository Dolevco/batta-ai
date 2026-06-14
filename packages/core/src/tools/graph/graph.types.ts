/**
 * Graph visualization types for security and dependency analysis
 */

import { ToolResult } from "../types";


export type GraphNodeType = 
  | 'CodeModule' 
  | 'CodeService' 
  | 'BuildArtifact' 
  | 'DeploymentArtifact'
  | 'CloudResource' 
  | 'AzureIdentity'
  | 'Dependency'
  | 'Vulnerability'
  | 'Threat'
  | 'TrustBoundary'
  | 'RiskLevel';

export type GraphNodeSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface RelatedEntity {
  id: string;
  type: GraphNodeType;
  label: string;
  relationshipType: GraphEdgeType;
  metadata?: {
    [key: string]: any;
  };
  link?: string;
}

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  severity?: GraphNodeSeverity;
  metadata?: {
    path?: string;
    environment?: string;
    owner?: string;
    version?: string;
    [key: string]: any;
  };
  relatedEntities?: RelatedEntity[];
  link?: string;
}

export type GraphEdgeType =
  | 'BUILDS'
  | 'DEPLOYS'
  | 'DEPLOYED_AS'
  | 'DEPLOYED_TO'
  | 'IMPLEMENTS'
  | 'DEPENDS_ON'
  | 'CONTAINS'
  | 'USES'
  | 'AFFECTS'
  | 'IMPORT'
  | 'THREATENS'
  | 'EXPOSES'
  | 'CROSSES'
  | 'HAS_RISK'
  | 'ASSIGNED_TO'
  | 'HAS_ROLE';

export type GraphEdgeConfidence = 'deterministic' | 'heuristic' | 'manual';

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type: GraphEdgeType;
  confidence: GraphEdgeConfidence;
  label?: string;
}

/** Discriminates how the UI should render this graph result */
export type GraphType = 'relationship' | 'dfd';

export interface GraphProjection {
  nodes: GraphNode[];
  edges: GraphEdge[];
  focusNodeId?: string;
  explanation?: string;
  /** Tells the UI which renderer to use. Defaults to 'relationship' when absent. */
  graphType?: GraphType;
  /**
   * Raw Data Flow Diagram payload — only present when graphType === 'dfd'.
   * Shape mirrors FeatureDataFlowDiagram from @batta/shared.
   */
  dfd?: {
    actors: any[];
    processes: any[];
    dataStores: any[];
    flows: any[];
    trustBoundaries: string[];
    featureName: string;
  };
}


export interface GraphToolResult extends ToolResult {
  /** Graph projection data for visualization */
  graph: GraphProjection;
}

// ── Table visualization types ─────────────────────────────────────────────────

/**
 * Discriminates the entity type so the UI can choose the right renderer
 * and build the correct navigation URL.
 */
export type TableEntityType = 'feature' | 'security_review' | 'service';

/**
 * A single row in the table projection.
 * `id` is the entity ID used to build the navigation link.
 * `columns` is an ordered map of column-key → display value (string).
 * `metadata` carries extra structured data the renderer may use for badges/pills.
 */
export interface TableRow {
  id: string;
  columns: Record<string, string | number | null | undefined>;
  /** Optional richer metadata used by the renderer (e.g. severity, riskScore, status). */
  metadata?: Record<string, any>;
}

/** Column definition for the table header */
export interface TableColumn {
  key: string;
  label: string;
  /** Hint to the renderer about how to display this column */
  renderHint?: 'text' | 'badge' | 'risk_score' | 'severity' | 'status' | 'date' | 'tags' | 'compliance';
}

export interface TableProjection {
  entityType: TableEntityType;
  title: string;
  columns: TableColumn[];
  rows: TableRow[];
  /** Optional human-readable explanation shown above the table */
  explanation?: string;
  /** Total count before any pagination, useful when rows are truncated */
  totalCount?: number;
}

export interface TableToolResult extends ToolResult {
  /** Table projection data for visualization */
  table: TableProjection;
}
