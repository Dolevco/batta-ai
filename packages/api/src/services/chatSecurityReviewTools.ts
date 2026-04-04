/**
 * Chat Security Review & Feature Tools
 *
 * Read-only tools for the chat assistant to query:
 *  - Security reviews (list, get, tasks, attestations)
 *  - Business features (list, get, data-flow, threat model)
 *
 * Security controls applied here:
 *  - Input sanitisation: all freeform strings are trimmed + length-capped
 *  - ID validation: feature IDs validated against hex pattern before DB lookup
 *  - Error messages: only generic messages returned to caller; detail logged server-side
 *  - Read-only: no writes to any data store
 */

import {
  BaseTool,
  GraphBaseTool,
  TableBaseTool,
  ToolCategory,
  ToolParameter,
  ToolResult,
  GraphToolResult,
  TableToolResult,
} from '@ai-agent/core';
import type { SecurityReviewService, FeatureService, AssetService } from '@ai-agent/shared';
import type { GraphProjection, GraphNode, GraphEdge, TableProjection, TableColumn } from '@ai-agent/core';

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_PARAM_LEN = 500;
const EMPTY_GRAPH: GraphProjection = { nodes: [], edges: [] };

// ── Category ──────────────────────────────────────────────────────────────────

export const SecurityReviewCategory: ToolCategory = {
  name: 'security_review',
  description: 'Tools for querying security reviews, tasks, attestations, and business features',
  keywords: ['security', 'review', 'feature', 'threat', 'task', 'attestation', 'data flow', 'stride'],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function san(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value).trim().slice(0, MAX_PARAM_LEN);
}

async function safe(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err: any) {
    console.error('[ChatSecurityTool]', err?.message ?? err);
    return { success: false, message: 'An internal error occurred', error: 'Internal error' };
  }
}

async function safeGraph(fn: () => Promise<GraphToolResult>): Promise<GraphToolResult> {
  try {
    return await fn();
  } catch (err: any) {
    console.error('[ChatSecurityTool] graph', err?.message ?? err);
    return { success: false, message: 'An internal error occurred', error: 'Internal error', graph: EMPTY_GRAPH };
  }
}

// ── Tool: ListSecurityReviews ─────────────────────────────────────────────────

interface ListReviewsParams extends Record<string, unknown> {
  status?: string;
  limit?: number;
}

const REVIEW_LIST_COLUMNS: TableColumn[] = [
  { key: 'featureDescription', label: 'Feature',    renderHint: 'text' },
  { key: 'status',             label: 'Status',     renderHint: 'status' },
  { key: 'tasks',              label: 'Tasks',      renderHint: 'badge' },
  { key: 'compliance',         label: 'Compliance', renderHint: 'compliance' },
  { key: 'createdAt',          label: 'Created',    renderHint: 'date' },
];

export class ListSecurityReviewsTool extends TableBaseTool<ListReviewsParams> {
  name = 'list_security_reviews';
  category = SecurityReviewCategory;
  description =
    'List security reviews for the current tenant. Optionally filter by status ' +
    '(questionnaire_pending | questionnaire_answered | tasks_acknowledged | attested). ' +
    'Returns a clickable table with status, task count, compliance, and creation date.';
  parameters: ToolParameter[] = [
    { name: 'status', description: 'Optional: filter by review status', required: false, type: 'string' },
    { name: 'limit', description: 'Maximum reviews to return (default 10)', required: false, type: 'number' },
  ];

  constructor(
    private readonly svc: SecurityReviewService,
    private readonly tenantId: string
  ) { super(); }

