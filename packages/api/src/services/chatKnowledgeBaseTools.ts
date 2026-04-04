/**
 * Chat Knowledge Base Tools
 *
 * Semantic-search and filtered-query tools for the chat assistant.
 * Three tools are provided:
 *
 *  1. semantic_search_services
 *     Vector search over indexed service responsibility descriptions.
 *     Uses documentType='service' so only service documents are searched.
 *
 *  2. semantic_search_features
 *     Vector search over indexed feature documents (businessValue, description,
 *     userStories, dataFlow, dataClassification).
 *     Uses documentType='feature' so only feature documents are searched.
 *
 *  3. filter_security_reviews
 *     Server-side filtered query for Security Reviews.
 *     Accepts structured filter criteria (status, services, dateRange, minRiskScore).
 *     Filtering is done in Qdrant — the LLM never receives a full dump to filter itself.
 *
 * Security controls:
 *  - All freeform string inputs are trimmed and length-capped via san().
 *  - Numeric inputs are clamped to valid ranges.
 *  - Date inputs are validated as ISO-8601 strings.
 *  - All errors are caught by safe()/safeGraph(); only generic messages reach the caller.
 *  - Read-only: no writes to any store.
 *  - Tenant isolation enforced by QdrantAdapter (tenantId injected server-side).
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
import type { GraphProjection, TableProjection, TableColumn } from '@ai-agent/core';
import type { FeatureService } from '@ai-agent/shared';
import type { SecurityReviewService } from '@ai-agent/shared';
import type { QdrantAdapter } from '@ai-agent/shared';

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_PARAM_LEN = 500;

// ── Category ──────────────────────────────────────────────────────────────────

export const KnowledgeBaseCategory: ToolCategory = {
  name: 'knowledge_base',
  description: 'Semantic search and filtered queries across indexed services, features, and security reviews',
  keywords: [
    'search', 'service', 'responsibility', 'feature', 'data flow', 'security review',
    'business value', 'user stories', 'data classification', 'filter', 'query',
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function san(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value).trim().slice(0, MAX_PARAM_LEN);
}

/** Validate and return an ISO-8601 date string, or undefined if invalid. */
function sanDate(value: unknown): string | undefined {
  const s = san(value);
  if (!s) return undefined;
  const d = new Date(s);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/** Clamp a numeric value to [min, max]. Returns defaultValue when not a valid number. */
function clampInt(value: unknown, min: number, max: number, defaultValue: number): number {
  const n = Number(value);
  if (!isFinite(n)) return defaultValue;
  return Math.max(min, Math.min(max, Math.round(n)));
}

async function safe(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err: any) {
    console.error('[ChatKnowledgeBaseTool]', err?.message ?? err);
    return { success: false, message: 'An internal error occurred', error: 'Internal error' };
  }
}

const EMPTY_GRAPH: GraphProjection = { nodes: [], edges: [] };

async function safeGraph(fn: () => Promise<GraphToolResult>): Promise<GraphToolResult> {
  try {
    return await fn();
  } catch (err: any) {
    console.error('[ChatKnowledgeBaseTool] graph', err?.message ?? err);
    return { success: false, message: 'An internal error occurred', error: 'Internal error', graph: EMPTY_GRAPH };
  }
}


// ── Tool 0: GetFeatureGraphTool ────────────────────────────────────────────────

interface GetFeatureGraphParams extends Record<string, unknown> {
  featureId?: string;
  featureName?: string;
}

/**
 * Fetch a feature by ID or name and return it with its DFD as a renderable graph.
 *
 * Designed to be called directly after semantic_search_features when the user
 * wants to visualise a feature's data flow diagram without an additional tool hop.
 *
 * Returns:
 *  - `result` – feature metadata (name, description, businessValue, riskScore, etc.)
 *  - `graph`  – graphType='dfd' projection ready for the FeatureDiagram renderer
 */
