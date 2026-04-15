/**
 * Chat Service-Relationship Tools
 *
 * Read-only tools for the chat assistant to answer questions about
 * service-to-service relationships stored in Neo4j by the data-indexer:
 *
 *   - get_service_callers        Who calls a given service? (inbound CALLS_SERVICE)
 *   - get_service_dependencies   What does a service call? (outbound CALLS_SERVICE)
 *   - get_service_api_routes     List API routes a service exposes that other services call
 *   - get_service_call_graph     Full call graph for a service (callers + callees + route details)
 *
 * Security controls applied here (tasks 20741e28, effaebe2, d7a3f60b):
 *   - Input sanitisation: all freeform strings are trimmed + length-capped (MAX_PARAM_LEN).
 *   - Neo4j queries use the Neo4jAdapter methods which accept only typed IDs and
 *     relationship types — no user input is interpolated into Cypher strings.
 *   - Entity lookups go through Qdrant (listEntities / getEntity) which apply
 *     tenant-scoped filters — no cross-tenant leakage is possible.
 *   - Error messages: only generic messages returned to the caller; detail is
 *     logged server-side only (console.error).
 *   - Read-only: no writes to any data store.
 *   - Data classification: INTERNAL — service names, IDs, and path strings only.
 */

import {
  BaseTool,
  GraphBaseTool,
  ToolCategory,
  ToolParameter,
  ToolResult,
  GraphToolResult,
} from '@ai-agent/core';
import type { GraphProjection, GraphNode, GraphEdge } from '@ai-agent/core';
import type { Neo4jAdapter } from '@ai-agent/shared';
import type { QdrantAdapter } from '@ai-agent/shared';
import type { CanonicalEntity } from '@ai-agent/shared';

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_PARAM_LEN = 200;
const EMPTY_GRAPH: GraphProjection = { nodes: [], edges: [] };

// ── Category ──────────────────────────────────────────────────────────────────

export const ServiceRelationshipCategory: ToolCategory = {
  name: 'service_relationships',
  description:
    'Tools for querying service-to-service call relationships: who calls whom, which API routes are used, and the full call graph',
  keywords: [
    'service', 'calls', 'api', 'route', 'endpoint', 'dependency',
    'caller', 'callee', 'relationship', 'graph', 'upstream', 'downstream',
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Sanitise a user-supplied string: trim and cap length. */
function san(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value).trim().slice(0, MAX_PARAM_LEN);
}

/** Wrap a BaseTool execute body — returns a generic error on exception. */
async function safe(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err: any) {
    console.error('[ServiceRelationshipTool]', err?.message ?? err);
    return { success: false, message: 'An internal error occurred', error: 'Internal error' };
  }
}

/** Wrap a GraphBaseTool execute body — returns a generic error on exception. */
async function safeGraph(fn: () => Promise<GraphToolResult>): Promise<GraphToolResult> {
  try {
    return await fn();
  } catch (err: any) {
    console.error('[ServiceRelationshipTool] graph', err?.message ?? err);
    return { success: false, message: 'An internal error occurred', error: 'Internal error', graph: EMPTY_GRAPH };
  }
}

/**
 * Find a CodeService entity by name (case-insensitive substring match).
 * Returns null if not found — caller decides how to surface the error.
 *
 * Security: uses Qdrant listEntities which always scopes to tenantId.
 * The serviceName is used only for in-process filtering, never interpolated
 * into a query string.
 */
async function findServiceByName(
  qdrant: QdrantAdapter,
  tenantId: string,
  serviceName: string,
): Promise<CanonicalEntity | null> {
  const services = await qdrant.listEntities(tenantId, 'code_service', 500);
  const lower = serviceName.toLowerCase();
  // Prefer exact match, then substring
  return (
    services.find((s: any) => (s.name ?? '').toLowerCase() === lower) ??
    services.find((s: any) => (s.name ?? '').toLowerCase().includes(lower)) ??
    null
  );
}

/** Map a CanonicalEntity severity or risk score to GraphNode severity. */
function nodeSeverity(entity: any): 'high' | 'medium' | 'low' | undefined {
  const score = entity?.threatModel?.riskScore ?? entity?.overallRiskScore;
  if (score == null) return undefined;
  return score > 70 ? 'high' : score > 40 ? 'medium' : 'low';
}

// ── Tool: GetServiceCallers ───────────────────────────────────────────────────

