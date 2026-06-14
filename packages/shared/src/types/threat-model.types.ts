import type { ExploitabilityResult } from './canonical.types';

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

export interface ThreatModelEdge {
  id: string;
  from: string;
  to: string;
  type: string;
  confidence: string;
  label?: string;
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

export interface ThreatModelDiff {
  previousReviewId: string | null;
  addedNodes: ThreatModelNode[];
  removedNodes: ThreatModelNode[];
  modifiedNodes: Array<{ before: ThreatModelNode; after: ThreatModelNode }>;
  addedEdges: ThreatModelEdge[];
  removedEdges: ThreatModelEdge[];
  aiAnalysis?: ThreatModelAiAnalysis;
}