export class GetFeatureGraphTool extends GraphBaseTool<GetFeatureGraphParams> {
  name = 'get_feature_graph';
  category = KnowledgeBaseCategory;
  description =
    'Fetch a business feature by ID or name and return it together with its Data Flow Diagram ' +
    'as an interactive graph. Use this after semantic_search_features when you need to show the ' +
    'DFD visually. Provide featureId (preferred, from search results) or featureName for a fuzzy lookup.';
  parameters: ToolParameter[] = [
    {
      name: 'featureId',
      description: 'The ID of the business feature (36-char hex, from semantic_search_features results)',
      required: false,
      type: 'string',
    },
    {
      name: 'featureName',
      description: 'Name of the feature for fuzzy lookup when you do not have the ID',
      required: false,
      type: 'string',
    },
  ];

  constructor(
    private readonly featureService: FeatureService,
    private readonly tenantId: string
  ) {
    super();
  }

  async execute(p: GetFeatureGraphParams): Promise<GraphToolResult> {
    return safeGraph(async () => {
      const idRaw   = san(p.featureId);
      const nameRaw = san(p.featureName);

      if (!idRaw && !nameRaw) {
        return { success: false, message: 'featureId or featureName is required', error: 'Missing parameter', graph: EMPTY_GRAPH };
      }

      let feature: Awaited<ReturnType<FeatureService['getFeatureById']>> = null;
      let riskScore = 0;
      let complianceConsiderations: string[] = [];

      if (idRaw) {
        if (!/^[0-9a-f-]{32,40}$/.test(idRaw)) {
          return { success: false, message: 'Invalid featureId format', error: 'Validation error', graph: EMPTY_GRAPH };
        }
        feature = await this.featureService.getFeatureById(this.tenantId, idRaw);
        // Pull summary fields (non-deprecated) from the summary list
        const summaries = await this.featureService.getFeaturesByTenant(this.tenantId);
        const summary = summaries.find(s => s.id === idRaw);
        riskScore = summary?.overallRiskScore ?? 0;
        complianceConsiderations = summary?.complianceConsiderations ?? [];
      } else if (nameRaw) {
        const all = await this.featureService.getFeaturesByTenant(this.tenantId);
        const matched = all.find(f => f.name.toLowerCase().includes(nameRaw.toLowerCase()));
        if (matched) {
          feature = await this.featureService.getFeatureById(this.tenantId, matched.id);
          riskScore = matched.overallRiskScore ?? 0;
          complianceConsiderations = matched.complianceConsiderations ?? [];
        }
      }

      if (!feature) {
        return { success: false, message: 'No feature found matching the provided id/name', error: 'Not found', graph: EMPTY_GRAPH };
      }

      const dfd = feature.dataFlowDiagram;
      const nodeCount = (dfd?.actors?.length ?? 0) + (dfd?.processes?.length ?? 0) + (dfd?.dataStores?.length ?? 0);
      const flowCount  = dfd?.flows?.length ?? 0;

      const graph: GraphProjection = {
        nodes: [],
        edges: [],
        explanation: `Data flow diagram for: ${feature.name}`,
        graphType: 'dfd',
        dfd: dfd ? {
          actors:          dfd.actors          ?? [],
          processes:       dfd.processes        ?? [],
          dataStores:      dfd.dataStores       ?? [],
          flows:           dfd.flows            ?? [],
          trustBoundaries: dfd.trustBoundaries  ?? [],
          featureName:     feature.name,
        } : undefined,
      };

      return {
        success: true,
        message: `Feature "${feature.name}": ${nodeCount} DFD nodes, ${flowCount} flows`,
        result: JSON.stringify({
          featureId:               feature.id,
          featureName:             feature.name,
          description:             feature.description,
          businessValue:           feature.businessValue,
          sourceServiceIds:        feature.sourceServiceIds,
          riskScore,
          complianceConsiderations,
          dfdNodeCount:            nodeCount,
          dfdFlowCount:            flowCount,
          trustBoundaries:         dfd?.trustBoundaries ?? [],
        }, null, 2),
        graph,
      };
    });
  }
}

// ── Tool 1: SemanticSearchServicesTool ────────────────────────────────────────

interface SearchServicesParams extends Record<string, unknown> {
  query: string;
  limit?: number;
}

/**
 * Semantic search over indexed service responsibility descriptions.
 * Returns a TableProjection so the UI can render services as a clickable table.
 *
 * Use this tool when the user asks questions like:
 *  - "Which service handles authentication?"
 *  - "What service is responsible for payment processing?"
 *  - "Find services that deal with notifications"
 */
