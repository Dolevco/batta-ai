/**
 * RepositoryBriefingCompletionTool
 *
 * Completion tool for the repository briefing step.
 * The LLM calls this tool to submit a concise structured overview of the
 * repository — languages, frameworks, structure, service names, deployment
 * targets, and architectural patterns.
 *
 * This briefing is stored on the CodeRepository entity and passed as shared
 * context to all downstream agents so they start with a consistent picture
 * of the repository before diving into service-level analysis.
 *
 * Security:
 *   - No secret values are accepted in any field; validation enforces this
 *     via SECRET_VALUE_PATTERNS.
 *   - All string fields are length-capped to prevent oversized payloads.
 *   - Classification: INTERNAL — no secret values may appear in any field.
 */

import { BaseTool, TaskCompletionCategory } from '@ai-agent/core';
import type { ToolCategory, ToolParameter, ToolResult } from '@ai-agent/core';
import type { RepositoryBriefing } from '@ai-agent/shared';

export interface RepositoryBriefingInput extends Record<string, unknown> {
  repositoryBriefing: RepositoryBriefing;
  reasoning: string;
}

const MAX_STRING_LENGTH = 2000;
const MAX_ARRAY_ITEMS = 50;

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

export class RepositoryBriefingCompletionTool extends BaseTool<RepositoryBriefingInput> {
  name = 'complete_repository_briefing';
  category: ToolCategory = TaskCompletionCategory;
  description =
    'Submit the completed repository briefing. Call ONLY when the repository structure ' +
    'has been fully explored. ' +
    'SECURITY: Do NOT include actual secret values in any field.';

  parameters: ToolParameter[] = [
    {
      name: 'repositoryBriefing',
      description:
        'Structured overview of the repository. Must include:\n' +
        '  summary (1-3 sentences: what the repository delivers end-to-end)\n' +
        '  languages (string[]: primary programming languages, e.g. ["TypeScript", "Python"])\n' +
        '  frameworks (string[]: dominant frameworks/runtimes, e.g. ["Node.js", "Express"])\n' +
        '  buildTools (string[]: build/packaging tools, e.g. ["pnpm", "docker", "webpack"])\n' +
        '  structure (string: high-level layout — monorepo, package names, directories)\n' +
        '  serviceNames (string[]: names of services/packages discovered)\n' +
        '  deploymentTargets (string[]: cloud providers / platforms, e.g. ["Azure Container Apps"])\n' +
        '  architecturalPatterns (string[]: e.g. ["Monorepo", "Microservices", "Event-driven"])',
      required: true,
      type: 'object',
    },
    {
      name: 'reasoning',
      description: 'Brief explanation of which files were read to produce this briefing.',
      required: true,
      type: 'string',
    },
  ];

  async execute(input: RepositoryBriefingInput): Promise<ToolResult> {
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
        `✅ Repository briefing complete: ${input.repositoryBriefing.serviceNames.length} service(s), ` +
        `languages: ${input.repositoryBriefing.languages.join(', ')}`,
      );
      return {
        success: true,
        message: 'Repository briefing complete.',
        requiredOutput: {
          repositoryBriefing: input.repositoryBriefing,
          reasoning: input.reasoning,
        },
      };
    });
  }

  private validate(input: RepositoryBriefingInput): string[] {
    const errors: string[] = [];

    if (!input.repositoryBriefing || typeof input.repositoryBriefing !== 'object') {
      errors.push('`repositoryBriefing` must be an object.');
      return errors;
    }

    const rb = input.repositoryBriefing;

    // Required string fields
    if (!rb.summary?.trim()) errors.push('`repositoryBriefing.summary` is required.');
    else if (rb.summary.length > MAX_STRING_LENGTH) errors.push('`repositoryBriefing.summary` is too long (max 2000 chars).');

    if (!rb.structure?.trim()) errors.push('`repositoryBriefing.structure` is required.');
    else if (rb.structure.length > MAX_STRING_LENGTH) errors.push('`repositoryBriefing.structure` is too long (max 2000 chars).');

    // Required arrays
    if (!Array.isArray(rb.languages) || rb.languages.length === 0) errors.push('`repositoryBriefing.languages` must be a non-empty array.');
    if (!Array.isArray(rb.frameworks)) errors.push('`repositoryBriefing.frameworks` must be an array.');
    if (!Array.isArray(rb.buildTools)) errors.push('`repositoryBriefing.buildTools` must be an array.');
    if (!Array.isArray(rb.serviceNames)) errors.push('`repositoryBriefing.serviceNames` must be an array.');
    if (!Array.isArray(rb.deploymentTargets)) errors.push('`repositoryBriefing.deploymentTargets` must be an array.');
    if (!Array.isArray(rb.architecturalPatterns)) errors.push('`repositoryBriefing.architecturalPatterns` must be an array.');

    // Array length caps
    for (const [field, arr] of Object.entries({
      languages: rb.languages, frameworks: rb.frameworks, buildTools: rb.buildTools,
      serviceNames: rb.serviceNames, deploymentTargets: rb.deploymentTargets,
      architecturalPatterns: rb.architecturalPatterns,
    })) {
      if (Array.isArray(arr) && arr.length > MAX_ARRAY_ITEMS) {
        errors.push(`\`repositoryBriefing.${field}\` has too many items (max ${MAX_ARRAY_ITEMS}).`);
      }
    }

    // Security: check all string values for accidental secret leakage
    const allStringValues = [
      rb.summary, rb.structure,
      ...(Array.isArray(rb.languages) ? rb.languages : []),
      ...(Array.isArray(rb.frameworks) ? rb.frameworks : []),
      ...(Array.isArray(rb.buildTools) ? rb.buildTools : []),
      ...(Array.isArray(rb.serviceNames) ? rb.serviceNames : []),
      ...(Array.isArray(rb.deploymentTargets) ? rb.deploymentTargets : []),
      ...(Array.isArray(rb.architecturalPatterns) ? rb.architecturalPatterns : []),
    ].filter(Boolean) as string[];

    for (const value of allStringValues) {
      if (containsSecret(value)) {
        errors.push('A field appears to contain a secret value. Only include key names and file paths, never actual secrets.');
        break;
      }
    }

    if (!input.reasoning?.trim()) errors.push('`reasoning` is required.');

    return errors;
  }
}