  async execute(p: ListReviewsParams): Promise<TableToolResult> {
    try {
      const statusFilter = san(p.status);
      const limit = Math.min(Number(p.limit) || 10, 100);
      let reviews = await this.svc.listReviews(this.tenantId);
      if (statusFilter) reviews = reviews.filter((r: any) => r.status === statusFilter);

      reviews.sort((a: any, b: any) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime());
      const sliced = reviews.slice(0, limit) as any[];

      const rows = sliced.map((r: any) => {
        const totalTasks = r.tasks?.length ?? 0;
        const criticalCount = r.tasks?.filter((t: any) => t.severity === 'critical').length ?? 0;
        const attestedCount = r.attestations?.filter((a: any) => a.handled).length ?? 0;
        const compliancePct = r.status === 'attested' && totalTasks > 0
          ? Math.round((attestedCount / totalTasks) * 100)
          : null;
        return {
          id: r.id,
          columns: {
            featureDescription: r.featureDescription ?? '',
            status:             r.status,
            tasks:              totalTasks,
            compliance:         compliancePct !== null ? compliancePct : -1,
            createdAt:          r.createdAt,
          },
          metadata: {
            status:            r.status,
            taskCount:         totalTasks,
            criticalTaskCount: criticalCount,
            compliancePct,
            services:          r.services ?? [],
            agentName:         r.agentName,
            updatedAt:         r.updatedAt,
          },
        };
      });

      const table: TableProjection = {
        entityType: 'security_review',
        title: statusFilter ? `Security Reviews — ${statusFilter}` : 'Security Reviews',
        columns: REVIEW_LIST_COLUMNS,
        rows,
        explanation: `Found ${sliced.length} security review(s)${statusFilter ? ` with status "${statusFilter}"` : ''}`,
        totalCount: reviews.length,
      };

      return {
        success: true,
        message: `Found ${sliced.length} security review(s)`,
        result: JSON.stringify(rows.map(r => ({ id: r.id, status: r.columns.status })), null, 2),
        table,
      };
    } catch (err: any) {
      console.error('[ListSecurityReviewsTool]', err?.message ?? err);
      return this.tableError('An internal error occurred', 'Internal error');
    }
  }
}

// ── Tool: GetSecurityReview ───────────────────────────────────────────────────

interface GetReviewParams extends Record<string, unknown> {
  reviewId: string;
}

export class GetSecurityReviewTool extends BaseTool<GetReviewParams> {
  name = 'get_security_review';
  category = SecurityReviewCategory;
  description =
    'Get full details of a specific security review by ID, including questions, answers, security tasks, and attestations.';
  parameters: ToolParameter[] = [
    { name: 'reviewId', description: 'The ID of the security review', required: true, type: 'string' },
  ];

  constructor(
    private readonly svc: SecurityReviewService,
    private readonly tenantId: string
  ) { super(); }

  async execute(p: GetReviewParams): Promise<ToolResult> {
    return safe(async () => {
      const id = san(p.reviewId);
      if (!id) return { success: false, message: 'reviewId is required', error: 'Missing parameter' };
      const review = await this.svc.getReview(id, this.tenantId);
      if (!review) return { success: false, message: `Security review "${id}" not found`, error: 'Not found' };
      return { success: true, message: `Retrieved security review for: ${review.featureDescription}`, result: JSON.stringify(review, null, 2) };
    });
  }
}

// ── Tool: GetSecurityReviewSummary ────────────────────────────────────────────

export class GetSecurityReviewSummaryTool extends BaseTool<GetReviewParams> {
  name = 'get_security_review_summary';
  category = SecurityReviewCategory;
  description =
    'Get the attestation summary for a security review: which tasks were addressed, which were skipped, and the overall coverage.';
  parameters: ToolParameter[] = [
    { name: 'reviewId', description: 'The ID of the security review', required: true, type: 'string' },
  ];

  constructor(
    private readonly svc: SecurityReviewService,
    private readonly tenantId: string
  ) { super(); }

  async execute(p: GetReviewParams): Promise<ToolResult> {
    return safe(async () => {
      const id = san(p.reviewId);
      if (!id) return { success: false, message: 'reviewId is required', error: 'Missing parameter' };
      const summary = await this.svc.getAttestationSummary(id, this.tenantId);
      return { success: true, message: `Attestation summary for review ${id}`, result: JSON.stringify(summary, null, 2) };
    });
  }
}

// ── Tool: ListBusinessFeatures ────────────────────────────────────────────────

interface ListFeaturesParams extends Record<string, unknown> {
  limit?: number;
}