export class SemanticSearchServicesTool extends TableBaseTool<SearchServicesParams> {
  name = 'semantic_search_services';
  category = KnowledgeBaseCategory;
  description =
    'Semantically search for services by their responsibility — e.g., "which service handles authentication?" ' +
    'or "find services that process payments". Returns a clickable table of service summaries with relevance scores. ' +
    'To present a service graph use the get_relationship_graph with the entity Id returned from the semantic search.';
  parameters: ToolParameter[] = [
    {
      name: 'query',
      description: 'Natural-language description of what you are looking for, e.g. "service that handles user authentication"',
      required: true,
      type: 'string',
    },
    {
      name: 'limit',
      description: 'Maximum number of results to return (1–20, default 8)',
      required: false,
      type: 'number',
    },
  ];

  constructor(
    private readonly qdrant: QdrantAdapter,
    private readonly tenantId: string
  ) {
    super();
  }

  async execute(p: SearchServicesParams): Promise<TableToolResult> {
    try {
      const query = san(p.query);
      if (!query) return this.tableError('query is required', 'Missing parameter');

      const limit = clampInt(p.limit, 1, 20, 8);

      const results = await this.qdrant.searchSemanticDocumentsByType(
        this.tenantId,
        query,
        'service',
        limit
      );

      const serviceColumns: TableColumn[] = [
        { key: 'serviceName',    label: 'Service',       renderHint: 'text' },
        { key: 'serviceType',    label: 'Type',          renderHint: 'badge' },
        { key: 'responsibility', label: 'Responsibility', renderHint: 'text' },
        { key: 'relevance',      label: 'Relevance %',   renderHint: 'badge' },
      ];

      if (results.length === 0) {
        const table: TableProjection = {
          entityType: 'service',
          title: `Services matching "${query}"`,
          columns: serviceColumns,
          rows: [],
          explanation: 'No matching services found. Make sure services have been indexed (run a scan first).',
          totalCount: 0,
        };
        return { success: true, message: 'No matching services found.', table };
      }

      const rows = results.map(r => ({
        id: r.document.artifactId ?? r.document.id,
        columns: {
          serviceName:    r.document.metadata?.['serviceName'] ?? 'Unknown',
          serviceType:    r.document.metadata?.['serviceType'] ?? 'unknown',
          responsibility: r.document.responsibility ?? '',
          relevance:      Math.round(r.score * 100),
        },
        metadata: {
          entityId:    r.document.id,
          artifactId:  r.document.artifactId,
          serviceType: r.document.metadata?.['serviceType'] ?? 'unknown',
          relevanceScore: r.score,
        },
      }));

      const table: TableProjection = {
        entityType: 'service',
        title: `Services matching "${query}"`,
        columns: serviceColumns,
        rows,
        explanation: `Found ${rows.length} service(s) matching "${query}"`,
        totalCount: rows.length,
      };

      return {
        success: true,
        message: `Found ${rows.length} service(s) matching "${query}"`,
        result: JSON.stringify(rows.map(r => ({ serviceId: r.id, serviceName: r.columns.serviceName, serviceType: r.columns.serviceType })), null, 2),
        table,
      };
    } catch (err: any) {
      console.error('[SemanticSearchServicesTool]', err?.message ?? err);
      return this.tableError('An internal error occurred', 'Internal error');
    }
  }
}

// ── Tool 2: SemanticSearchFeaturesTool ────────────────────────────────────────

interface SearchFeaturesParams extends Record<string, unknown> {
  query: string;
  limit?: number;
}

/**
 * Semantic search over indexed business features.
 * Returns a TableProjection of matched features so the chat UI can render them
 * as a professional clickable table (same look & feel as the Features page).
 *
 * Use get_feature_graph when the user explicitly asks for a DFD visualisation.
 */
export class SemanticSearchFeaturesTool extends TableBaseTool<SearchFeaturesParams> {
  name = 'semantic_search_features';
  category = KnowledgeBaseCategory;
  description =
    'Semantically search for business features by their purpose, data flows, or data classification. ' +
    'E.g., "features that process payment data", "authentication flows", "features handling PII". ' +
    'Returns a clickable table of ranked feature summaries. ' +
    'To view the DFD of a specific feature, call get_feature_graph with the featureId from the results.';
  parameters: ToolParameter[] = [
    {
      name: 'query',
      description: 'Natural-language description of the feature or flow you are looking for',
      required: true,
      type: 'string',
    },
    {
      name: 'limit',
      description: 'Maximum number of results to return (1–20, default 8)',
      required: false,
      type: 'number',
    },
  ];