interface ServiceNameOrIdParams extends Record<string, unknown> {
  serviceName?: string;
  serviceId?: string;
}

/**
 * GetServiceCallersTool
 *
 * Returns a list (and graph) of all services that call a given service
 * (i.e. have a CALLS_SERVICE or CALLS_API outbound relationship pointing at it).
 */
export class GetServiceCallersTool extends GraphBaseTool<ServiceNameOrIdParams> {
  name = 'get_service_callers';
  category = ServiceRelationshipCategory;
  description =
    'Find all services that call a given service (upstream callers / consumers). ' +
    'Provide the service name or ID. Returns a graph with caller → target edges and ' +
    'the list of matched API routes per caller.';
  parameters: ToolParameter[] = [
    { name: 'serviceName', description: 'Name (or partial name) of the target service', required: false, type: 'string' },
    { name: 'serviceId',   description: 'Exact entity ID of the target service',         required: false, type: 'string' },
  ];

  constructor(
    private readonly neo4j: Neo4jAdapter,
    private readonly qdrant: QdrantAdapter,
    private readonly tenantId: string,
  ) { super(); }

  async execute(p: ServiceNameOrIdParams): Promise<GraphToolResult> {
    return safeGraph(async () => {
      const idRaw   = san(p.serviceId);
      const nameRaw = san(p.serviceName);

      // Resolve target entity
      let target: CanonicalEntity | null = null;
      if (idRaw) {
        target = await this.qdrant.getEntity(this.tenantId, idRaw);
      } else if (nameRaw) {
        target = await findServiceByName(this.qdrant, this.tenantId, nameRaw);
      }

      if (!target) {
        const label = idRaw ?? nameRaw ?? '(not specified)';
        return { success: false, message: `Service "${label}" not found. Try semantic_search_services to find the correct name.`, error: 'Not found', graph: EMPTY_GRAPH };
      }

      // Fetch all inbound CALLS_SERVICE relationships (no user input in query)
      const callerRels = await this.neo4j.getRelationshipsByTarget(
        this.tenantId, target.id, 'CALLS_SERVICE' as any,
      );

      if (callerRels.length === 0) {
        return {
          success: true,
          message: `No services were found calling "${(target as any).name ?? target.id}". Either no scan has been run yet, or this service has no inbound calls.`,
          result: JSON.stringify({ targetService: (target as any).name ?? target.id, callerCount: 0, callers: [] }, null, 2),
          graph: { ...EMPTY_GRAPH, explanation: `No callers found for ${(target as any).name ?? target.id}` },
        };
      }

      // Fetch caller entities in parallel
      const callerEntities = await Promise.all(
        callerRels.map(r => this.qdrant.getEntity(this.tenantId, r.sourceId)),
      );

      // Build graph
      const targetNode: GraphNode = {
        id: target.id,
        type: 'CodeService',
        label: (target as any).name ?? target.id,
        severity: nodeSeverity(target),
        metadata: { isFocus: true },
      };

      const callerNodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];
      const callerSummary: { name: string; routes: string[] }[] = [];

      for (let i = 0; i < callerRels.length; i++) {
        const rel    = callerRels[i];
        const entity = callerEntities[i];
        if (!entity) continue;

        const callerLabel = (entity as any).name ?? entity.id;

        callerNodes.push({
          id: entity.id,
          type: 'CodeService',
          label: callerLabel,
          severity: nodeSeverity(entity),
        });

        const routes: string[] = rel.metadata?.matchedEndpoints ?? [];

        edges.push({
          id: `caller-${i}`,
          from: entity.id,
          to: target.id,
          type: 'USES',
          confidence: (rel.confidence as any) ?? 'heuristic',
          label: routes.length > 0 ? `${routes.length} route${routes.length > 1 ? 's' : ''}` : 'calls',
        });

        callerSummary.push({ name: callerLabel, routes });
      }

      const graph: GraphProjection = {
        nodes: [targetNode, ...callerNodes],
        edges,
        focusNodeId: target.id,
        explanation: `Services calling "${(target as any).name ?? target.id}"`,
      };

      return {
        success: true,
        message: `Found ${callerNodes.length} service(s) calling "${(target as any).name ?? target.id}"`,
        result: JSON.stringify({
          targetService: (target as any).name ?? target.id,
          callerCount: callerNodes.length,
          callers: callerSummary,
        }, null, 2),
        graph,
      };
    });
  }
}