const FEATURE_LIST_COLUMNS: TableColumn[] = [
  { key: 'name',        label: 'Feature',     renderHint: 'text' },
  { key: 'description', label: 'Description', renderHint: 'text' },
  { key: 'riskScore',   label: 'Risk Score',  renderHint: 'risk_score' },
  { key: 'severity',    label: 'Severity',    renderHint: 'severity' },
  { key: 'threats',     label: 'Threats',     renderHint: 'badge' },
  { key: 'compliance',  label: 'Compliance',  renderHint: 'compliance' },
];

export class ListBusinessFeaturesTool extends TableBaseTool<ListFeaturesParams> {
  name = 'list_business_features';
  category = SecurityReviewCategory;
  description =
    'List all indexed business features for the tenant. Returns a clickable table with name, description, risk score, threat severity, threat count, and compliance tags.';
  parameters: ToolParameter[] = [
    { name: 'limit', description: 'Maximum features to return (default 30)', required: false, type: 'number' },
  ];

  constructor(
    private readonly svc: FeatureService,
    private readonly tenantId: string
  ) { super(); }

  async execute(p: ListFeaturesParams): Promise<TableToolResult> {
    try {
      const limit = Math.min(Number(p.limit) || 30, 100);
      const features = await this.svc.getFeaturesByTenant(this.tenantId);
      const sliced = features.slice(0, limit);

      const rows = sliced.map(f => ({
        id: f.id,
        columns: {
          name:        f.name,
          description: f.description ?? '',
          riskScore:   f.overallRiskScore,
          severity:    f.highestSeverity,
          threats:     f.threatCount,
          compliance:  (f.complianceConsiderations ?? []).join(', '),
        },
        metadata: {
          riskScore:               f.overallRiskScore,
          highestSeverity:         f.highestSeverity,
          threatCount:             f.threatCount,
          complianceConsiderations: f.complianceConsiderations ?? [],
        },
      }));

      const table: TableProjection = {
        entityType: 'feature',
        title: 'Business Features',
        columns: FEATURE_LIST_COLUMNS,
        rows,
        explanation: `Found ${sliced.length} business feature(s)`,
        totalCount: features.length,
      };

      return {
        success: true,
        message: `Found ${sliced.length} business feature(s)`,
        result: JSON.stringify(rows.map(r => ({ id: r.id, name: r.columns.name, riskScore: r.columns.riskScore })), null, 2),
        table,
      };
    } catch (err: any) {
      console.error('[ListBusinessFeaturesTool]', err?.message ?? err);
      return this.tableError('An internal error occurred', 'Internal error');
    }
  }
}

// ── Tool: GetBusinessFeature ──────────────────────────────────────────────────

interface GetFeatureParams extends Record<string, unknown> {
  featureId: string;
}

export class GetBusinessFeatureTool extends BaseTool<GetFeatureParams> {
  name = 'get_business_feature';
  category = SecurityReviewCategory;
  description =
    'Get full details of a business feature by ID, including data flow diagram, STRIDE threat model, compliance considerations, and security recommendations.';
  parameters: ToolParameter[] = [
    { name: 'featureId', description: 'The ID of the business feature (36-char hex)', required: true, type: 'string' },
  ];

  constructor(
    private readonly svc: FeatureService,
    private readonly tenantId: string
  ) { super(); }

  async execute(p: GetFeatureParams): Promise<ToolResult> {
    return safe(async () => {
      const id = san(p.featureId);
      if (!id) return { success: false, message: 'featureId is required', error: 'Missing parameter' };
      if (!/^[0-9a-f-]{32,40}$/.test(id)) return { success: false, message: 'Invalid featureId format', error: 'Validation error' };
      const feature = await this.svc.getFeatureById(this.tenantId, id);
      if (!feature) return { success: false, message: `Feature "${id}" not found`, error: 'Not found' };
      return { success: true, message: `Retrieved feature: ${feature.name}`, result: JSON.stringify(feature, null, 2) };
    });
  }
}

// ── Tool: GetFeatureDataFlow (graph) ──────────────────────────────────────────

export class GetFeatureDataFlowTool extends GraphBaseTool<GetFeatureParams> {
  name = 'get_feature_data_flow';
  category = SecurityReviewCategory;
  description =
    'Get the data flow diagram for a business feature as an interactive graph. Shows actors, processes, data stores, and flows — including trust boundaries, encryption status, and auth requirements.';
  parameters: ToolParameter[] = [
    { name: 'featureId', description: 'The ID of the business feature', required: true, type: 'string' },
  ];