  constructor(
    private readonly featureService: FeatureService,
    private readonly tenantId: string
  ) {
    super();
  }

  async execute(p: SearchFeaturesParams): Promise<TableToolResult> {
    try {
      const query = san(p.query);
      if (!query) {
        return this.tableError('query is required', 'Missing parameter');
      }

      const limit = clampInt(p.limit, 1, 20, 8);

      const results = await this.featureService.searchFeaturesSemantic(
        this.tenantId,
        query,
        limit
      );

      if (results.length === 0) {
        const table: TableProjection = {
          entityType: 'feature',
          title: `Features matching "${query}"`,
          columns: FEATURE_COLUMNS,
          rows: [],
          explanation: 'No matching features found. Make sure features have been indexed (run a scan with Feature Extraction enabled).',
          totalCount: 0,
        };
        return { success: true, message: 'No matching features found.', table };
      }

      const rows = results.map(r => {
        const strideThreats = r.feature.threatModel?.strideThreats ?? [];
        const highestSeverity = strideThreats.length > 0
          ? (['critical', 'high', 'medium', 'low'] as const).find(
              s => strideThreats.some((t: any) => t.severity === s)
            ) ?? null
          : null;
        return {
          id: r.feature.id,
          columns: {
            name:        r.feature.name,
            description: r.feature.description ?? '',
            riskScore:   r.feature.threatModel?.overallRiskScore ?? 0,
            severity:    highestSeverity,
            threats:     strideThreats.length,
            compliance:  (r.feature.threatModel?.complianceConsiderations ?? []).join(', '),
            relevance:   Math.round(r.score * 100),
          },
          metadata: {
            riskScore:               r.feature.threatModel?.overallRiskScore ?? 0,
            highestSeverity,
            threatCount:             strideThreats.length,
            complianceConsiderations: r.feature.threatModel?.complianceConsiderations ?? [],
            relevanceScore:          r.score,
            sourceServiceIds:        r.feature.sourceServiceIds ?? [],
          },
        };
      });

      const table: TableProjection = {
        entityType: 'feature',
        title: `Features matching "${query}"`,
        columns: FEATURE_COLUMNS,
        rows,
        explanation: `Found ${results.length} feature(s) matching "${query}"`,
        totalCount: results.length,
      };

      return {
        success: true,
        message: `Found ${results.length} feature(s) matching "${query}"`,
        result: JSON.stringify(rows.map(r => ({ featureId: r.id, featureName: r.columns.name, riskScore: r.columns.riskScore, severity: r.columns.severity })), null, 2),
        table,
      };
    } catch (err: any) {
      console.error('[SemanticSearchFeaturesTool]', err?.message ?? err);
      return this.tableError('An internal error occurred', 'Internal error');
    }
  }
}

const FEATURE_COLUMNS: TableColumn[] = [
  { key: 'name',        label: 'Feature',     renderHint: 'text' },
  { key: 'description', label: 'Description', renderHint: 'text' },
  { key: 'riskScore',   label: 'Risk Score',  renderHint: 'risk_score' },
  { key: 'severity',    label: 'Severity',    renderHint: 'severity' },
  { key: 'threats',     label: 'Threats',     renderHint: 'badge' },
  { key: 'compliance',  label: 'Compliance',  renderHint: 'compliance' },
  { key: 'relevance',   label: 'Relevance %', renderHint: 'badge' },
];

// ── Tool 3: FilterSecurityReviewsTool ─────────────────────────────────────────