// ── Tool: GetServiceDependencies ──────────────────────────────────────────────

/**
 * GetServiceDependenciesTool
 *
 * Returns a list (and graph) of all services that a given service calls
 * (i.e. its outbound CALLS_SERVICE relationships).
 */
export class GetServiceDependenciesTool extends GraphBaseTool<ServiceNameOrIdParams> {
  name = 'get_service_dependencies';
  category = ServiceRelationshipCategory;
  description =
    'Find all services that a given service calls (downstream dependencies / callees). ' +
    'Provide the service name or ID. Returns a graph with source → dependency edges and ' +
    'the list of matched API routes per dependency.';
  parameters: ToolParameter[] = [
    { name: 'serviceName', description: 'Name (or partial name) of the source service', required: false, type: 'string' },
    { name: 'serviceId',   description: 'Exact entity ID of the source service',         required: false, type: 'string' },
  ];

  constructor(
    private readonly neo4j: Neo4jAdapter,
    private readonly qdrant: QdrantAdapter,
    private readonly tenantId: string,
  ) { super(); }

  async execute(p: ServiceNameOrIdParams): Promise<GraphToolResult> {
    return safeGraph(async () => {
      const idRaw   = san(p.serviceId);
      const nameRaw = san(p.serviceName);

      let source: CanonicalEntity | null = null;
      if (idRaw) {
        source = await this.qdrant.getEntity(this.tenantId, idRaw);
      } else if (nameRaw) {
        source = await findServiceByName(this.qdrant, this.tenantId, nameRaw);
      }

      if (!source) {
        const label = idRaw ?? nameRaw ?? '(not specified)';
        return { success: false, message: `Service "${label}" not found. Try semantic_search_services to find the correct name.`, error: 'Not found', graph: EMPTY_GRAPH };
      }

      const depRels = await this.neo4j.getRelationshipsBySource(
        this.tenantId, source.id, 'CALLS_SERVICE' as any,
      );

      if (depRels.length === 0) {
        return {
          success: true,
          message: `"${(source as any).name ?? source.id}" makes no outbound service calls, or no scan has been run yet.`,
          result: JSON.stringify({ sourceService: (source as any).name ?? source.id, dependencyCount: 0, dependencies: [] }, null, 2),
          graph: { ...EMPTY_GRAPH, explanation: `No dependencies found for ${(source as any).name ?? source.id}` },
        };
      }

      const depEntities = await Promise.all(
        depRels.map(r => this.qdrant.getEntity(this.tenantId, r.targetId)),
      );

      const sourceNode: GraphNode = {
        id: source.id,
        type: 'CodeService',
        label: (source as any).name ?? source.id,
        severity: nodeSeverity(source),
        metadata: { isFocus: true },
      };

      const depNodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];
      const depSummary: { name: string; routes: string[] }[] = [];

      for (let i = 0; i < depRels.length; i++) {
        const rel    = depRels[i];
        const entity = depEntities[i];
        if (!entity) continue;

        const depLabel = (entity as any).name ?? entity.id;

        depNodes.push({
          id: entity.id,
          type: 'CodeService',
          label: depLabel,
          severity: nodeSeverity(entity),
        });

        const routes: string[] = rel.metadata?.matchedEndpoints ?? [];

        edges.push({
          id: `dep-${i}`,
          from: source.id,
          to: entity.id,
          type: 'USES',
          confidence: (rel.confidence as any) ?? 'heuristic',
          label: routes.length > 0 ? `${routes.length} route${routes.length > 1 ? 's' : ''}` : 'calls',
        });

        depSummary.push({ name: depLabel, routes });
      }

      const graph: GraphProjection = {
        nodes: [sourceNode, ...depNodes],
        edges,
        focusNodeId: source.id,
        explanation: `Services called by "${(source as any).name ?? source.id}"`,
      };

      return {
        success: true,
        message: `"${(source as any).name ?? source.id}" calls ${depNodes.length} service(s)`,
        result: JSON.stringify({
          sourceService: (source as any).name ?? source.id,
          dependencyCount: depNodes.length,
          dependencies: depSummary,
        }, null, 2),
        graph,
      };
    });
  }
}

// ── Tool: GetServiceApiRoutes ─────────────────────────────────────────────────

/**
 * GetServiceApiRoutesTool
 *
 * Returns the API routes that are actively called by other services
 * (CALLS_API relationships targeting this service), along with which
 * callers use each route.
 */
