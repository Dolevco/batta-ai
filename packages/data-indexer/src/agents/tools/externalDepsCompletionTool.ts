/**
 * ExternalDepsCompletionTool
 *
 * Completion tool for the external-dependencies extraction step.
 * The LLM calls this tool to submit the list of external dependencies
 * (services/APIs/cloud resources outside the internal boundary) for a
 * given CodeService.  The tool validates the payload and marks the Task
 * as complete so the caller can extract `requiredOutput`.
 *
 * Security: evidence fields must never contain raw secret values — only
 * key names and file paths are accepted. Validation enforces this by
 * rejecting common secret patterns.
 */

import { BaseTool, TaskCompletionCategory } from '@ai-agent/core';
import type { ToolCategory, ToolParameter, ToolResult } from '@ai-agent/core';
import type { ExternalDep } from '@ai-agent/shared';

export interface ExternalDepsInput extends Record<string, unknown> {
  externalDeps: ExternalDep[];
  serviceDescription: string;
  reasoning: string;
}

const VALID_TYPES: ExternalDep['type'][] = [
  'api', 'cloud', 'queue', 'database', 'cache', 'storage', 'identity', 'other',
];
const VALID_DATA_FLOWS: ExternalDep['dataFlow'][] = ['inbound', 'outbound', 'bidirectional'];
const VALID_CLASSIFICATIONS: ExternalDep['dataClassification'][] = [
  'public', 'internal', 'confidential', 'restricted',
];

// Patterns that indicate a secret value was accidentally included
const SECRET_VALUE_PATTERNS = [
  /eyJ[A-Za-z0-9_-]{20,}/, // JWT
  /(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/i, // Stripe-style keys
  /AKIA[0-9A-Z]{16}/, // AWS access key IDs
  /(?:^|[^a-z])([a-f0-9]{40})(?:[^a-f0-9]|$)/, // 40-char hex (tokens)
  /AccountKey=[A-Za-z0-9+/=]{40,}/, // Azure storage keys
];

export class ExternalDepsCompletionTool extends BaseTool<ExternalDepsInput> {
  name = 'task_complete';
  category: ToolCategory = TaskCompletionCategory;
  description =
    'Submit the list of external dependencies (those outside the internal trust boundary) ' +
    'for this service. Call ONLY when all files have been read and the list is final. ' +
    'An empty array is valid if no external deps were found. ' +
    'SECURITY: Do NOT include actual secret values in the evidence field — only key names.';

  parameters: ToolParameter[] = [
    {
      name: 'externalDeps',
      description:
        'Array of ExternalDep objects. Each object MUST contain:\n' +
        '  name (string, non-empty)\n' +
        '  type: api | cloud | queue | database | cache | storage | identity | other\n' +
        '  purpose (string, non-empty)\n' +
        '  dataFlow: inbound | outbound | bidirectional\n' +
        '  dataClassification: public | internal | confidential | restricted\n' +
        '  businessValue (string, non-empty)\n' +
        'Optional: protocol (string), evidence (key name + file path only — NO secret values)',
      required: true,
      type: 'array',
    },
    {
      name: 'serviceDescription',
      description:
        '1-3 sentence description of what this service does — its business purpose, ' +
        'primary responsibilities, and key capabilities. Derived from reading the source code. ' +
        'Be concrete: name the domain, key operations, and any notable patterns.',
      required: true,
      type: 'string',
    },
    {
      name: 'reasoning',
      description: 'Brief explanation of how external deps were identified (non-empty string).',
      required: true,
      type: 'string',
    },
  ];

  async execute(input: ExternalDepsInput): Promise<ToolResult> {
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
        `✅ External deps complete: ${input.externalDeps.length} deps extracted`
      );
      return {
        success: true,
        message: `Extracted ${input.externalDeps.length} external dependencies.`,
        requiredOutput: {
          externalDeps: input.externalDeps,
          serviceDescription: input.serviceDescription,
          reasoning: input.reasoning,
        },
      };
    });
  }

  private validate(input: ExternalDepsInput): string[] {
    const errors: string[] = [];

    if (!Array.isArray(input.externalDeps)) {
      errors.push('`externalDeps` must be an array.');
      return errors;
    }

    input.externalDeps.forEach((dep, i) => {
      const p = `externalDeps[${i}]`;
      if (!dep.name?.trim()) errors.push(`${p}.name is required.`);
      if (!VALID_TYPES.includes(dep.type))
        errors.push(`${p}.type "${dep.type}" must be one of: ${VALID_TYPES.join(', ')}`);
      if (!dep.purpose?.trim()) errors.push(`${p}.purpose is required.`);
      if (!VALID_DATA_FLOWS.includes(dep.dataFlow))
        errors.push(`${p}.dataFlow "${dep.dataFlow}" must be one of: ${VALID_DATA_FLOWS.join(', ')}`);
      if (!VALID_CLASSIFICATIONS.includes(dep.dataClassification))
        errors.push(
          `${p}.dataClassification "${dep.dataClassification}" must be one of: ${VALID_CLASSIFICATIONS.join(', ')}`
        );
      if (!dep.businessValue?.trim()) errors.push(`${p}.businessValue is required.`);

      // Security: reject if evidence field looks like it contains an actual secret value
      if (dep.evidence) {
        for (const pattern of SECRET_VALUE_PATTERNS) {
          if (pattern.test(dep.evidence)) {
            errors.push(
              `${p}.evidence appears to contain a secret value. ` +
                'Only include the key name and file path, never the actual secret.'
            );
            break;
          }
        }
      }
    });

    if (!input.serviceDescription?.trim()) errors.push('`serviceDescription` is required.');
    if (!input.reasoning?.trim()) errors.push('`reasoning` is required.');
    return errors;
  }
}
