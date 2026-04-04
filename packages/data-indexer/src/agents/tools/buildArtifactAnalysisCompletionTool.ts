/**
 * BuildArtifactAnalysisCompletionTool
 *
 * Completion tool for the build-artifact deep-analysis step in
 * ServiceRelationshipsExtractor.
 *
 * The LLM calls this tool once it has fully read a build artifact file
 * (Dockerfile, package.json build config, Maven POM, etc.) to submit:
 *   - producedServices  – code services the build artifact produces
 *   - buildTechnology   – build tool / pattern used (e.g. "Docker multi-stage")
 *   - targetRuntime     – runtime / base image for the produced artifact
 *   - buildPatterns     – notable build optimizations or patterns
 *   - summary           – one-paragraph human-readable description
 *
 * Security:
 *   - All `evidence` fields are validated against SECRET_VALUE_PATTERNS and
 *     rejected if they look like real secrets (same guard as IaCAnalysisCompletionTool).
 *   - String fields are length-capped to prevent prompt-injection payloads from
 *     being stored in the database.
 *   - The tool uses allow-list enum validation on every categorical field.
 */

import { BaseTool, TaskCompletionCategory } from '@ai-agent/core';
import type { ToolCategory, ToolParameter, ToolResult } from '@ai-agent/core';
import type { BuildArtifactAnalysis, BuildArtifactServiceRef } from '@ai-agent/shared';

// ─── Re-export for convenience ────────────────────────────────────────────────
export type { BuildArtifactAnalysis };

// ─── Constants ────────────────────────────────────────────────────────────────

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

export interface BuildArtifactAnalysisInput extends Record<string, unknown> {
  producedServices: BuildArtifactServiceRef[];
  buildTechnology: string;
  targetRuntime?: string;
  buildPatterns: string[];
  summary: string;
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

export class BuildArtifactAnalysisCompletionTool extends BaseTool<BuildArtifactAnalysisInput> {
  name = 'task_complete';
  category: ToolCategory = TaskCompletionCategory;
  description =
    'Submit the structured build artifact analysis for this build file. ' +
    'Call ONLY when you have fully read the file and are ready to report findings. ' +
    'Empty arrays are valid if the file has no matching items. ' +
    'SECURITY: Do NOT include actual secret values, passwords, or API keys in evidence ' +
    'fields — only reference KEY NAMES and file paths, never values.';

  parameters: ToolParameter[] = [
    {
      name: 'producedServices',
      description:
        'Array of services this build artifact produces. Each item: ' +
        '{ name: string (service/package name), outputName?: string (image/package output name), ' +
        'runtime?: string (base image or runtime, e.g. "node:20-alpine"), ' +
        'evidence?: string (config key / line ref — NO secret values) }',
      required: true,
      type: 'array',
    },
    {
      name: 'buildTechnology',
      description:
        'The primary build technology or tool used, e.g. "Docker multi-stage", ' +
        '"pnpm build + Docker", "Maven", "Gradle", "npm pack".',
      required: true,
      type: 'string',
    },
    {
      name: 'targetRuntime',
      description:
        'The target runtime or final base image for the produced artifact, ' +
        'e.g. "node:20-alpine", "python:3.11-slim", "distroless/base". Optional.',
      required: false,
      type: 'string',
    },
    {
      name: 'buildPatterns',
      description:
        'List of notable build optimizations or patterns, e.g. ' +
        '"Multi-stage build", "Layer caching via COPY package.json first", "BuildKit secrets mount". ' +
        'Empty array if none are discernible.',
      required: true,
      type: 'array',
    },
    {
      name: 'summary',
      description: 'One-paragraph plain-English description of what this build artifact does.',
      required: true,
      type: 'string',
    },
  ];

  async execute(input: BuildArtifactAnalysisInput): Promise<ToolResult> {
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
        `✅ Build artifact analysis complete: ` +
        `${input.producedServices.length} service(s) produced, ` +
        `technology: ${input.buildTechnology}`,
      );
      return {
        success: true,
        message: 'Build artifact analysis complete.',
        requiredOutput: {
          producedServices: input.producedServices,
          buildTechnology: input.buildTechnology,
          targetRuntime: input.targetRuntime,
          buildPatterns: input.buildPatterns,
          summary: input.summary,
        },
      };
    });
  }

  // ── Validation ──────────────────────────────────────────────────────────────

  private validate(input: BuildArtifactAnalysisInput): string[] {
    const errors: string[] = [];

    // producedServices
    if (!Array.isArray(input.producedServices)) {
      errors.push('`producedServices` must be an array.');
    } else {
      input.producedServices.forEach((svc, i) => {
        errors.push(...this.validateServiceRef(svc, `producedServices[${i}]`));
      });
    }

    // buildTechnology
    if (!input.buildTechnology?.trim()) {
      errors.push('`buildTechnology` is required.');
    } else if (input.buildTechnology.length > MAX_STRING_LENGTH) {
      errors.push(`\`buildTechnology\` exceeds max length (${MAX_STRING_LENGTH}).`);
    }

    // targetRuntime (optional)
    if (input.targetRuntime !== undefined) {
      if (typeof input.targetRuntime !== 'string') {
        errors.push('`targetRuntime` must be a string.');
      } else if (input.targetRuntime.length > MAX_STRING_LENGTH) {
        errors.push(`\`targetRuntime\` exceeds max length (${MAX_STRING_LENGTH}).`);
      }
    }

    // buildPatterns
    if (!Array.isArray(input.buildPatterns)) {
      errors.push('`buildPatterns` must be an array.');
    } else {
      input.buildPatterns.forEach((p, i) => {
        if (typeof p !== 'string' || !p.trim()) {
          errors.push(`buildPatterns[${i}] must be a non-empty string.`);
        } else if (p.length > MAX_STRING_LENGTH) {
          errors.push(`buildPatterns[${i}] exceeds max length (${MAX_STRING_LENGTH}).`);
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

  private validateServiceRef(svc: BuildArtifactServiceRef, prefix: string): string[] {
    const errors: string[] = [];

    if (!svc.name?.trim()) {
      errors.push(`${prefix}.name is required.`);
    } else if (svc.name.length > MAX_STRING_LENGTH) {
      errors.push(`${prefix}.name exceeds max length.`);
    }

    if (svc.outputName !== undefined) {
      if (typeof svc.outputName !== 'string') {
        errors.push(`${prefix}.outputName must be a string.`);
      } else if (svc.outputName.length > MAX_STRING_LENGTH) {
        errors.push(`${prefix}.outputName exceeds max length.`);
      }
    }

    if (svc.runtime !== undefined) {
      if (typeof svc.runtime !== 'string') {
        errors.push(`${prefix}.runtime must be a string.`);
      } else if (svc.runtime.length > MAX_STRING_LENGTH) {
        errors.push(`${prefix}.runtime exceeds max length.`);
      }
    }

    if (svc.evidence !== undefined) {
      errors.push(...this.validateEvidence(svc.evidence, `${prefix}.evidence`));
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
