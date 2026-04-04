/**
 * DataFlowCompletionTool
 *
 * Completion tool for Step 2 of the business feature extraction pipeline.
 * The LLM calls this tool to submit the Data Flow Diagram (DFD) for one
 * business feature.  Validates node ID cross-references and enum values.
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

export interface DataFlowInput extends Record<string, unknown> {
  featureName: string;
  dataFlowDiagram: DataFlowDiagram;
  reasoning: string;
}

export class DataFlowCompletionTool extends BaseTool<DataFlowInput> {
  name = 'task_complete';
  category: ToolCategory = TaskCompletionCategory;
  description =
    'Submit the completed Data Flow Diagram for this business feature. ' +
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
        'DFD object with the following arrays — all required:\n' +
        '  actors[]:     { id, label, type: (external_user|admin|third_party|system|internal_service), trusted: boolean, trustBoundary?: TrustBoundaryType, correlationTags[] }\n' +
        '  processes[]:  { id, label, type: (api_gateway|backend_service|worker|queue|scheduler|other), trustBoundary?: TrustBoundaryType, correlationTags[] }\n' +
        '  dataStores[]: { id, label, type: (database|cache|blob_storage|queue|file_system|other), dataClassification: (public|internal|confidential|restricted), encryptionAtRest: boolean, trustBoundary?: TrustBoundaryType, correlationTags[] }\n' +
        '  flows[]:      { id, from: <node id>, to: <node id>, label, dataTypes: string[], dataClassification: (public|internal|confidential|restricted), direction: (inbound|outbound|bidirectional), protocol, encrypted: boolean, authenticationRequired: boolean, crossesTrustBoundary: boolean }\n' +
        '  trustBoundaries[]: TrustBoundaryType[] — every type used in actors[].trustBoundary, processes[].trustBoundary, or dataStores[].trustBoundary.\n' +
        `TrustBoundaryType must be one of: ${VALID_TRUST_BOUNDARY_TYPES.join(' | ')}\n` +
        '  INTERNET  – boundary between public internet clients and the system (e.g. browser → API).\n' +
        '  IDENTITY  – boundary where authentication / identity validation occurs (OAuth, SSO, token verification).\n' +
        '  SERVICE   – boundary between internal microservices with separate permissions or responsibilities.\n' +
        '  DATA      – boundary when accessing persistent storage (database, vector DB, object storage).\n' +
        '  EXTERNAL  – boundary when calling third-party / SaaS services outside our control.\n' +
        'PLACEMENT RULES: assign trustBoundary on EVERY node (actor, process, dataStore). Use "INTERNET" for untrusted external actors, "DATA" for data stores, "SERVICE" for internal microservices, "IDENTITY" where auth is enforced, "EXTERNAL" for third-party services.\n' +
        'IMPORTANT: every boolean field must be JSON true/false, not the strings "true"/"false".',
      required: true,
      type: 'any',
    },
    {
      name: 'reasoning',
      description: 'Brief explanation of the key architectural decisions reflected in the DFD (non-empty string).',
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
      await this.notify(`✅ DFD complete for "${input.featureName}": ${(input.dataFlowDiagram as DataFlowDiagram).flows.length} flows`);
      return {
        success: true,
        message: `DFD for "${input.featureName}" validated successfully.`,
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

    // Validate trustBoundaries array — allow-list check (critical: input validation)
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
      if (a.trustBoundary !== undefined && !(VALID_TRUST_BOUNDARY_TYPES as readonly unknown[]).includes(a.trustBoundary))
        errors.push(`actors[${i}].trustBoundary "${a.trustBoundary}" is invalid. Must be one of: ${VALID_TRUST_BOUNDARY_TYPES.join(', ')}`);
    });

    // Validate processes
    dfd.processes.forEach((p, i) => {
      if (!p.id?.trim()) errors.push(`processes[${i}].id is required.`);
      if (!p.label?.trim()) errors.push(`processes[${i}].label is required.`);
      if (!VALID_PROCESS_TYPES.includes(p.type))
        errors.push(`processes[${i}].type "${p.type}" is invalid.`);
      if (p.trustBoundary !== undefined && !(VALID_TRUST_BOUNDARY_TYPES as readonly unknown[]).includes(p.trustBoundary))
        errors.push(`processes[${i}].trustBoundary "${p.trustBoundary}" is invalid. Must be one of: ${VALID_TRUST_BOUNDARY_TYPES.join(', ')}`);
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
      if (d.trustBoundary !== undefined && !(VALID_TRUST_BOUNDARY_TYPES as readonly unknown[]).includes(d.trustBoundary))
        errors.push(`dataStores[${i}].trustBoundary "${d.trustBoundary}" is invalid. Must be one of: ${VALID_TRUST_BOUNDARY_TYPES.join(', ')}`);
    });

    // Validate flows
    dfd.flows.forEach((f, i) => {
      if (!f.id?.trim()) errors.push(`flows[${i}].id is required.`);
      if (!nodeIds.has(f.from))
        errors.push(`flows[${i}].from "${f.from}" does not reference a known node ID.`);
      if (!nodeIds.has(f.to))
        errors.push(`flows[${i}].to "${f.to}" does not reference a known node ID.`);
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
    });

    return errors;
  }
}
