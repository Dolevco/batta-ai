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

import { BaseTool, TaskCompletionCategory } from '@ai-agent/core';
import type { ToolCategory, ToolParameter, ToolResult } from '@ai-agent/core';
import type { ExternalDep, ServiceExternalSurface } from '@ai-agent/shared';

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
        '  externalDeps[]       — each dep: { name, type, purpose, dataFlow, dataClassification, businessValue, evidence }\n' +
        '    type values: api | cloud | queue | database | cache | storage | identity | other\n' +
        '    dataFlow values: inbound | outbound | bidirectional\n' +
        '    dataClassification: public | internal | confidential | restricted\n' +
        '    evidence: env var KEY NAME(s) and/or import/package name — NO secret values\n' +
        '  trustBoundaryMap     — { IDENTITY: string[], DATA: string[], EXTERNAL: string[], INTERNET: string[], SERVICE: string[] }\n' +
        '    Each dep.name should appear in exactly one boundary list',
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