export class GetServiceApiRoutesTool extends BaseTool<ServiceNameOrIdParams> {
  name = 'get_service_api_routes';
  category = ServiceRelationshipCategory;
  description =
    'List the API routes of a service that are actively called by other services. ' +
    'Shows each route (method + path), which callers use it, and the call confidence. ' +
    'Provide the service name or ID.';
  parameters: ToolParameter[] = [
    { name: 'serviceName', description: 'Name (or partial name) of the service', required: false, type: 'string' },
    { name: 'serviceId',   description: 'Exact entity ID of the service',         required: false, type: 'string' },
  ];

  constructor(
    private readonly neo4j: Neo4jAdapter,
    private readonly qdrant: QdrantAdapter,
    private readonly tenantId: string,
  ) { super(); }

  async execute(p: ServiceNameOrIdParams): Promise<ToolResult> {
    return safe(async () => {
      const idRaw   = san(p.serviceId);
      const nameRaw = san(p.serviceName);

      let target: CanonicalEntity | null = null;
      if (idRaw) {
        target = await this.qdrant.getEntity(this.tenantId, idRaw);
      } else if (nameRaw) {
        target = await findServiceByName(this.qdrant, this.tenantId, nameRaw);
      }

      if (!target) {
        const label = idRaw ?? nameRaw ?? '(not specified)';
        return { success: false, message: `Service "${label}" not found. Try semantic_search_services to find the correct name.`, error: 'Not found' };
      }

      // Fetch all inbound CALLS_API relationships (one per matched method+path)
      const apiRels = await this.neo4j.getRelationshipsByTarget(
        this.tenantId, target.id, 'CALLS_API' as any,
      );

      if (apiRels.length === 0) {
        return {
          success: true,
          message: `No API routes found for "${(target as any).name ?? target.id}". Either no scan has indexed this service, or it has no actively-called routes.`,
          result: JSON.stringify({ service: (target as any).name ?? target.id, routeCount: 0, routes: [] }, null, 2),
        };
      }

      // Group by route (method + path)
      const routeMap = new Map<string, { method: string; path: string; callers: string[]; confidence: string }>();

      await Promise.all(apiRels.map(async rel => {
        const method = rel.metadata?.method ?? 'UNKNOWN';
        const path   = rel.metadata?.path   ?? '(unknown path)';
        const key    = `${method} ${path}`;

        const callerEntity = await this.qdrant.getEntity(this.tenantId, rel.sourceId);
        const callerName   = callerEntity ? ((callerEntity as any).name ?? rel.sourceId) : rel.sourceId;

        if (!routeMap.has(key)) {
          routeMap.set(key, { method, path, callers: [], confidence: rel.confidence ?? 'heuristic' });
        }
        routeMap.get(key)!.callers.push(callerName);
      }));

      const routes = Array.from(routeMap.values()).sort((a, b) => a.path.localeCompare(b.path));

      return {
        success: true,
        message: `Found ${routes.length} actively-called API route(s) on "${(target as any).name ?? target.id}"`,
        result: JSON.stringify({
          service: (target as any).name ?? target.id,
          routeCount: routes.length,
          routes,
        }, null, 2),
      };
    });
  }
}

// ── Tool: GetServiceCallGraph ─────────────────────────────────────────────────

/**
 * GetServiceCallGraphTool
 *
 * Returns the full call graph centred on a service: both callers (inbound)
 * and callees (outbound) as a single graph, with route details on each edge.
 * Useful for questions like "show me how ServiceA fits into the overall
 * architecture" or "draw the service dependency map for payment-api".
 */
export class GetServiceCallGraphTool extends GraphBaseTool<ServiceNameOrIdParams> {
  name = 'get_service_call_graph';
  category = ServiceRelationshipCategory;
  description =
    'Show the full call graph centred on a service: who calls it (upstream) and what it calls (downstream). ' +
    'Each edge is labelled with the matched API routes. ' +
    'Provide the service name or ID.';
  parameters: ToolParameter[] = [
    { name: 'serviceName', description: 'Name (or partial name) of the service to focus on', required: false, type: 'string' },
    { name: 'serviceId',   description: 'Exact entity ID of the service',                     required: false, type: 'string' },
  ];

  constructor(
    private readonly neo4j: Neo4jAdapter,
    private readonly qdrant: QdrantAdapter,
    private readonly tenantId: string,
  ) { super(); }

