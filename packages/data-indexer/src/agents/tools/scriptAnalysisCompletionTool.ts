/**
 * ScriptAnalysisCompletionTool
 *
 * Completion tool for the script analysis step (Step 0.5 — new) in
 * ServiceRelationshipsExtractor.
 *
 * The LLM calls this tool once it has fully analysed a build or deployment
 * script to submit structured findings covering both the build side
 * (producedServices, buildTechnology) and the deployment side
 * (deployedServices, deployedResources, deploymentTargets).
 *
 * Security:
 *   - All evidence fields are validated against SECRET_VALUE_PATTERNS and
 *     rejected if they look like real secrets (same guard as IaCAnalysisCompletionTool).
 *   - String fields are length-capped (MAX_STRING_LENGTH) against injection payloads.
 *   - The tool uses allow-list validation on every categorical field.
 *   - deploymentTargets values are length-capped to prevent excessively long
 *     resource group names from being stored (max 90 chars per Azure limits).
 */

import { BaseTool, TaskCompletionCategory } from '@batta/core';
import type { ToolCategory, ToolParameter, ToolResult } from '@batta/core';
import type { ScriptAnalysisServiceRef, IaCResourceRef } from '@batta/shared';

// ─── Re-export for convenience ────────────────────────────────────────────────

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

/** Azure resource group name max length */
const MAX_RG_NAME_LENGTH = 90;

// ─── Input type ───────────────────────────────────────────────────────────────

export interface ScriptAnalysisInput extends Record<string, unknown> {
  producedServices: ScriptAnalysisServiceRef[];
  buildTechnology?: string;
  targetRuntime?: string;
  buildPatterns: string[];
  deployedServices: ScriptAnalysisServiceRef[];
  deployedResources: IaCResourceRef[];
  usedResources: IaCResourceRef[];
  deploymentTargets: {
    resourceGroups?: string[];
    subscriptionIds?: string[];
    regions?: string[];
  };
  namingConventions: string[];
  summary: string;
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

export class ScriptAnalysisCompletionTool extends BaseTool<ScriptAnalysisInput> {
  name = 'task_complete';
  category: ToolCategory = TaskCompletionCategory;
  description =
    'Submit the structured script analysis for this build or deployment script. ' +
    'Call ONLY when you have fully read the script and are ready to report findings. ' +
    'Empty arrays are valid if the script has no matching items. ' +
    'SECURITY: Do NOT include actual secret values, passwords, or API keys in evidence ' +
    'fields — only reference KEY NAMES, CLI flag names, and file paths, never values.';

  parameters: ToolParameter[] = [
    {
      name: 'producedServices',
      description:
        'Services BUILT by this script. Each item: ' +
        '{ name: string (from -t flag), outputName?: string (full image ref), ' +
        'sourceDirectory?: string (build context path), evidence?: string (NO secret values) }',
      required: true,
      type: 'array',
    },
    {
      name: 'buildTechnology',
      description: 'Build technology used, e.g. "docker build", "npm run build", "cargo build". Omit if not a build script.',
      required: false,
      type: 'string',
    },
    {
      name: 'targetRuntime',
      description: 'Target runtime or base image, e.g. "node:20-alpine". Omit if unknown.',
      required: false,
      type: 'string',
    },
    {
      name: 'buildPatterns',
      description: 'Notable build patterns, e.g. ["multi-stage", "layer caching"]. Empty array if none.',
      required: true,
      type: 'array',
    },
    {
      name: 'deployedServices',
      description:
        'Services DEPLOYED by this script (e.g. from az containerapp update --name …). Each item: ' +
        '{ name: string (from --name flag), imageName?: string (from --image flag), evidence?: string (NO secret values) }',
      required: true,
      type: 'array',
    },
    {
      name: 'deployedResources',
      description:
        'Cloud resources CREATED by this script (az resource create, terraform apply). Same shape as IaC deployedResources: ' +
        '{ name, resourceType: compute|database|storage|cache|queue|network|identity|registry|other, ' +
        'cloudProvider?: aws|azure|gcp|other, namingPattern?, evidence? (NO secret values) }',
      required: true,
      type: 'array',
    },
    {
      name: 'usedResources',
      description: 'Cloud resources REFERENCED but not created by this script. Same shape as deployedResources.',
      required: true,
      type: 'array',
    },
    {
      name: 'deploymentTargets',
      description:
        'Deployment target scope extracted from CLI arguments. ' +
        '{ resourceGroups?: string[] (from --resource-group), ' +
        'subscriptionIds?: string[] (from --subscription), ' +
        'regions?: string[] (from --location) }. ' +
        'Resolve bash variables first: RG="rg-prod" → --resource-group $RG → "rg-prod".',
      required: true,
      type: 'object',
    },
    {
      name: 'namingConventions',
      description:
        'Naming patterns observed across extracted names, e.g. "Resources prefixed with env-". ' +
        'Empty array if none observed.',
      required: true,
      type: 'array',
    },
    {
      name: 'summary',
      description: 'One-paragraph plain-English description of what this script does.',
      required: true,
      type: 'string',
    },
  ];

