/**
 * IaCAnalysisCompletionTool
 *
 * Completion tool for the IaC deep-analysis step (Step 0) in
 * ServiceRelationshipsExtractor.
 *
 * The LLM calls this tool once it has fully read an IaC file, to submit:
 *   - deployedServices  – code services the file deploys
 *   - deployedResources – cloud resources the file creates / provisions
 *   - usedResources     – cloud resources the file only references
 *   - namingConventions – patterns observed for resource names
 *   - summary           – one-paragraph human-readable description
 *
 * Security:
 *   - All `evidence` fields are validated against SECRET_VALUE_PATTERNS and
 *     rejected if they look like real secrets (same guard as ExternalDepsCompletionTool).
 *   - String fields are length-capped to prevent prompt-injection payloads from
 *     being stored in the database.
 *   - The tool uses allow-list enum validation on every categorical field.
 */

import { BaseTool, TaskCompletionCategory } from '@ai-agent/core';
import type { ToolCategory, ToolParameter, ToolResult } from '@ai-agent/core';
import type { IaCAnalysis, IaCResourceRef, IaCServiceRef } from '@ai-agent/shared';

// ─── Re-export for convenience ────────────────────────────────────────────────
export type { IaCAnalysis };

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_RESOURCE_TYPES: IaCResourceRef['resourceType'][] = [
  'compute', 'database', 'storage', 'cache', 'queue', 'network', 'identity', 'registry', 'other',
];

const VALID_CLOUD_PROVIDERS: Array<IaCResourceRef['cloudProvider']> = [
  'aws', 'azure', 'gcp', 'other',
];