  constructor(
    private readonly svc: FeatureService,
    private readonly tenantId: string
  ) { super(); }

  async execute(p: GetFeatureParams): Promise<GraphToolResult> {
    return safeGraph(async () => {
      const id = san(p.featureId);
      if (!id) return { success: false, message: 'featureId is required', error: 'Missing parameter', graph: EMPTY_GRAPH };
      if (!/^[0-9a-f-]{32,40}$/.test(id)) return { success: false, message: 'Invalid featureId format', error: 'Validation error', graph: EMPTY_GRAPH };
      const feature = await this.svc.getFeatureById(this.tenantId, id);
      if (!feature) return { success: false, message: `Feature "${id}" not found`, error: 'Not found', graph: EMPTY_GRAPH };
      const dfd = feature.dataFlowDiagram;
      if (!dfd) return { success: false, message: `Feature "${feature.name}" has no data flow diagram`, error: 'No DFD', graph: EMPTY_GRAPH };

      const nodeCount = (dfd.actors?.length ?? 0) + (dfd.processes?.length ?? 0) + (dfd.dataStores?.length ?? 0);
      const flowCount = dfd.flows?.length ?? 0;

      // Return the raw DFD so the UI can render it with FeatureDiagram (full fidelity).
      // The nodes/edges arrays are left empty — the UI ignores them when graphType === 'dfd'.
      const graph: GraphProjection = {
        nodes: [],
        edges: [],
        explanation: `Data flow diagram for: ${feature.name}`,
        graphType: 'dfd',
        dfd: {
          actors:         dfd.actors         ?? [],
          processes:      dfd.processes       ?? [],
          dataStores:     dfd.dataStores      ?? [],
          flows:          dfd.flows           ?? [],
          trustBoundaries: dfd.trustBoundaries ?? [],
          featureName:    feature.name,
        },
      };

      return {
        success: true,
        message: `Data flow for "${feature.name}": ${nodeCount} nodes, ${flowCount} flows`,
        result: JSON.stringify({ featureName: feature.name, nodeCount, flowCount, trustBoundaries: dfd.trustBoundaries ?? [] }, null, 2),
        graph,
      };
    });
  }
}

// ── Tool: GetFeatureRelationships (graph) ──────────────────────────────────────

interface GetFeatureRelationshipsParams extends Record<string, unknown> {
  featureId?: string;
  featureName?: string;
}

export class GetFeatureRelationshipsTool extends GraphBaseTool<GetFeatureRelationshipsParams> {
  name = 'get_feature_relationships';
  category = SecurityReviewCategory;
  description =
    "Show cross-feature relationships for a business feature. Finds other features that share the same source services. Provide either featureId or featureName.";
  parameters: ToolParameter[] = [
    { name: 'featureId', description: 'ID of the feature (optional if featureName given)', required: false, type: 'string' },
    { name: 'featureName', description: 'Name of the feature to search for (optional if featureId given)', required: false, type: 'string' },
  ];

  constructor(
    private readonly svc: FeatureService,
    private readonly tenantId: string
  ) { super(); }

