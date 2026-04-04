/**
 * ServiceDFDCompletionTool
 *
 * Completion tool for the "Service-Level DFD Synthesis" step.
 * The LLM calls this tool to submit a clean architectural Data Flow Diagram
 * that maps all EXTERNAL relationships of the service.
 *
 * The graph must remain at the architectural level:
 *  – processes[]   = only deployable services / microservices (one per service).
 *                    NO controllers, route handlers, or internal modules.
 *  – actors[]      = only external entities: human personas, identity providers,
 *                    monitoring agents, CDNs, other services that call this one.
 *  – dataStores[]  = only storage systems (one per system — no per-collection nodes).
 *  – flows[]       = EXACTLY ONE flow per (from, to) pair with a summarized label
 *                    and merged dataTypes[] covering all data on that edge.
 *
 * Security: All enum values are allow-list validated. Duplicate (from, to) flow
 * pairs are rejected. No workspace paths or secret values may appear in any field
 * (enforced by the caller via sanitizeMetadata before storage).
 */

import { BaseTool, TaskCompletionCategory } from '@ai-agent/core';
import type { ToolCategory, ToolParameter, ToolResult } from '@ai-agent/core';
import type { DataFlowDiagram } from '@ai-agent/shared';
import { VALID_TRUST_BOUNDARY_TYPES } from '@ai-agent/shared';

const VALID_ACTOR_TYPES = ['external_user', 'internal_service', 'admin', 'system', 'third_party'];
const VALID_PROCESS_TYPES = ['api_gateway', 'backend_service', 'worker', 'queue', 'scheduler', 'other'];
const VALID_STORE_TYPES = ['database', 'cache', 'blob_storage', 'queue', 'file_system', 'other'];
const VALID_CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'];
const VALID_DIRECTIONS = ['inbound', 'outbound', 'bidirectional'];

export interface ServiceDFDInput extends Record<string, unknown> {
  serviceName: string;
  dataFlowDiagram: DataFlowDiagram;
  featuresCovered: string[];
  reasoning: string;
}

export class ServiceDFDCompletionTool extends BaseTool<ServiceDFDInput> {
  name = 'task_complete';
  category: ToolCategory = TaskCompletionCategory;
  description =
    'Submit the completed Service-Level Architectural Data Flow Diagram.\n\n' +
    'PURPOSE: This DFD is an ARCHITECTURAL GRAPH that maps every EXTERNAL relationship ' +
    'the service has — who calls it, what it calls, what data crosses each boundary. ' +
    'It must stay clean: no internal subcomponents, one node per external entity, ' +
    'one flow per (from, to) pair.\n\n' +
    'NODE RULES (strictly enforced):\n' +
    '  processes[]  → DEPLOYABLE SERVICES ONLY. One node per independently deployable ' +
    '    service/microservice. The service being synthesised is itself one node. ' +
    '    ❌ NO controllers, route handlers, middleware, or internal modules.\n' +
    '  actors[]     → EXTERNAL ENTITIES ONLY. Human personas (end-user, admin, developer), ' +
    '    identity providers (Azure AD, Auth0, Okta), monitoring/logging agents (Datadog, Sentry), ' +
    '    API gateways, CDNs, and other services that call INTO this service. ' +
    '    ❌ NO internal subcomponents of the service.\n' +
    '  dataStores[] → STORAGE SYSTEMS ONLY — one node per system (not per table/collection). ' +
    '    Includes: databases, caches, message queues, blob stores, file systems, ' +
    '    and logging/observability sinks that receive structured data.\n\n' +
    'FLOW RULES (strictly enforced):\n' +
    '  ✅ EXACTLY ONE flow per (from, to) pair — duplicates are rejected by validation.\n' +
    '  ✅ If multiple data types flow between the same two nodes, merge into ONE flow ' +
    '    with a summarized label (e.g. "auth tokens, user data, audit events") ' +
    '    and list all dataTypes in dataTypes[].\n' +
    '  ✅ Cover EVERY external communication: client→service, service→DB, service→cache, ' +
    '    service→queue, service→IdP, service→logging, service→external-API.\n\n' +
    'All flow.from and flow.to values MUST reference IDs that exist in actors[], processes[], or dataStores[]. ' +
    'All enum values are case-sensitive. Validation errors are returned so you can fix and retry.';