  async execute(p: ServiceNameOrIdParams): Promise<GraphToolResult> {
    return safeGraph(async () => {
      const idRaw   = san(p.serviceId);
      const nameRaw = san(p.serviceName);

      let focus: CanonicalEntity | null = null;
      if (idRaw) {
        focus = await this.qdrant.getEntity(this.tenantId, idRaw);
      } else if (nameRaw) {
        focus = await findServiceByName(this.qdrant, this.tenantId, nameRaw);
      }

      if (!focus) {
        const label = idRaw ?? nameRaw ?? '(not specified)';
        return { success: false, message: `Service "${label}" not found. Try semantic_search_services to find the correct name.`, error: 'Not found', graph: EMPTY_GRAPH };
      }

      // Fetch both directions in parallel
      const [callerRels, calleeRels] = await Promise.all([
        this.neo4j.getRelationshipsByTarget(this.tenantId, focus.id, 'CALLS_SERVICE' as any),
        this.neo4j.getRelationshipsBySource(this.tenantId, focus.id, 'CALLS_SERVICE' as any),
      ]);

      // Resolve all peer entities in parallel, deduplicating by ID
      const peerIds = new Set([
        ...callerRels.map(r => r.sourceId),
        ...calleeRels.map(r => r.targetId),
      ]);

      const peerMap = new Map<string, CanonicalEntity>();
      await Promise.all(
        Array.from(peerIds).map(async id => {
          const e = await this.qdrant.getEntity(this.tenantId, id);
          if (e) peerMap.set(id, e);
        }),
      );

      // Build graph
      const focusNode: GraphNode = {
        id: focus.id,
        type: 'CodeService',
        label: (focus as any).name ?? focus.id,
        severity: nodeSeverity(focus),
        metadata: { isFocus: true },
      };

      const peerNodes: GraphNode[] = Array.from(peerMap.values()).map(e => ({
        id: e.id,
        type: 'CodeService' as const,
        label: (e as any).name ?? e.id,
        severity: nodeSeverity(e),
      }));

      const edges: GraphEdge[] = [];
      let edgeIdx = 0;

      for (const rel of callerRels) {
        if (!peerMap.has(rel.sourceId)) continue;
        const routes: string[] = rel.metadata?.matchedEndpoints ?? [];
        edges.push({
          id: `in-${edgeIdx++}`,
          from: rel.sourceId,
          to: focus.id,
          type: 'USES',
          confidence: (rel.confidence as any) ?? 'heuristic',
          label: routes.length > 0 ? `↑ ${routes.length} route${routes.length > 1 ? 's' : ''}` : '↑ calls',
        });
      }

      for (const rel of calleeRels) {
        if (!peerMap.has(rel.targetId)) continue;
        const routes: string[] = rel.metadata?.matchedEndpoints ?? [];
        edges.push({
          id: `out-${edgeIdx++}`,
          from: focus.id,
          to: rel.targetId,
          type: 'USES',
          confidence: (rel.confidence as any) ?? 'heuristic',
          label: routes.length > 0 ? `↓ ${routes.length} route${routes.length > 1 ? 's' : ''}` : '↓ calls',
        });
      }

      const focusName = (focus as any).name ?? focus.id;

      const graph: GraphProjection = {
        nodes: [focusNode, ...peerNodes],
        edges,
        focusNodeId: focus.id,
        explanation: `Service call graph for "${focusName}": ${callerRels.length} caller(s), ${calleeRels.length} dependency(ies)`,
      };

      return {
        success: true,
        message: `Call graph for "${focusName}": ${callerRels.length} inbound, ${calleeRels.length} outbound relationship(s)`,
        result: JSON.stringify({
          service: focusName,
          callerCount: callerRels.length,
          dependencyCount: calleeRels.length,
          totalEdges: edges.length,
        }, null, 2),
        graph,
      };
    });
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createServiceRelationshipTools(
  neo4j: Neo4jAdapter,
  qdrant: QdrantAdapter,
  tenantId: string,
) {
  return [
    new GetServiceCallersTool(neo4j, qdrant, tenantId),
    new GetServiceDependenciesTool(neo4j, qdrant, tenantId),
    new GetServiceApiRoutesTool(neo4j, qdrant, tenantId),
    new GetServiceCallGraphTool(neo4j, qdrant, tenantId),
  ];
}
