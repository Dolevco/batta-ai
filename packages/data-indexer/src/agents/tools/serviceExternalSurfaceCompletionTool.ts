/**
 * ServiceExternalSurfaceCompletionTool
 *
 * Completion tool for the ServiceSurfaceExtractor agent (Pass 2).
 * The LLM calls this tool to submit an exhaustive enumeration of the service's
 * external surface: all external dependencies with classified trust boundaries.
 *
 * The resulting ServiceExternalSurface is injected as pre-built context into
 * every DFD agent (Pass 4) and the Service DFD Synthesis (Pass 5), replacing
 * ad-hoc discovery of identity providers and data stores.
 *
 * Security:
 *   - Evidence fields must only contain key NAMES and file paths — no actual values.
 *   - Secret value patterns are explicitly rejected.
 *   - Classification: INTERNAL — key names + import paths only.
 */

import { BaseTool, TaskCompletionCategory } from '@batta/core';
import type { ToolCategory, ToolParameter, ToolResult } from '@batta/core';
import type { ExternalDep, ServiceExternalSurface } from '@batta/shared';

export interface ServiceExternalSurfaceInput extends Record<string, unknown> {
  surface: ServiceExternalSurface;
  reasoning: string;
}

const VALID_TYPES: ExternalDep['type'][] = [
  'api', 'cloud', 'queue', 'database', 'cache', 'storage', 'identity', 'other',
];
const VALID_DATA_FLOWS: ExternalDep['dataFlow'][] = ['inbound', 'outbound', 'bidirectional'];
const VALID_CLASSIFICATIONS: ExternalDep['dataClassification'][] = [
  'public', 'internal', 'confidential', 'restricted',
];
const VALID_TRUST_BOUNDARIES = ['IDENTITY', 'DATA', 'EXTERNAL', 'INTERNET', 'SERVICE'] as const;

const MAX_DEPS = 50;