  parameters: ToolParameter[] = [
    {
      name: 'serviceName',
      description: 'The name of the service this summarized DFD covers (non-empty string).',
      required: true,
      type: 'string',
    },
    {
      name: 'dataFlowDiagram',
      description:
        'Architectural DFD object with these arrays (all required):\n\n' +
        '  actors[]:     { id, label, type, trusted: boolean, trustBoundary?: TrustBoundaryType, correlationTags[] }\n' +
        '    type: external_user | admin | third_party | system | internal_service\n' +
        '    → ONLY external entities: human personas, identity providers, monitoring agents,\n' +
        '      API gateways, CDNs, or peer microservices that call INTO this service.\n' +
        '      trusted=false for all actors outside the service trust boundary.\n' +
        '    ❌ Do NOT place internal subcomponents of the service here.\n\n' +
        '  processes[]:  { id, label, type, trustBoundary?: TrustBoundaryType, correlationTags[] }\n' +
        '    type: api_gateway | backend_service | worker | queue | scheduler | other\n' +
        '    → ONLY independently deployable services/microservices. The service being\n' +
        '      synthesised is itself ONE process node.\n' +
        '    ❌ Do NOT create nodes for controllers, route handlers, middleware, or modules.\n\n' +
        '  dataStores[]: { id, label, type, dataClassification, encryptionAtRest: boolean, trustBoundary?: TrustBoundaryType, correlationTags[] }\n' +
        '    type: database | cache | blob_storage | queue | file_system | other\n' +
        '    dataClassification: public | internal | confidential | restricted\n' +
        '    → ONE node per storage system. All collections/tables in one DB = one node.\n' +
        '      Includes logging/observability sinks that receive structured write traffic.\n\n' +
        '  flows[]:      { id, from, to, label, dataTypes: string[], dataClassification, direction, protocol, encrypted: boolean, authenticationRequired: boolean, crossesTrustBoundary: boolean }\n' +
        '    dataClassification: public | internal | confidential | restricted\n' +
        '    direction: inbound | outbound | bidirectional\n' +
        '    → EXACTLY ONE flow per (from, to) pair. If multiple data types flow between\n' +
        '      the same two nodes, use ONE flow with a combined label (e.g. "auth tokens,\n' +
        '      user profiles, audit events") and list all dataTypes in dataTypes[].\n' +
        '    → from and to MUST reference valid IDs from actors[], processes[], or dataStores[].\n\n' +
        '  trustBoundaries[]: TrustBoundaryType[] — every type referenced by any node.\n' +
        `    Must be one of: ${VALID_TRUST_BOUNDARY_TYPES.join(' | ')}\n` +
        '    INTERNET=public clients, IDENTITY=IdP boundary, SERVICE=inter-service,\n' +
        '    DATA=storage systems, EXTERNAL=third-party SaaS.\n\n' +
        'IMPORTANT: every boolean field must be JSON true/false, not the strings "true"/"false".',
      required: true,
      type: 'any',
    },
    {
      name: 'featuresCovered',
      description: 'List of feature names whose DFDs were merged into this service DFD (non-empty array of strings).',
      required: true,
      type: 'array',
    },
    {
      name: 'reasoning',
      description: 'Brief explanation of key merging decisions and any collapsed nodes (non-empty string).',
      required: true,
      type: 'string',
    },
  ];

  async execute(input: ServiceDFDInput): Promise<ToolResult> {
    return this.wrapExecution(input, async () => {
      const errors = this.validate(input);
      if (errors.length) {
        return {
          success: false,
          message: `Service DFD validation failed – fix these issues and call again:\n${errors.join('\n')}`,
          error: 'VALIDATION_ERROR',
        };
      }
      const dfd = input.dataFlowDiagram as DataFlowDiagram;
      await this.notify(
        `✅ Service DFD complete for "${input.serviceName}": ` +
          `${dfd.actors.length} actors, ${dfd.processes.length} processes, ` +
          `${dfd.dataStores.length} data stores, ${dfd.flows.length} flows`
      );
      return {
        success: true,
        message: `Service DFD for "${input.serviceName}" validated successfully.`,
        requiredOutput: {
          serviceName: input.serviceName,
          dataFlowDiagram: input.dataFlowDiagram,
          featuresCovered: input.featuresCovered,
          reasoning: input.reasoning,
        },
      };
    });
  }

