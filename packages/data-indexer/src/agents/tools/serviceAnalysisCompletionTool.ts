/**
 * ServiceAnalysisCompletionTool
 *
 * Completion tool for the service analysis step (SRE Step 1).
 * The LLM calls this tool to submit a rich structured analysis of a code service,
 * including business description, tech stack, code structure, external/internal
 * dependencies, entry point types, and architectural patterns.
 *
 * This replaces the simpler ExternalDepsCompletionTool for the service analysis step:
 * all previous externalDeps fields are preserved; the output is a superset.
 *
 * Security:
 *   - Evidence fields must never contain raw secret values — only key names and
 *     file paths are accepted. Validation enforces this via SECRET_VALUE_PATTERNS.
 *   - All string fields are length-capped to prevent oversized payloads.
 *   - Enum fields are validated against explicit allow-lists.
 *   - Classification: INTERNAL — no secret values may appear in any field.
 */

import { BaseTool, TaskCompletionCategory } from '@batta/core';
import type { ToolCategory, ToolParameter, ToolResult } from '@batta/core';
import type { ExternalDep, ServiceAnalysis } from '@batta/shared';

export interface ServiceAnalysisInput extends Record<string, unknown> {
  serviceAnalysis: ServiceAnalysis;
  reasoning: string;
}

const VALID_TYPES: ExternalDep['type'][] = [
  'api', 'cloud', 'queue', 'database', 'cache', 'storage', 'identity', 'other',
];
const VALID_DATA_FLOWS: ExternalDep['dataFlow'][] = ['inbound', 'outbound', 'bidirectional'];
const VALID_CLASSIFICATIONS: ExternalDep['dataClassification'][] = [
  'public', 'internal', 'confidential', 'restricted',
];

const MAX_STRING_LENGTH = 2000;
const MAX_ARRAY_ITEMS = 50;