// Patterns that indicate a secret value was accidentally included
const SECRET_VALUE_PATTERNS = [
  /eyJ[A-Za-z0-9_-]{20,}/, // JWT
  /(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/i, // Stripe-style keys
  /AKIA[0-9A-Z]{16}/, // AWS access key IDs
  /(?:^|[^a-z])([a-f0-9]{40})(?:[^a-f0-9]|$)/, // 40-char hex tokens
  /AccountKey=[A-Za-z0-9+/=]{40,}/, // Azure storage keys
];

function containsSecret(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some(p => p.test(value));
}

export class ServiceExternalSurfaceCompletionTool extends BaseTool<ServiceExternalSurfaceInput> {
  name = 'complete_service_external_surface';
  category: ToolCategory = TaskCompletionCategory;
  description =
    'Submit the complete external surface enumeration for the service. Call ONLY after reading ' +
    'all config and client files from the file map. ' +
    'SECURITY: Evidence must contain only env var KEY NAMES and file paths — NEVER actual values.';

  parameters: ToolParameter[] = [
    {
      name: 'surface',
      description:
        'ServiceExternalSurface object with:\n' +
        '  externalDeps[]  — each dep:\n' +
        '    name              (string)   — short descriptive name\n' +
        '    type              (string)   — api | cloud | queue | database | cache | storage | identity | other\n' +
        '    purpose           (string)   — why the service uses this dep\n' +
        '    dataFlow          (string)   — inbound | outbound | bidirectional\n' +
        '    dataClassification(string)   — public | internal | confidential | restricted\n' +
        '    businessValue     (string)   — why this dep matters\n' +
        '    evidence          (string)   — env var KEY NAME(s) / import path — NEVER actual values\n' +
        '    resourceName      (string?)  — concrete resource id for correlation:\n' +
        '                                   database → db/schema name (e.g. "neo4j")\n' +
        '                                   cache    → logical name or key-space prefix\n' +
        '                                   queue    → queue/topic name (e.g. "indexing")\n' +
        '                                   storage  → bucket/container name\n' +
        '                                   api      → base path prefix (e.g. "/api") NOT hostname\n' +
        '    endpoints         (string[]?) — for type=api only: sampled paths called\n' +
        '                                   e.g. ["POST /tasks", "GET /tasks/:id", "POST /chat"]\n' +
        '                                   Use parameterized forms (/:id), not concrete IDs\n' +
        '    operations        (string[]?) — specific ops: ["read"], ["write"],\n' +
        '                                   ["read","write"], ["subscribe"], ["publish"]\n' +
        '                                   Allowed: read | write | subscribe | publish | upsert | delete | search\n' +
        '  trustBoundaryMap — { IDENTITY: [], DATA: [], EXTERNAL: [], INTERNET: [], SERVICE: [] }\n' +
        '    Each dep.name must appear in exactly one boundary list',
      required: true,
      type: 'object',
    },
    {
      name: 'reasoning',
      description: 'Brief explanation of how the surface was derived (non-empty string).',
      required: true,
      type: 'string',
    },
  ];

  async execute(input: ServiceExternalSurfaceInput): Promise<ToolResult> {
    return this.wrapExecution(input, async () => {
      const errors = this.validate(input);
      if (errors.length) {
        return {
          success: false,
          message: `Validation failed – fix these issues and call again:\n${errors.join('\n')}`,
          error: 'VALIDATION_ERROR',
        };
      }
      await this.notify(
        `✅ External surface complete: ${input.surface.externalDeps.length} dep(s), ` +
        `IDENTITY: [${input.surface.trustBoundaryMap.IDENTITY.join(', ')}], ` +
        `DATA: [${input.surface.trustBoundaryMap.DATA.join(', ')}]`,
      );
      return {
        success: true,
        message: `External surface complete: ${input.surface.externalDeps.length} external dep(s).`,
        requiredOutput: {
          surface: input.surface,
          reasoning: input.reasoning,
        },
      };
    });
  }

  private validate(input: ServiceExternalSurfaceInput): string[] {
    const errors: string[] = [];

    if (!input.surface || typeof input.surface !== 'object') {
      errors.push('`surface` must be an object.');
      return errors;
    }

    const s = input.surface;

    // Validate externalDeps
    if (!Array.isArray(s.externalDeps)) {
      errors.push('`surface.externalDeps` must be an array.');
    } else {
      if (s.externalDeps.length > MAX_DEPS)
        errors.push(`\`surface.externalDeps\` has too many items (max ${MAX_DEPS}).`);

      s.externalDeps.forEach((dep, i) => {
        const p = `surface.externalDeps[${i}]`;
        if (!dep.name?.trim()) errors.push(`${p}.name is required.`);
        if (!VALID_TYPES.includes(dep.type))
          errors.push(`${p}.type "${dep.type}" must be one of: ${VALID_TYPES.join(', ')}`);
        if (!dep.purpose?.trim()) errors.push(`${p}.purpose is required.`);
        if (!VALID_DATA_FLOWS.includes(dep.dataFlow))
          errors.push(`${p}.dataFlow "${dep.dataFlow}" must be one of: ${VALID_DATA_FLOWS.join(', ')}`);
        if (!VALID_CLASSIFICATIONS.includes(dep.dataClassification))
          errors.push(`${p}.dataClassification "${dep.dataClassification}" must be one of: ${VALID_CLASSIFICATIONS.join(', ')}`);
        if (!dep.businessValue?.trim()) errors.push(`${p}.businessValue is required.`);

        // Security: reject if evidence looks like an actual secret value
        if (dep.evidence && containsSecret(dep.evidence)) {
          errors.push(
            `${p}.evidence appears to contain a secret value. ` +
            'Only include the env var KEY NAME and file path, never the actual value.',
          );
        }

        // Validate optional correlation fields (Critical: input validation task 4604f7e1)
        if (dep.endpoints !== undefined) {
          if (!Array.isArray(dep.endpoints)) {
            errors.push(`${p}.endpoints must be an array when present.`);
          } else if (dep.type !== 'api') {
            errors.push(`${p}.endpoints should only be set when type is 'api'.`);
          } else if (dep.endpoints.length > 20) {
            errors.push(`${p}.endpoints has too many items (max 20 — sample representative paths).`);
          } else {
            dep.endpoints.forEach((ep, j) => {
              if (typeof ep !== 'string') {
                errors.push(`${p}.endpoints[${j}] must be a string.`);
                return;
              }
              // Strip optional method prefix (e.g. "POST ") before checking for full URL
              const pathPart = ep.replace(/^(GET|POST|PUT|DELETE|PATCH)\s+/i, '').trim();
              if (pathPart.includes('://') || /^https?:/i.test(pathPart)) {
                errors.push(
                  `${p}.endpoints[${j}] must be a path (e.g. "POST /tasks" or "/tasks"), not a full URL.`,
                );
              }
            });
          }
        }

        if (dep.operations !== undefined) {
          if (!Array.isArray(dep.operations)) {
            errors.push(`${p}.operations must be an array when present.`);
          } else {
            // Allow-list validation (Critical: input validation task 4604f7e1)
            const VALID_OPS = ['read', 'write', 'subscribe', 'publish', 'upsert', 'delete', 'search'];
            dep.operations.forEach((op, j) => {
              if (typeof op !== 'string') {
                errors.push(`${p}.operations[${j}] must be a string.`);
                return;
              }
              if (!VALID_OPS.includes(op)) {
                errors.push(
                  `${p}.operations[${j}] "${op}" must be one of: ${VALID_OPS.join(', ')}`,
                );
              }
            });
          }
        }
      });
    }

    // Validate trustBoundaryMap
    if (!s.trustBoundaryMap || typeof s.trustBoundaryMap !== 'object') {
      errors.push('`surface.trustBoundaryMap` must be an object.');
    } else {
      for (const boundary of VALID_TRUST_BOUNDARIES) {
        if (!Array.isArray(s.trustBoundaryMap[boundary])) {
          errors.push(`\`surface.trustBoundaryMap.${boundary}\` must be an array.`);
        }
      }
    }

    if (!input.reasoning?.trim())
      errors.push('`reasoning` is required.');

    return errors;
  }
}