  private validate(input: ServiceDFDInput): string[] {
    const errors: string[] = [];

    if (!input.serviceName?.trim()) errors.push('`serviceName` is required.');
    if (!Array.isArray(input.featuresCovered) || input.featuresCovered.length === 0)
      errors.push('`featuresCovered` must be a non-empty array.');
    if (!input.reasoning?.trim()) errors.push('`reasoning` is required.');

    const dfd = input.dataFlowDiagram as DataFlowDiagram;
    if (!dfd || typeof dfd !== 'object') {
      errors.push('`dataFlowDiagram` must be an object.');
      return errors;
    }

    if (!Array.isArray(dfd.actors)) errors.push('`dataFlowDiagram.actors` must be an array.');
    if (!Array.isArray(dfd.processes)) errors.push('`dataFlowDiagram.processes` must be an array.');
    if (!Array.isArray(dfd.dataStores)) errors.push('`dataFlowDiagram.dataStores` must be an array.');
    if (!Array.isArray(dfd.flows)) errors.push('`dataFlowDiagram.flows` must be an array.');
    if (!Array.isArray(dfd.trustBoundaries)) errors.push('`dataFlowDiagram.trustBoundaries` must be an array.');

    if (errors.length) return errors;

    // Validate trustBoundaries array — allow-list check
    dfd.trustBoundaries.forEach((tb: unknown, i: number) => {
      if (!(VALID_TRUST_BOUNDARY_TYPES as readonly unknown[]).includes(tb))
        errors.push(
          `trustBoundaries[${i}] "${tb}" is invalid. Must be one of: ${VALID_TRUST_BOUNDARY_TYPES.join(', ')}`,
        );
    });

    // Build valid node ID set
    const nodeIds = new Set<string>();
    dfd.actors.forEach(a => nodeIds.add(a.id));
    dfd.processes.forEach(p => nodeIds.add(p.id));
    dfd.dataStores.forEach(d => nodeIds.add(d.id));

    // Validate actors
    dfd.actors.forEach((a, i) => {
      if (!a.id?.trim()) errors.push(`actors[${i}].id is required.`);
      if (!a.label?.trim()) errors.push(`actors[${i}].label is required.`);
      if (!VALID_ACTOR_TYPES.includes(a.type))
        errors.push(`actors[${i}].type "${a.type}" is invalid. Must be one of: ${VALID_ACTOR_TYPES.join(', ')}`);
      if (typeof a.trusted !== 'boolean')
        errors.push(`actors[${i}].trusted must be a boolean.`);
      if (
        a.trustBoundary !== undefined &&
        !(VALID_TRUST_BOUNDARY_TYPES as readonly unknown[]).includes(a.trustBoundary)
      )
        errors.push(`actors[${i}].trustBoundary "${a.trustBoundary}" is invalid.`);
    });

    // Validate processes
    dfd.processes.forEach((p, i) => {
      if (!p.id?.trim()) errors.push(`processes[${i}].id is required.`);
      if (!p.label?.trim()) errors.push(`processes[${i}].label is required.`);
      if (!VALID_PROCESS_TYPES.includes(p.type))
        errors.push(`processes[${i}].type "${p.type}" is invalid.`);
      if (
        p.trustBoundary !== undefined &&
        !(VALID_TRUST_BOUNDARY_TYPES as readonly unknown[]).includes(p.trustBoundary)
      )
        errors.push(`processes[${i}].trustBoundary "${p.trustBoundary}" is invalid.`);
    });

    // Validate data stores
    dfd.dataStores.forEach((d, i) => {
      if (!d.id?.trim()) errors.push(`dataStores[${i}].id is required.`);
      if (!d.label?.trim()) errors.push(`dataStores[${i}].label is required.`);
      if (!VALID_STORE_TYPES.includes(d.type))
        errors.push(`dataStores[${i}].type "${d.type}" is invalid.`);
      if (!VALID_CLASSIFICATIONS.includes(d.dataClassification))
        errors.push(`dataStores[${i}].dataClassification "${d.dataClassification}" is invalid.`);
      if (typeof d.encryptionAtRest !== 'boolean')
        errors.push(`dataStores[${i}].encryptionAtRest must be a boolean.`);
      if (
        d.trustBoundary !== undefined &&
        !(VALID_TRUST_BOUNDARY_TYPES as readonly unknown[]).includes(d.trustBoundary)
      )
        errors.push(`dataStores[${i}].trustBoundary "${d.trustBoundary}" is invalid.`);
    });

    // Validate flows
    dfd.flows.forEach((f, i) => {
      if (!f.id?.trim()) errors.push(`flows[${i}].id is required.`);
      if (!f.from?.trim()) errors.push(`flows[${i}].from is required.`);
      if (!f.to?.trim()) errors.push(`flows[${i}].to is required.`);
      if (!f.label?.trim()) errors.push(`flows[${i}].label is required.`);
      if (f.from && !nodeIds.has(f.from))
        errors.push(`flows[${i}].from "${f.from}" does not reference a known node id.`);
      if (f.to && !nodeIds.has(f.to))
        errors.push(`flows[${i}].to "${f.to}" does not reference a known node id.`);
      if (!VALID_CLASSIFICATIONS.includes(f.dataClassification))
        errors.push(`flows[${i}].dataClassification "${f.dataClassification}" is invalid.`);
      if (!VALID_DIRECTIONS.includes(f.direction))
        errors.push(`flows[${i}].direction "${f.direction}" is invalid.`);
      if (typeof f.encrypted !== 'boolean')
        errors.push(`flows[${i}].encrypted must be a boolean.`);
      if (typeof f.authenticationRequired !== 'boolean')
        errors.push(`flows[${i}].authenticationRequired must be a boolean.`);
      if (typeof f.crossesTrustBoundary !== 'boolean')
        errors.push(`flows[${i}].crossesTrustBoundary must be a boolean.`);
    });

    // Enforce one flow per (from, to) pair — architectural graph rule
    const flowPairs = new Map<string, number>();
    dfd.flows.forEach((f, i) => {
      if (!f.from || !f.to) return;
      const key = `${f.from}→${f.to}`;
      if (flowPairs.has(key)) {
        errors.push(
          `Duplicate (from, to) pair at flows[${i}] and flows[${flowPairs.get(key)}]: ` +
          `"${f.from}" → "${f.to}". Merge all data between these nodes into ONE flow ` +
          `with a combined label and merged dataTypes[].`
        );
      } else {
        flowPairs.set(key, i);
      }
    });

    return errors;
  }
}