/** Patterns that indicate a secret value was accidentally included in evidence */
const SECRET_VALUE_PATTERNS = [
  /eyJ[A-Za-z0-9_-]{20,}/, // JWT
  /(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/i, // Stripe-style keys
  /AKIA[0-9A-Z]{16}/, // AWS access key IDs
  /(?:^|[^a-z])([a-f0-9]{40})(?:[^a-f0-9]|$)/, // 40-char hex tokens
  /AccountKey=[A-Za-z0-9+/=]{40,}/, // Azure storage keys
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, // Private keys
];

/** Maximum allowed string length for free-text fields (injection guard) */
const MAX_STRING_LENGTH = 512;

// ─── Input type ───────────────────────────────────────────────────────────────

export interface IaCAnalysisInput extends Record<string, unknown> {
  deployedServices: IaCServiceRef[];
  deployedResources: IaCResourceRef[];
  usedResources: IaCResourceRef[];
  namingConventions: string[];
  summary: string;
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

export class IaCAnalysisCompletionTool extends BaseTool<IaCAnalysisInput> {
  name = 'task_complete';
  category: ToolCategory = TaskCompletionCategory;
  description =
    'Submit the structured IaC analysis for this deployment artifact. ' +
    'Call ONLY when you have fully read the file and are ready to report findings. ' +
    'Empty arrays are valid if the file has no matching items. ' +
    'SECURITY: Do NOT include actual secret values, passwords, or API keys in evidence ' +
    'fields — only reference KEY NAMES and file paths, never values.';

  parameters: ToolParameter[] = [
    {
      name: 'deployedServices',
      description:
        'Array of services this IaC file deploys. Each item: ' +
        '{ name: string (service/container name), imageName?: string (image ref), evidence?: string (config key / line ref — NO secret values) }',
      required: true,
      type: 'array',
    },
    {
      name: 'deployedResources',
      description:
        'Array of cloud resources this IaC file CREATES / PROVISIONS. Each item: ' +
        '{ name: string, resourceType: compute|database|storage|cache|queue|network|identity|registry|other, ' +
        'cloudProvider?: aws|azure|gcp|other, namingPattern?: string, evidence?: string (NO secret values) }',
      required: true,
      type: 'array',
    },
    {
      name: 'usedResources',
      description:
        'Array of cloud resources this IaC file only REFERENCES (does not create). Same shape as deployedResources.',
      required: true,
      type: 'array',
    },
    {
      name: 'namingConventions',
      description:
        'List of naming-convention rules observed in this file, e.g. ' +
        '"Container apps are named {env}-{service}-ca", "All resources share the resource group rg-myapp-{env}". ' +
        'Empty array if no pattern is discernible.',
      required: true,
      type: 'array',
    },
    {
      name: 'summary',
      description: 'One-paragraph plain-English description of what this IaC file does.',
      required: true,
      type: 'string',
    },
  ];

  async execute(input: IaCAnalysisInput): Promise<ToolResult> {
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
        `✅ IaC analysis complete: ` +
        `${input.deployedServices.length} service(s), ` +
        `${input.deployedResources.length} deployed resource(s), ` +
        `${input.usedResources.length} referenced resource(s)`,
      );
      return {
        success: true,
        message: 'IaC analysis complete.',
        requiredOutput: {
          deployedServices: input.deployedServices,
          deployedResources: input.deployedResources,
          usedResources: input.usedResources,
          namingConventions: input.namingConventions,
          summary: input.summary,
        },
      };
    });
  }

  // ── Validation ──────────────────────────────────────────────────────────────

  private validate(input: IaCAnalysisInput): string[] {
    const errors: string[] = [];

    // deployedServices
    if (!Array.isArray(input.deployedServices)) {
      errors.push('`deployedServices` must be an array.');
    } else {
      input.deployedServices.forEach((svc, i) => {
        const p = `deployedServices[${i}]`;
        errors.push(...this.validateServiceRef(svc, p));
      });
    }

    // deployedResources
    if (!Array.isArray(input.deployedResources)) {
      errors.push('`deployedResources` must be an array.');
    } else {
      input.deployedResources.forEach((r, i) => {
        errors.push(...this.validateResourceRef(r, `deployedResources[${i}]`));
      });
    }

    // usedResources
    if (!Array.isArray(input.usedResources)) {
      errors.push('`usedResources` must be an array.');
    } else {
      input.usedResources.forEach((r, i) => {
        errors.push(...this.validateResourceRef(r, `usedResources[${i}]`));
      });
    }

    // namingConventions
    if (!Array.isArray(input.namingConventions)) {
      errors.push('`namingConventions` must be an array.');
    } else {
      input.namingConventions.forEach((nc, i) => {
        if (typeof nc !== 'string' || !nc.trim()) {
          errors.push(`namingConventions[${i}] must be a non-empty string.`);
        } else if (nc.length > MAX_STRING_LENGTH) {
          errors.push(`namingConventions[${i}] exceeds max length (${MAX_STRING_LENGTH}).`);
        }
      });
    }

    // summary
    if (!input.summary?.trim()) {
      errors.push('`summary` is required.');
    } else if (input.summary.length > MAX_STRING_LENGTH * 4) {
      errors.push(`\`summary\` exceeds max length (${MAX_STRING_LENGTH * 4}).`);
    }

    return errors;
  }

  private validateServiceRef(svc: IaCServiceRef, prefix: string): string[] {
    const errors: string[] = [];
    if (!svc.name?.trim()) errors.push(`${prefix}.name is required.`);
    else if (svc.name.length > MAX_STRING_LENGTH) errors.push(`${prefix}.name exceeds max length.`);

    if (svc.imageName !== undefined) {
      if (typeof svc.imageName !== 'string') errors.push(`${prefix}.imageName must be a string.`);
      else if (svc.imageName.length > MAX_STRING_LENGTH) errors.push(`${prefix}.imageName exceeds max length.`);
    }

    if (svc.evidence !== undefined) {
      errors.push(...this.validateEvidence(svc.evidence, `${prefix}.evidence`));
    }
    return errors;
  }

  private validateResourceRef(ref: IaCResourceRef, prefix: string): string[] {
    const errors: string[] = [];

    if (!ref.name?.trim()) errors.push(`${prefix}.name is required.`);
    else if (ref.name.length > MAX_STRING_LENGTH) errors.push(`${prefix}.name exceeds max length.`);

    if (!VALID_RESOURCE_TYPES.includes(ref.resourceType)) {
      errors.push(`${prefix}.resourceType "${ref.resourceType}" must be one of: ${VALID_RESOURCE_TYPES.join(', ')}`);
    }

    if (ref.cloudProvider !== undefined && !VALID_CLOUD_PROVIDERS.includes(ref.cloudProvider)) {
      errors.push(`${prefix}.cloudProvider "${ref.cloudProvider}" must be one of: ${VALID_CLOUD_PROVIDERS.join(', ')}`);
    }

    if (ref.namingPattern !== undefined && ref.namingPattern.length > MAX_STRING_LENGTH) {
      errors.push(`${prefix}.namingPattern exceeds max length.`);
    }

    if (ref.evidence !== undefined) {
      errors.push(...this.validateEvidence(ref.evidence, `${prefix}.evidence`));
    }

    return errors;
  }

  /**
   * Reject evidence fields that look like they contain actual secret values.
   * Also enforce length cap to prevent injection payloads.
   *
   * Security: this is the last line of defence before data reaches the DB.
   */
  private validateEvidence(value: string, fieldPath: string): string[] {
    const errors: string[] = [];

    if (value.length > MAX_STRING_LENGTH) {
      errors.push(`${fieldPath} exceeds max length (${MAX_STRING_LENGTH}).`);
      return errors; // No point checking patterns on truncated value
    }

    for (const pattern of SECRET_VALUE_PATTERNS) {
      if (pattern.test(value)) {
        errors.push(
          `${fieldPath} appears to contain a secret value. ` +
          'Only include KEY NAMES and file paths — never actual values.',
        );
        break;
      }
    }

    return errors;
  }
}