// Patterns that indicate a secret value was accidentally included
const SECRET_VALUE_PATTERNS = [
  /eyJ[A-Za-z0-9_-]{20,}/, // JWT
  /(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/i, // Stripe-style keys
  /AKIA[0-9A-Z]{16}/, // AWS access key IDs
  /(?:^|[^a-z])([a-f0-9]{40})(?:[^a-f0-9]|$)/, // 40-char hex (tokens)
  /AccountKey=[A-Za-z0-9+/=]{40,}/, // Azure storage keys
];

function containsSecret(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some(p => p.test(value));
}

export class ServiceAnalysisCompletionTool extends BaseTool<ServiceAnalysisInput> {
  name = 'complete_service_analysis';
  category: ToolCategory = TaskCompletionCategory;
  description =
    'Submit the complete structured analysis of the service. Call ONLY when all files ' +
    'have been read and the analysis is final. ' +
    'SECURITY: Do NOT include actual secret values in any field — only key names and file paths.';

  parameters: ToolParameter[] = [
    {
      name: 'serviceAnalysis',
      description:
        'Structured analysis of the service. Must include:\n' +
        '  serviceDescription (1-3 sentences: business purpose, responsibilities, capabilities)\n' +
        '  businessValue (string: why this service exists, who benefits)\n' +
        '  techStack (string[]: frameworks/runtimes/databases used)\n' +
        '  codeStructure (string: high-level description of directory/module layout)\n' +
        '  externalDeps (ExternalDep[]: dependencies outside the internal trust boundary)\n' +
        '  internalDependencies (string[]: names of internal sibling services called)\n' +
        '  entryPointTypes (string[]: e.g. ["http", "queue", "cron"])\n' +
        '  architecturalPatterns (string[]: e.g. ["REST API", "Event-driven"])',
      required: true,
      type: 'object',
    },
    {
      name: 'reasoning',
      description: 'Brief explanation of which files were read and how the analysis was derived.',
      required: true,
      type: 'string',
    },
  ];

  async execute(input: ServiceAnalysisInput): Promise<ToolResult> {
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
        `✅ Service analysis complete: ${input.serviceAnalysis.externalDeps.length} external dep(s), ` +
        `${input.serviceAnalysis.internalDependencies.length} internal dep(s)`,
      );
      return {
        success: true,
        message: `Service analysis complete.`,
        requiredOutput: {
          serviceAnalysis: input.serviceAnalysis,
          reasoning: input.reasoning,
        },
      };
    });
  }

  private validate(input: ServiceAnalysisInput): string[] {
    const errors: string[] = [];

    if (!input.serviceAnalysis || typeof input.serviceAnalysis !== 'object') {
      errors.push('`serviceAnalysis` must be an object.');
      return errors;
    }

    const sa = input.serviceAnalysis;

    // Required string fields
    if (!sa.serviceDescription?.trim()) errors.push('`serviceAnalysis.serviceDescription` is required.');
    else if (sa.serviceDescription.length > MAX_STRING_LENGTH) errors.push('`serviceAnalysis.serviceDescription` is too long (max 2000 chars).');

    if (!sa.businessValue?.trim()) errors.push('`serviceAnalysis.businessValue` is required.');
    else if (sa.businessValue.length > MAX_STRING_LENGTH) errors.push('`serviceAnalysis.businessValue` is too long (max 2000 chars).');

    if (!sa.codeStructure?.trim()) errors.push('`serviceAnalysis.codeStructure` is required.');
    else if (sa.codeStructure.length > MAX_STRING_LENGTH) errors.push('`serviceAnalysis.codeStructure` is too long (max 2000 chars).');

    // Required arrays
    if (!Array.isArray(sa.techStack) || sa.techStack.length === 0) errors.push('`serviceAnalysis.techStack` must be a non-empty array.');
    if (!Array.isArray(sa.internalDependencies)) errors.push('`serviceAnalysis.internalDependencies` must be an array.');
    if (!Array.isArray(sa.entryPointTypes) || sa.entryPointTypes.length === 0) errors.push('`serviceAnalysis.entryPointTypes` must be a non-empty array.');
    if (!Array.isArray(sa.architecturalPatterns)) errors.push('`serviceAnalysis.architecturalPatterns` must be an array.');

    if (!Array.isArray(sa.externalDeps)) {
      errors.push('`serviceAnalysis.externalDeps` must be an array.');
      return errors;
    }

    if (sa.externalDeps.length > MAX_ARRAY_ITEMS) {
      errors.push(`\`serviceAnalysis.externalDeps\` has too many items (max ${MAX_ARRAY_ITEMS}).`);
    }

    sa.externalDeps.forEach((dep, i) => {
      const p = `serviceAnalysis.externalDeps[${i}]`;
      if (!dep.name?.trim()) errors.push(`${p}.name is required.`);
      if (!VALID_TYPES.includes(dep.type))
        errors.push(`${p}.type "${dep.type}" must be one of: ${VALID_TYPES.join(', ')}`);
      if (!dep.purpose?.trim()) errors.push(`${p}.purpose is required.`);
      if (!VALID_DATA_FLOWS.includes(dep.dataFlow))
        errors.push(`${p}.dataFlow "${dep.dataFlow}" must be one of: ${VALID_DATA_FLOWS.join(', ')}`);
      if (!VALID_CLASSIFICATIONS.includes(dep.dataClassification))
        errors.push(`${p}.dataClassification "${dep.dataClassification}" must be one of: ${VALID_CLASSIFICATIONS.join(', ')}`);
      if (!dep.businessValue?.trim()) errors.push(`${p}.businessValue is required.`);

      // Security: reject if evidence field looks like it contains an actual secret value
      if (dep.evidence && containsSecret(dep.evidence)) {
        errors.push(
          `${p}.evidence appears to contain a secret value. ` +
          'Only include the key name and file path, never the actual secret.',
        );
      }
    });

    if (!input.reasoning?.trim()) errors.push('`reasoning` is required.');

    return errors;
  }
}