  async execute(p: GetFeatureRelationshipsParams): Promise<GraphToolResult> {
    return safeGraph(async () => {
      const idRaw = san(p.featureId);
      const nameRaw = san(p.featureName);
      let targetFeature: any = null;

      if (idRaw) {
        if (!/^[0-9a-f-]{32,40}$/.test(idRaw)) return { success: false, message: 'Invalid featureId format', error: 'Validation error', graph: EMPTY_GRAPH };
        targetFeature = await this.svc.getFeatureById(this.tenantId, idRaw);
      } else if (nameRaw) {
        const all = await this.svc.getFeaturesByTenant(this.tenantId);
        const matched = all.find((f: any) => f.name.toLowerCase().includes(nameRaw.toLowerCase()));
        if (matched) targetFeature = await this.svc.getFeatureById(this.tenantId, matched.id);
      }

      if (!targetFeature) return { success: false, message: 'No feature found matching the provided id/name', error: 'Not found', graph: EMPTY_GRAPH };

      const allSummaries = await this.svc.getFeaturesByTenant(this.tenantId);
      const sharedServices: string[] = targetFeature.sourceServiceIds ?? [];
      const related = allSummaries.filter((f: any) =>
        f.id !== targetFeature.id && f.sourceServiceIds?.some((s: string) => sharedServices.includes(s))
      );

      const riskScore = (f: any): number => f.overallRiskScore ?? f.threatModel?.overallRiskScore ?? 0;
      const riskSev = (score: number): 'high' | 'medium' | 'low' => score > 70 ? 'high' : score > 40 ? 'medium' : 'low';

      const nodes: GraphNode[] = [
        {
          id: targetFeature.id, type: 'CodeService', label: targetFeature.name,
          severity: riskSev(riskScore(targetFeature)),
          metadata: { riskScore: riskScore(targetFeature), isFocus: true },
        },
        ...related.map((f: any): GraphNode => ({
          id: f.id, type: 'CodeService', label: f.name,
          severity: riskSev(riskScore(f)),
          metadata: { riskScore: riskScore(f) },
        })),
      ];

      const edges: GraphEdge[] = related.map((f: any, i: number): GraphEdge => ({
        id: `rel-${i}`, from: targetFeature.id, to: f.id,
        type: 'USES', confidence: 'heuristic', label: 'Shared service',
      }));

      const graph: GraphProjection = {
        nodes, edges,
        focusNodeId: targetFeature.id,
        explanation: `Feature relationships for: ${targetFeature.name}`,
      };

      return {
        success: true,
        message: `Found ${related.length} related feature(s) sharing services with "${targetFeature.name}"`,
        result: JSON.stringify({ feature: targetFeature.name, sharedServices, relatedFeatureCount: related.length }, null, 2),
        graph,
      };
    });
  }
}

// ── Tool: GetServiceDataFlow (graph) ──────────────────────────────────────────

interface GetServiceParams extends Record<string, unknown> {
  serviceId: string;
}

export class GetServiceDataFlowTool extends GraphBaseTool<GetServiceParams> {
  name = 'get_service_data_flow';
  category = SecurityReviewCategory;
  description =
    'Get the merged data flow diagram (DFD) for a service as an interactive graph. ' +
    'Shows all actors, processes, data stores, and flows across the service, aggregated from all its features. ' +
    'Use semantic_search_services to find the serviceId first.';
  parameters: ToolParameter[] = [
    { name: 'serviceId', description: 'The ID of the service (code_service entity)', required: true, type: 'string' },
  ];

  constructor(
    private readonly assetSvc: AssetService,
    private readonly tenantId: string
  ) { super(); }

  async execute(p: GetServiceParams): Promise<GraphToolResult> {
    return safeGraph(async () => {
      const id = san(p.serviceId);
      if (!id) return { success: false, message: 'serviceId is required', error: 'Missing parameter', graph: EMPTY_GRAPH };

      const asset = await this.assetSvc.getAssetById(this.tenantId, id);
      if (!asset) return { success: false, message: `Service "${id}" not found`, error: 'Not found', graph: EMPTY_GRAPH };

      const serviceDfd = (asset.fullEntity as any).serviceDfd ?? asset.serviceDfd;
      if (!serviceDfd?.dataFlowDiagram) {
        return {
          success: false,
          message: `Service "${asset.name ?? id}" has no merged DFD yet. Run a scan with Feature Extraction enabled.`,
          error: 'No DFD',
          graph: EMPTY_GRAPH,
        };
      }

      const dfd = serviceDfd.dataFlowDiagram;
      const nodeCount = (dfd.actors?.length ?? 0) + (dfd.processes?.length ?? 0) + (dfd.dataStores?.length ?? 0);
      const flowCount = dfd.flows?.length ?? 0;

      const graph: GraphProjection = {
        nodes: [],
        edges: [],
        explanation: `Service DFD for: ${asset.name ?? id}`,
        graphType: 'dfd',
        dfd: {
          actors:          dfd.actors          ?? [],
          processes:       dfd.processes        ?? [],
          dataStores:      dfd.dataStores       ?? [],
          flows:           dfd.flows            ?? [],
          trustBoundaries: dfd.trustBoundaries  ?? [],
          featureName:     asset.name ?? id,
        },
      };

      return {
        success: true,
        message: `Service DFD for "${asset.name ?? id}": ${nodeCount} nodes, ${flowCount} flows. Features covered: ${(serviceDfd.featuresCovered ?? []).join(', ')}`,
        result: JSON.stringify({ serviceName: asset.name, nodeCount, flowCount, featuresCovered: serviceDfd.featuresCovered ?? [] }, null, 2),
        graph,
      };
    });
  }
}

