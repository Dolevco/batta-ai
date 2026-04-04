/**
 * DataFlowCompletionTool
 *
 * Completion tool for Step 2 of the business feature extraction pipeline.
 * The LLM calls this tool to submit the Data Flow Diagram (DFD) for one
 * business feature.
 *
 * Per DFD.MD, a feature-level DFD answers: "what happens inside the service when
 * this feature is triggered?" It must model responsibility-level processing stages
 * (not deployment-level services) and carry transformation labels, async/sync
 * distinction, and conditional branches (happy/error path) on edges.
 *
 * Validates:
 *  – Node ID cross-references (flow.from / flow.to exist in the diagram)
 *  – processes[].type must be a FeatureProcessType (responsibility-level)
 *  – flows[].async, flows[].branch, flows[].accessPattern allow-listed
 *  – All other enum values are allow-listed
 */

import { BaseTool, TaskCompletionCategory } from '@ai-agent/core';
import type { ToolCategory, ToolParameter, ToolResult } from '@ai-agent/core';
import type { DataFlowDiagram } from '@ai-agent/shared';
import { VALID_TRUST_BOUNDARY_TYPES, VALID_FEATURE_PROCESS_TYPES } from '@ai-agent/shared';

const VALID_ACTOR_TYPES = ['external_user', 'internal_service', 'admin', 'system', 'third_party'];
const VALID_STORE_TYPES = ['database', 'cache', 'blob_storage', 'queue', 'file_system', 'other'];
const VALID_CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'];
const VALID_DIRECTIONS = ['inbound', 'outbound', 'bidirectional'];
const VALID_BRANCHES = ['happy_path', 'error_path', 'both'];
const VALID_ACCESS_PATTERNS = ['read', 'write', 'read_write'];

export interface DataFlowInput extends Record<string, unknown> {
  featureName: string;
  dataFlowDiagram: DataFlowDiagram;
  reasoning: string;
}

export class DataFlowCompletionTool extends BaseTool<DataFlowInput> {
  name = 'task_complete';
  category: ToolCategory = TaskCompletionCategory;
  description =
    'Submit the completed Feature-Level Data Flow Diagram for this business feature. ' +
    'This DFD models what happens INSIDE the service for this feature — responsibility stages, ' +
    'not deployment services. ' +
    'processes[].type MUST use FeatureProcessType values (entry_point | input_validation | ' +
    'authorization | business_logic | data_access | external_call | response_builder | ' +
    'event_publisher | other). ' +
    'flows[].label MUST be a transformation description ("enriched with user profile", ' +
    '"filtered by permissions") NOT a technical call name. ' +
    'flows[].async (boolean) MUST be set to distinguish sync from async handoffs. ' +
    'flows[].branch (happy_path | error_path | both) MUST be set for conditional branches. ' +
    'All flow.from and flow.to values MUST reference IDs that exist in actors, processes, or dataStores. ' +
    'All enum values are case-sensitive. Validation errors are returned so you can fix and retry.';