interface FilterReviewsParams extends Record<string, unknown> {
  /** Filter by status */
  status?: string;
  /** Filter by service name (substring match) */
  service?: string;
  /** Only return reviews created after this ISO-8601 date */
  createdAfter?: string;
  /** Only return reviews created before this ISO-8601 date */
  createdBefore?: string;
  /** Only return reviews where any task has severity >= this level */
  minTaskSeverity?: string;
  /** Maximum results to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

const VALID_STATUSES = new Set([
  'questionnaire_pending',
  'questionnaire_answered',
  'tasks_acknowledged',
  'attested',
]);

const SEVERITY_ORDER: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Filtered query for Security Reviews.
 * All filtering is performed server-side (Qdrant payload filters) or in this
 * service layer — the LLM never receives a full dataset to filter itself.
 *
 * Available filters:
 *  - status         (exact match)
 *  - service        (substring match against review.services array)
 *  - createdAfter   (ISO-8601)
 *  - createdBefore  (ISO-8601)
 *  - minTaskSeverity (low | medium | high | critical)
 *  - limit / offset (pagination)
 */
export class FilterSecurityReviewsTool extends TableBaseTool<FilterReviewsParams> {
  name = 'filter_security_reviews';
  category = KnowledgeBaseCategory;
  description =
    'Query security reviews with server-side filters. ' +
    'Available filters: status (questionnaire_pending|questionnaire_answered|tasks_acknowledged|attested), ' +
    'service (substring match), createdAfter / createdBefore (ISO-8601 dates), ' +
    'minTaskSeverity (low|medium|high|critical). ' +
    'Returns summary fields for matching reviews — use get_security_review for full details.';
  parameters: ToolParameter[] = [
    {
      name: 'status',
      description: 'Filter by review status: questionnaire_pending | questionnaire_answered | tasks_acknowledged | attested',
      required: false,
      type: 'string',
    },
    {
      name: 'service',
      description: 'Filter reviews that involve a service containing this substring (case-insensitive)',
      required: false,
      type: 'string',
    },
    {
      name: 'createdAfter',
      description: 'ISO-8601 date — return reviews created after this date',
      required: false,
      type: 'string',
    },
    {
      name: 'createdBefore',
      description: 'ISO-8601 date — return reviews created before this date',
      required: false,
      type: 'string',
    },
    {
      name: 'minTaskSeverity',
      description: 'Only return reviews that have at least one task with this severity or higher (low|medium|high|critical)',
      required: false,
      type: 'string',
    },
    {
      name: 'limit',
      description: 'Maximum reviews to return (1–100, default 10)',
      required: false,
      type: 'number',
    },
    {
      name: 'offset',
      description: 'Pagination offset (default 0)',
      required: false,
      type: 'number',
    },
  ];

  constructor(
    private readonly svc: SecurityReviewService,
    private readonly tenantId: string
  ) {
    super();
  }