// ── Tool: GetServiceRelationships (graph) ─────────────────────────────────────

export class GetServiceRelationshipsTool extends GraphBaseTool<GetServiceParams> {
  name = 'get_service_relationships';
  category = SecurityReviewCategory;
  description =
    'Show the entity relationship graph for a service: what it depends on, what depends on it, ' +
    'cloud resources, identities, and data stores. Use semantic_search_services to find the serviceId first.';
  parameters: ToolParameter[] = [
    { name: 'serviceId', description: 'The ID of the service (code_service entity)', required: true, type: 'string' },
  ];

  constructor(
    private readonly assetSvc: AssetService,
    private readonly tenantId: string
  ) { super(); }

  async execute(p: GetServiceParams): Promise<GraphToolResult> {
    return safeGraph(async () => {
      const id = san(p.serviceId);
      if (!id) return { success: false, message: 'serviceId is required', error: 'Missing parameter', graph: EMPTY_GRAPH };

      const relGraph = await this.assetSvc.getAssetRelationships(this.tenantId, id);

      if (relGraph.graph) {
        // Full graph projection already built by SecurityQueryTools
        return {
          success: true,
          message: `Relationship graph for service "${id}": ${relGraph.graph.nodes.length} nodes, ${relGraph.graph.edges.length} edges`,
          result: JSON.stringify({ nodeCount: relGraph.graph.nodes.length, edgeCount: relGraph.graph.edges.length }, null, 2),
          graph: relGraph.graph,
        };
      }

      if (relGraph.nodes.length === 0) {
        return {
          success: false,
          message: `No relationship data found for service "${id}". Make sure Neo4j is configured and a scan has been run.`,
          error: 'No data',
          graph: EMPTY_GRAPH,
        };
      }

      // Fallback: build a GraphProjection from the raw nodes/edges
      const nodes: GraphNode[] = relGraph.nodes.map(n => ({
        id: n.id,
        type: (n.type as any) ?? 'CodeService',
        label: n.name,
        metadata: n.metadata,
      }));
      const edges: GraphEdge[] = relGraph.edges.map(e => ({
        id: e.id,
        from: e.source,
        to: e.target,
        type: (e.type as any) ?? 'DEPENDS_ON',
        confidence: (e.metadata?.confidence as any) ?? 'heuristic',
        label: e.metadata?.label,
      }));

      const graph: GraphProjection = {
        nodes,
        edges,
        focusNodeId: id,
        explanation: `Entity relationships for service: ${id}`,
      };

      return {
        success: true,
        message: `Relationship graph for service "${id}": ${nodes.length} nodes, ${edges.length} edges`,
        result: JSON.stringify({ nodeCount: nodes.length, edgeCount: edges.length }, null, 2),
        graph,
      };
    });
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createSecurityChatTools(
  reviewService: SecurityReviewService,
  featureService: FeatureService,
  tenantId: string,
  assetService?: AssetService
) {
  const tools: (BaseTool<any> | GraphBaseTool<any>)[] = [
    new ListSecurityReviewsTool(reviewService, tenantId),
    new GetSecurityReviewTool(reviewService, tenantId),
    new GetSecurityReviewSummaryTool(reviewService, tenantId),
    new ListBusinessFeaturesTool(featureService, tenantId),
    new GetBusinessFeatureTool(featureService, tenantId),
    new GetFeatureDataFlowTool(featureService, tenantId),
    new GetFeatureRelationshipsTool(featureService, tenantId),
  ];
  if (assetService) {
    tools.push(
      new GetServiceDataFlowTool(assetService, tenantId),
      new GetServiceRelationshipsTool(assetService, tenantId),
    );
  }
  return tools;
}