  parameters: ToolParameter[] = [
    {
      name: 'featureName',
      description: 'The name of the business feature this DFD describes (non-empty string).',
      required: true,
      type: 'string',
    },
    {
      name: 'dataFlowDiagram',
      description:
        'Feature-Level DFD object. Per DFD.MD this answers "what happens inside the service ' +
        'when this feature is triggered?" — NOT an architectural service graph.\n\n' +
        '  actors[]:     { id, label, type: (external_user|admin|third_party|system|internal_service), trusted: boolean, trustBoundary?: TrustBoundaryType, correlationTags[] }\n' +
        '    → External initiators only: the human/system that triggers the feature, and the response recipient.\n\n' +
        '  processes[]:  { id, label, type: FeatureProcessType, trustBoundary?: TrustBoundaryType, correlationTags[] }\n' +
        '    → RESPONSIBILITY-LEVEL stages inside the service. NEVER deployment services or class names.\n' +
        `    → type MUST be one of: ${VALID_FEATURE_PROCESS_TYPES.join(' | ')}\n` +
        '    → Required stages: entry_point (the endpoint/trigger), plus whichever of\n' +
        '      input_validation, authorization, business_logic, data_access, external_call,\n' +
        '      event_publisher, response_builder apply to this feature.\n\n' +
        '  dataStores[]: { id, label, type: (database|cache|blob_storage|queue|file_system|other), dataClassification: (public|internal|confidential|restricted), encryptionAtRest: boolean, trustBoundary?: TrustBoundaryType, correlationTags[] }\n' +
        '    → Only data stores ACTUALLY TOUCHED by this feature.\n\n' +
        '  flows[]:      { id, from, to, label, dataTypes: string[], dataClassification, direction, protocol, encrypted: boolean, authenticationRequired: boolean, crossesTrustBoundary: boolean, async: boolean, branch?: (happy_path|error_path|both), accessPattern?: (read|write|read_write), topicName?: string }\n' +
        '    → label: TRANSFORMATION description — what changes about the data at this step.\n' +
        '      e.g. "validated and normalised", "enriched with user profile", "filtered by tenant".\n' +
        '      ❌ NOT a function call name or HTTP method.\n' +
        '    → async: true if this step hands off to a queue/broker without waiting; false if synchronous.\n' +
        '    → branch: set to "happy_path" or "error_path" for conditional flows; "both" if merged.\n' +
        '      Omit only for flows that always execute unconditionally.\n' +
        '    → accessPattern: set to "read", "write", or "read_write" for data store flows.\n' +
        '    → topicName: set the queue/topic name for event_publisher flows.\n\n' +
        '  trustBoundaries[]: TrustBoundaryType[] — every type used in any node\'s trustBoundary field.\n' +
        `TrustBoundaryType must be one of: ${VALID_TRUST_BOUNDARY_TYPES.join(' | ')}\n\n` +
        'WHAT TO LEAVE OUT (per DFD.MD):\n' +
        '  ❌ Implementation details: ORM calls, specific library usage, function names\n' +
        '  ❌ Error handling internals unless they represent a meaningful branch\n' +
        '  ❌ Retry logic\n' +
        '  ❌ Deployment infrastructure (Docker, Kubernetes, load balancers)\n\n' +
        'IMPORTANT: every boolean field must be JSON true/false, not the strings "true"/"false".',
      required: true,
      type: 'any',
    },
    {
      name: 'reasoning',
      description: 'Brief explanation of the key responsibility stages and trust boundaries reflected in this feature DFD (non-empty string).',
      required: true,
      type: 'string',
    },
  ];

  async execute(input: DataFlowInput): Promise<ToolResult> {
    return this.wrapExecution(input, async () => {
      const errors = this.validate(input);
      if (errors.length) {
        return {
          success: false,
          message: `DFD validation failed – fix these issues and call again:\n${errors.join('\n')}`,
          error: 'VALIDATION_ERROR',
        };
      }
      await this.notify(`✅ Feature DFD complete for "${input.featureName}": ${(input.dataFlowDiagram as DataFlowDiagram).flows.length} flows`);
      return {
        success: true,
        message: `Feature DFD for "${input.featureName}" validated successfully.`,
        requiredOutput: {
          featureName: input.featureName,
          dataFlowDiagram: input.dataFlowDiagram,
          reasoning: input.reasoning,
        },
      };
    });
  }