  async execute(p: FilterReviewsParams): Promise<TableToolResult> {
    try {
      // ── Validate inputs ────────────────────────────────────────────────────
      const statusFilter = san(p.status);
      if (statusFilter && !VALID_STATUSES.has(statusFilter)) {
        return this.tableError(
          `Invalid status "${statusFilter}". Must be one of: ${[...VALID_STATUSES].join(', ')}`,
          'Validation error'
        );
      }

      const serviceFilter = san(p.service)?.toLowerCase();
      const createdAfter = sanDate(p.createdAfter);
      const createdBefore = sanDate(p.createdBefore);

      const minSeverityRaw = san(p.minTaskSeverity)?.toLowerCase();
      const minSeverityLevel = minSeverityRaw ? SEVERITY_ORDER[minSeverityRaw] ?? 0 : 0;

      const limit = clampInt(p.limit, 1, 100, 10);
      const offset = clampInt(p.offset, 0, 100_000, 0);

      // ── Fetch all reviews for this tenant (filtered by tenantId in the repo) ─
      const all = await this.svc.listReviews(this.tenantId);

      // ── Apply filters in this service layer ────────────────────────────────
      let filtered = all as any[];

      if (statusFilter) {
        filtered = filtered.filter(r => r.status === statusFilter);
      }
      if (serviceFilter) {
        filtered = filtered.filter(r =>
          Array.isArray(r.services) &&
          r.services.some((s: string) => s.toLowerCase().includes(serviceFilter))
        );
      }
      if (createdAfter) {
        const afterTs = new Date(createdAfter).getTime();
        filtered = filtered.filter(r => new Date(r.createdAt).getTime() > afterTs);
      }
      if (createdBefore) {
        const beforeTs = new Date(createdBefore).getTime();
        filtered = filtered.filter(r => new Date(r.createdAt).getTime() < beforeTs);
      }
      if (minSeverityLevel > 0) {
        filtered = filtered.filter(r =>
          Array.isArray(r.tasks) &&
          r.tasks.some((t: any) => (SEVERITY_ORDER[t.severity] ?? 0) >= minSeverityLevel)
        );
      }

      // ── Sort by most recently updated ──────────────────────────────────────
      filtered.sort(
        (a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime()
      );

      const total = filtered.length;
      const page = filtered.slice(offset, offset + limit);

      const filterDesc = [
        statusFilter ? `status="${statusFilter}"` : '',
        serviceFilter ? `service contains "${serviceFilter}"` : '',
        createdAfter ? `after ${createdAfter}` : '',
        createdBefore ? `before ${createdBefore}` : '',
        minSeverityRaw ? `minSeverity=${minSeverityRaw}` : '',
      ].filter(Boolean).join(', ');

      const reviewColumns: TableColumn[] = [
        { key: 'featureDescription', label: 'Feature',     renderHint: 'text' },
        { key: 'agentName',          label: 'Changed By',  renderHint: 'text' },
        { key: 'services',           label: 'Services',    renderHint: 'tags' },
        { key: 'status',             label: 'Status',      renderHint: 'status' },
        { key: 'tasks',              label: 'Tasks',       renderHint: 'badge' },
        { key: 'compliance',         label: 'Compliance',  renderHint: 'badge' },
        { key: 'createdAt',          label: 'Created',     renderHint: 'date' },
      ];

      const rows = page.map((r: any) => {
        const criticalCount = r.tasks?.filter((t: any) => t.severity === 'critical').length ?? 0;
        const totalTasks = r.tasks?.length ?? 0;
        const attestedCount = r.attestations?.filter((a: any) => a.handled).length ?? 0;
        const compliancePct = r.status === 'attested' && totalTasks > 0
          ? Math.round((attestedCount / totalTasks) * 100)
          : null;

        return {
          id: r.id,
          columns: {
            featureDescription: r.featureDescription ?? '',
            agentName:          r.agentName ?? '',
            services:           (r.services ?? []).join(', '),
            status:             r.status,
            tasks:              totalTasks,
            compliance:         compliancePct !== null ? compliancePct : -1,
            createdAt:          r.createdAt,
          },
          metadata: {
            status:             r.status,
            taskCount:          totalTasks,
            criticalTaskCount:  criticalCount,
            highTaskCount:      r.tasks?.filter((t: any) => t.severity === 'high').length ?? 0,
            attestationCount:   r.attestations?.length ?? 0,
            compliancePct,
            services:           r.services ?? [],
            agentName:          r.agentName,
            linkedFeatureIds:   r.linkedFeatureIds ?? [],
            matchedFeatures:    r.matchedFeatures ?? [],
            updatedAt:          r.updatedAt,
          },
        };
      });

      const table: TableProjection = {
        entityType: 'security_review',
        title: filterDesc ? `Security Reviews — ${filterDesc}` : 'Security Reviews',
        columns: reviewColumns,
        rows,
        explanation: `Found ${total} review(s)${filterDesc ? ` matching: ${filterDesc}` : ''}. Showing ${page.length}${offset > 0 ? ` (offset ${offset})` : ''}.`,
        totalCount: total,
      };

      return {
        success: true,
        message: `Found ${total} review(s)${filterDesc ? ` matching: ${filterDesc}` : ''}. Showing ${page.length} (offset=${offset}).`,
        result: JSON.stringify({ total, offset, limit }, null, 2),
        table,
      };
    } catch (err: any) {
      console.error('[FilterSecurityReviewsTool]', err?.message ?? err);
      return this.tableError('An internal error occurred', 'Internal error');
    }
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createKnowledgeBaseChatTools(
  qdrant: QdrantAdapter,
  featureService: FeatureService,
  securityReviewService: SecurityReviewService,
  tenantId: string
) {
  return [
    new GetFeatureGraphTool(featureService, tenantId),
    new SemanticSearchServicesTool(qdrant, tenantId),
    new SemanticSearchFeaturesTool(featureService, tenantId),
    new FilterSecurityReviewsTool(securityReviewService, tenantId),
  ];
}