  async execute(input: ScriptAnalysisInput): Promise<ToolResult> {
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
        `✅ Script analysis complete: ` +
        `${input.producedServices.length} produced service(s), ` +
        `${input.deployedServices.length} deployed service(s), ` +
        `${input.deployedResources.length} deployed resource(s), ` +
        `RGs: ${(input.deploymentTargets?.resourceGroups ?? []).join(', ') || 'none'}`,
      );
      return {
        success: true,
        message: 'Script analysis complete.',
        requiredOutput: {
          producedServices: input.producedServices,
          buildTechnology: input.buildTechnology,
          targetRuntime: input.targetRuntime,
          buildPatterns: input.buildPatterns,
          deployedServices: input.deployedServices,
          deployedResources: input.deployedResources,
          usedResources: input.usedResources,
          deploymentTargets: input.deploymentTargets,
          namingConventions: input.namingConventions,
          summary: input.summary,
        },
      };
    });
  }

  // ── Validation ──────────────────────────────────────────────────────────────

  private validate(input: ScriptAnalysisInput): string[] {
    const errors: string[] = [];

    // producedServices
    if (!Array.isArray(input.producedServices)) {
      errors.push('`producedServices` must be an array.');
    } else {
      input.producedServices.forEach((s, i) =>
        errors.push(...this.validateServiceRef(s, `producedServices[${i}]`)));
    }

    // buildTechnology (optional)
    if (input.buildTechnology !== undefined) {
      if (typeof input.buildTechnology !== 'string') {
        errors.push('`buildTechnology` must be a string.');
      } else if (input.buildTechnology.length > MAX_STRING_LENGTH) {
        errors.push('`buildTechnology` exceeds max length.');
      }
    }

    // targetRuntime (optional)
    if (input.targetRuntime !== undefined) {
      if (typeof input.targetRuntime !== 'string') {
        errors.push('`targetRuntime` must be a string.');
      } else if (input.targetRuntime.length > MAX_STRING_LENGTH) {
        errors.push('`targetRuntime` exceeds max length.');
      }
    }

    // buildPatterns
    if (!Array.isArray(input.buildPatterns)) {
      errors.push('`buildPatterns` must be an array.');
    } else {
      input.buildPatterns.forEach((p, i) => {
        if (typeof p !== 'string' || !p.trim()) errors.push(`buildPatterns[${i}] must be a non-empty string.`);
        else if (p.length > MAX_STRING_LENGTH) errors.push(`buildPatterns[${i}] exceeds max length.`);
      });
    }

    // deployedServices
    if (!Array.isArray(input.deployedServices)) {
      errors.push('`deployedServices` must be an array.');
    } else {
      input.deployedServices.forEach((s, i) =>
        errors.push(...this.validateServiceRef(s, `deployedServices[${i}]`)));
    }

    // deployedResources
    if (!Array.isArray(input.deployedResources)) {
      errors.push('`deployedResources` must be an array.');
    } else {
      input.deployedResources.forEach((r, i) =>
        errors.push(...this.validateResourceRef(r, `deployedResources[${i}]`)));
    }

    // usedResources
    if (!Array.isArray(input.usedResources)) {
      errors.push('`usedResources` must be an array.');
    } else {
      input.usedResources.forEach((r, i) =>
        errors.push(...this.validateResourceRef(r, `usedResources[${i}]`)));
    }

    // deploymentTargets
    if (!input.deploymentTargets || typeof input.deploymentTargets !== 'object') {
      errors.push('`deploymentTargets` must be an object.');
    } else {
      const dt = input.deploymentTargets as any;
      for (const field of ['resourceGroups', 'subscriptionIds', 'regions']) {
        if (dt[field] !== undefined) {
          if (!Array.isArray(dt[field])) {
            errors.push(`deploymentTargets.${field} must be an array.`);
          } else {
            dt[field].forEach((v: unknown, i: number) => {
              if (typeof v !== 'string' || !v.trim()) {
                errors.push(`deploymentTargets.${field}[${i}] must be a non-empty string.`);
              } else if (v.length > MAX_RG_NAME_LENGTH) {
                errors.push(`deploymentTargets.${field}[${i}] exceeds max length (${MAX_RG_NAME_LENGTH}).`);
              }
            });
          }
        }
      }
    }

    // namingConventions
    if (!Array.isArray(input.namingConventions)) {
      errors.push('`namingConventions` must be an array.');
    } else {
      input.namingConventions.forEach((nc, i) => {
        if (typeof nc !== 'string' || !nc.trim()) errors.push(`namingConventions[${i}] must be a non-empty string.`);
        else if (nc.length > MAX_STRING_LENGTH) errors.push(`namingConventions[${i}] exceeds max length.`);
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

  private validateServiceRef(svc: ScriptAnalysisServiceRef, prefix: string): string[] {
    const errors: string[] = [];
    if (!svc.name?.trim()) errors.push(`${prefix}.name is required.`);
    else if (svc.name.length > MAX_STRING_LENGTH) errors.push(`${prefix}.name exceeds max length.`);

    for (const f of ['outputName', 'sourceDirectory', 'imageName'] as const) {
      if (svc[f] !== undefined) {
        if (typeof svc[f] !== 'string') errors.push(`${prefix}.${f} must be a string.`);
        else if ((svc[f] as string).length > MAX_STRING_LENGTH) errors.push(`${prefix}.${f} exceeds max length.`);
      }
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
   * Security: last line of defence before data reaches the DB.
   */
  private validateEvidence(value: string, fieldPath: string): string[] {
    const errors: string[] = [];

    if (value.length > MAX_STRING_LENGTH) {
      errors.push(`${fieldPath} exceeds max length (${MAX_STRING_LENGTH}).`);
      return errors;
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