  private validate(input: DataFlowInput): string[] {
    const errors: string[] = [];
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

    if (errors.length) {
      return errors;
    }

    // ── Feature DFD structural rules ──────────────────────────────────────

    // At least one entry_point process is required (per DFD.MD: entry point is a mandatory node)
    const hasEntryPoint = dfd.processes.some(p => p.type === 'entry_point');
    if (!hasEntryPoint) {
      errors.push(
        'Feature DFD must include at least one process with type "entry_point" ' +
        '(the API endpoint, event trigger, or queue consumer that starts the flow). ' +
        'Per DFD.MD the entry point is a required node in a feature-level DFD.'
      );
    }

    // ── Validate trustBoundaries array — allow-list check ─────────────────
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

    // ── Validate actors ───────────────────────────────────────────────────
    dfd.actors.forEach((a, i) => {
      if (!a.id?.trim()) errors.push(`actors[${i}].id is required.`);
      if (!a.label?.trim()) errors.push(`actors[${i}].label is required.`);
      if (!VALID_ACTOR_TYPES.includes(a.type))
        errors.push(`actors[${i}].type "${a.type}" is invalid. Must be one of: ${VALID_ACTOR_TYPES.join(', ')}`);
      if (typeof a.trusted !== 'boolean')
        errors.push(`actors[${i}].trusted must be a boolean.`);
      if (a.trustBoundary !== undefined && !(VALID_TRUST_BOUNDARY_TYPES as readonly unknown[]).includes(a.trustBoundary))
        errors.push(`actors[${i}].trustBoundary "${a.trustBoundary}" is invalid. Must be one of: ${VALID_TRUST_BOUNDARY_TYPES.join(', ')}`);
    });

    // ── Validate processes — must use FeatureProcessType ─────────────────
    dfd.processes.forEach((p, i) => {
      if (!p.id?.trim()) errors.push(`processes[${i}].id is required.`);
      if (!p.label?.trim()) errors.push(`processes[${i}].label is required.`);
      if (!(VALID_FEATURE_PROCESS_TYPES as readonly unknown[]).includes(p.type))
        errors.push(
          `processes[${i}].type "${p.type}" is invalid for a feature-level DFD. ` +
          `Must be a responsibility-level FeatureProcessType: ${VALID_FEATURE_PROCESS_TYPES.join(', ')}. ` +
          `Do NOT use deployment-level types like "backend_service" or "worker" in a feature DFD.`
        );
      if (p.trustBoundary !== undefined && !(VALID_TRUST_BOUNDARY_TYPES as readonly unknown[]).includes(p.trustBoundary))
        errors.push(`processes[${i}].trustBoundary "${p.trustBoundary}" is invalid. Must be one of: ${VALID_TRUST_BOUNDARY_TYPES.join(', ')}`);
    });

    // ── Validate data stores ──────────────────────────────────────────────
    dfd.dataStores.forEach((d, i) => {
      if (!d.id?.trim()) errors.push(`dataStores[${i}].id is required.`);
      if (!d.label?.trim()) errors.push(`dataStores[${i}].label is required.`);
      if (!VALID_STORE_TYPES.includes(d.type))
        errors.push(`dataStores[${i}].type "${d.type}" is invalid.`);
      if (!VALID_CLASSIFICATIONS.includes(d.dataClassification))
        errors.push(`dataStores[${i}].dataClassification "${d.dataClassification}" is invalid.`);
      if (typeof d.encryptionAtRest !== 'boolean')
        errors.push(`dataStores[${i}].encryptionAtRest must be a boolean.`);
      if (d.trustBoundary !== undefined && !(VALID_TRUST_BOUNDARY_TYPES as readonly unknown[]).includes(d.trustBoundary))
        errors.push(`dataStores[${i}].trustBoundary "${d.trustBoundary}" is invalid. Must be one of: ${VALID_TRUST_BOUNDARY_TYPES.join(', ')}`);
    });

    // ── Validate flows ────────────────────────────────────────────────────
    dfd.flows.forEach((f, i) => {
      if (!f.id?.trim()) errors.push(`flows[${i}].id is required.`);
      if (!nodeIds.has(f.from))
        errors.push(`flows[${i}].from "${f.from}" does not reference a known node ID.`);
      if (!nodeIds.has(f.to))
        errors.push(`flows[${i}].to "${f.to}" does not reference a known node ID.`);
      if (!f.label?.trim())
        errors.push(`flows[${i}].label is required. It must be a transformation description, e.g. "validated and normalised", "enriched with user profile".`);
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
      if (!Array.isArray(f.dataTypes) || f.dataTypes.length === 0)
        errors.push(`flows[${i}].dataTypes must be a non-empty array.`);

      // ── Feature-specific flow field validation ──────────────────────────

      // async is required on feature DFDs to distinguish sync vs async handoffs
      if (typeof (f as any).async !== 'boolean')
        errors.push(
          `flows[${i}].async must be a boolean (true = async handoff to queue/broker, false = synchronous). ` +
          `Per DFD.MD: "distinguish if a step hands off to a queue vs waits for a response".`
        );

      // branch is optional but must be a valid value when present
      const branch = (f as any).branch;
      if (branch !== undefined && !VALID_BRANCHES.includes(branch))
        errors.push(
          `flows[${i}].branch "${branch}" is invalid. Must be one of: ${VALID_BRANCHES.join(', ')} — or omit for unconditional flows.`
        );

      // accessPattern is optional but must be valid when present
      const accessPattern = (f as any).accessPattern;
      if (accessPattern !== undefined && !VALID_ACCESS_PATTERNS.includes(accessPattern))
        errors.push(
          `flows[${i}].accessPattern "${accessPattern}" is invalid. Must be one of: ${VALID_ACCESS_PATTERNS.join(', ')}.`
        );

      // Data store flows should have accessPattern
      const toNode = [...dfd.dataStores].find(d => d.id === f.to) ?? [...dfd.dataStores].find(d => d.id === f.from);
      if (toNode && accessPattern === undefined) {
        errors.push(
          `flows[${i}] touches data store "${toNode.label}" but is missing accessPattern. ` +
          `Per DFD.MD: "Reads/writes to data stores — distinguished (read vs write vs both)". ` +
          `Set accessPattern to "read", "write", or "read_write".`
        );
      }
    });

    return errors;
  }
}
