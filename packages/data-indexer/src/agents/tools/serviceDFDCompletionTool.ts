/**
 * ServiceDFDCompletionTool
 *
 * Completion tool for the "Service-Level DFD Synthesis" step.
 * The LLM calls this tool to submit a clean architectural Data Flow Diagram
 * that maps all EXTERNAL relationships of the service.
 *
 * Per DFD.MD, the service-level DFD answers: "how does this service fit into
 * the world around it?" — an ARCHITECTURAL GRAPH showing every external
 * relationship: who calls it, what it calls, and what data crosses each boundary.
 *
 * The graph must remain at the architectural level:
 *  – processes[]   = only deployable services / microservices (one per service).
 *                    NO controllers, route handlers, or internal modules.
 *  – actors[]      = only external entities: human personas, identity providers,
 *                    monitoring agents, CDNs, other services that call this one.
 *  – dataStores[]  = only storage systems (one per system — no per-collection nodes).
 *  – flows[]       = EXACTLY ONE flow per (from, to) pair with a summarized label,
 *                    merged dataTypes[], accessPattern for data store flows, and
 *                    topicName for event/queue flows.
 *
 * Per DFD.MD the service-level DFD edges must distinguish:
 *   – Request/response calls with protocol
 *   – Events published/consumed with topic/queue name (topicName field)
 *   – Reads/writes to data stores (accessPattern: read | write | read_write)
 *   – Auth flows — who authenticates whom
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
const VALID_ACCESS_PATTERNS = ['read', 'write', 'read_write'];

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
    'PURPOSE: This DFD answers "how does this service fit into the world around it?" — an ' +
    'ARCHITECTURAL GRAPH showing every EXTERNAL relationship the service has.\n\n' +
    'Per DFD.MD, service-level DFD edges MUST distinguish:\n' +
    '  • Request/response calls — with protocol (REST, gRPC, GraphQL)\n' +
    '  • Events published/consumed — with topic/queue name (set topicName field)\n' +
    '  • Reads/writes to data stores — distinguished (set accessPattern: read | write | read_write)\n' +
    '  • Auth flows — who authenticates whom (include as a distinct flow to the IdP actor)\n\n' +
    'NODE RULES (strictly enforced):\n' +
    '  processes[]  → DEPLOYABLE SERVICES ONLY. One node per independently deployable ' +
    '    service/microservice. ❌ NO controllers, route handlers, middleware, or internal modules.\n' +
    '  actors[]     → EXTERNAL ENTITIES ONLY. Human personas, identity providers, monitoring ' +
    '    agents, API gateways, CDNs, other services that call INTO this service. ' +
    '    ❌ NO internal subcomponents.\n' +
    '  dataStores[] → STORAGE SYSTEMS ONLY — one node per system (not per table/collection). ' +
    '    Includes: databases, caches, message queues, blob stores, logging/observability sinks.\n\n' +
    'FLOW RULES (strictly enforced):\n' +
    '  ✅ EXACTLY ONE flow per (from, to) pair — duplicates are rejected.\n' +
    '  ✅ Merge all data between the same two nodes into ONE flow (combined label + merged dataTypes[]).\n' +
    '  ✅ Set accessPattern ("read" | "write" | "read_write") on all data store flows.\n' +
    '  ✅ Set topicName on all event/queue flows.\n' +
    '  ✅ Cover EVERY external communication: client→service, service→DB, cache, queue, IdP, logging, external-API.\n' +
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
        'Architectural DFD object — answers "how does this service fit into the world around it?"\n\n' +
        '  actors[]:     { id, label, type, trusted: boolean, trustBoundary?: TrustBoundaryType, correlationTags[] }\n' +
        '    type: external_user | admin | third_party | system | internal_service\n' +
        '    → ONLY external entities: human personas, identity providers, monitoring agents,\n' +
        '      API gateways, CDNs, or peer microservices that call INTO this service.\n' +
        '      trusted=false for all actors outside the service trust boundary.\n' +
        '    ❌ Do NOT place internal subcomponents of the service here.\n\n' +
        '  processes[]:  { id, label, type, trustBoundary?: TrustBoundaryType, correlationTags[] }\n' +
        '    type: api_gateway | backend_service | worker | queue | scheduler | other\n' +
        '    → ONLY independently deployable services/microservices.\n' +
        '    ❌ Do NOT create nodes for controllers, route handlers, middleware, or modules.\n\n' +
        '  dataStores[]: { id, label, type, dataClassification, encryptionAtRest: boolean, trustBoundary?: TrustBoundaryType, correlationTags[] }\n' +
        '    type: database | cache | blob_storage | queue | file_system | other\n' +
        '    → ONE node per storage system. All collections/tables in one DB = one node.\n\n' +
        '  flows[]:      { id, from, to, label, dataTypes: string[], dataClassification, direction, protocol, encrypted: boolean, authenticationRequired: boolean, crossesTrustBoundary: boolean, accessPattern?: (read|write|read_write), topicName?: string }\n' +
        '    Per DFD.MD service-level edge requirements:\n' +
        '    → label: concise summary of ALL data on the edge, e.g. "auth tokens, user profiles"\n' +
        '    → accessPattern: REQUIRED for data store flows — set to "read", "write", or "read_write".\n' +
        '      DFD.MD: "Reads/writes to data stores — distinguished (read vs write vs both)"\n' +
        '    → topicName: REQUIRED for event/queue flows — set to the topic/queue/stream name.\n' +
        '      DFD.MD: "Events published / consumed — with topic/queue name"\n' +
        '    → Exactly ONE flow per (from, to) pair. Merge all data types into one flow.\n\n' +
        '  trustBoundaries[]: TrustBoundaryType[] — every type referenced by any node.\n' +
        `    Must be one of: ${VALID_TRUST_BOUNDARY_TYPES.join(' | ')}\n\n` +
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

      // ── Per-DFD.MD service-level edge validations ─────────────────────────

      // accessPattern is required for data store flows
      const accessPattern = (f as any).accessPattern;
      if (accessPattern !== undefined && !VALID_ACCESS_PATTERNS.includes(accessPattern))
        errors.push(
          `flows[${i}].accessPattern "${accessPattern}" is invalid. Must be one of: ${VALID_ACCESS_PATTERNS.join(', ')}.`
        );

      // Check if either endpoint of the flow is a data store
      const isDataStoreFlow =
        (f.from && dfd.dataStores.some(d => d.id === f.from)) ||
        (f.to && dfd.dataStores.some(d => d.id === f.to));
      if (isDataStoreFlow && accessPattern === undefined) {
        const storeName =
          dfd.dataStores.find(d => d.id === f.from || d.id === f.to)?.label ?? 'unknown';
        errors.push(
          `flows[${i}] connects to data store "${storeName}" but is missing accessPattern. ` +
          `Per DFD.MD: "Reads/writes to data stores — distinguished (read vs write vs both)". ` +
          `Set accessPattern to "read", "write", or "read_write".`
        );
      }

      // topicName is expected for flows to/from queue data stores
      const isQueueFlow =
        (f.from && dfd.dataStores.some(d => d.id === f.from && d.type === 'queue')) ||
        (f.to && dfd.dataStores.some(d => d.id === f.to && d.type === 'queue'));
      const topicName = (f as any).topicName;
      if (isQueueFlow && !topicName?.trim()) {
        const queueName =
          dfd.dataStores.find(d => (d.id === f.from || d.id === f.to) && d.type === 'queue')?.label ?? 'unknown';
        errors.push(
          `flows[${i}] connects to queue/stream "${queueName}" but is missing topicName. ` +
          `Per DFD.MD: "Events published / consumed — with topic/queue name". ` +
          `Set topicName to the exact topic, queue, or stream name (e.g. "task-events", "payment.completed").`
        );
      }
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
