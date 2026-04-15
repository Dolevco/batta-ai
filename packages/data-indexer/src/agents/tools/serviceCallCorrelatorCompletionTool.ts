/**
 * ServiceCallCorrelatorCompletionTool
 *
 * Completion tool for the ServiceCallCorrelatorAgent (Step 2.6 disambiguation).
 * Called when the LLM has resolved which provider a consumer is calling in an
 * ambiguous or zero-match case (no deterministic path match was possible).
 *
 * Input (structured data only — no file reading needed):
 *   consumerId  — EntityId of the calling service
 *   providerId  — EntityId of the service being called
 *   matchedPaths — URL paths that match (may be empty if resolved by reasoning alone)
 *   confidence  — 'high' | 'medium' | 'low'
 *   reasoning   — why this provider was chosen
 *
 * Security:
 *   - Inputs contain only service IDs (non-secret structural data) and path strings.
 *   - consumerId and providerId are validated to be non-empty strings.
 *   - matchedPaths are validated to be path-only strings (no full URLs).
 *   - Classification: INTERNAL — no secret values.
 */

import { BaseTool, TaskCompletionCategory } from '@ai-agent/core';
import type { ToolCategory, ToolParameter, ToolResult } from '@ai-agent/core';

export interface ServiceCallCorrelationInput extends Record<string, unknown> {
  consumerId: string;
  providerId: string;
  matchedPaths: string[];
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

const VALID_CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;

export class ServiceCallCorrelatorCompletionTool extends BaseTool<ServiceCallCorrelationInput> {
  name = 'complete_service_call_correlation';
  category: ToolCategory = TaskCompletionCategory;
  description =
    'Submit the result of disambiguating which service is the provider for a given consumer ' +
    'ExternalDep. Call this after reasoning about the candidate providers.';

  parameters: ToolParameter[] = [
    {
      name: 'consumerId',
      description: 'EntityId of the calling (consumer) service.',
      required: true,
      type: 'string',
    },
    {
      name: 'providerId',
      description: 'EntityId of the service being called (provider). Must be one of the candidate IDs.',
      required: true,
      type: 'string',
    },
    {
      name: 'matchedPaths',
      description:
        'URL paths (optionally prefixed with HTTP method) that were matched, ' +
        'e.g. ["POST /tasks", "GET /tasks/:id"]. May be empty if resolved by reasoning alone.',
      required: true,
      type: 'array',
    },
    {
      name: 'confidence',
      description: 'Confidence level: "high" | "medium" | "low".',
      required: true,
      type: 'string',
    },
    {
      name: 'reasoning',
      description: 'Brief explanation of why this provider was chosen.',
      required: true,
      type: 'string',
    },
  ];

  async execute(input: ServiceCallCorrelationInput): Promise<ToolResult> {
    return this.wrapExecution(input, async () => {
      const errors = this.validate(input);
      if (errors.length) {
        return {
          success: false,
          message: `Validation failed:\n${errors.join('\n')}`,
          error: 'VALIDATION_ERROR',
        };
      }
      await this.notify(
        `✅ Service call correlated: consumer=${input.consumerId} → provider=${input.providerId} ` +
        `(confidence=${input.confidence}, ${input.matchedPaths.length} matched path(s))`,
      );
      return {
        success: true,
        message: `Service call correlation complete: ${input.matchedPaths.length} matched path(s).`,
        requiredOutput: input,
      };
    });
  }

  private validate(input: ServiceCallCorrelationInput): string[] {
    const errors: string[] = [];

    if (!input.consumerId?.trim()) errors.push('`consumerId` is required.');
    if (!input.providerId?.trim()) errors.push('`providerId` is required.');

    if (!Array.isArray(input.matchedPaths)) {
      errors.push('`matchedPaths` must be an array.');
    } else {
      // Validate that paths are not full URLs (Critical: input validation security task)
      input.matchedPaths.forEach((p, i) => {
        if (typeof p !== 'string') {
          errors.push(`matchedPaths[${i}] must be a string.`);
          return;
        }
        const pathPart = p.replace(/^(GET|POST|PUT|DELETE|PATCH)\s+/i, '').trim();
        if (pathPart.includes('://') || /^https?:/i.test(pathPart)) {
          errors.push(`matchedPaths[${i}] must be a path, not a full URL.`);
        }
      });
    }

    if (!VALID_CONFIDENCE_LEVELS.includes(input.confidence as typeof VALID_CONFIDENCE_LEVELS[number])) {
      errors.push(`\`confidence\` "${input.confidence}" must be one of: ${VALID_CONFIDENCE_LEVELS.join(', ')}`);
    }

    if (!input.reasoning?.trim()) errors.push('`reasoning` is required.');

    return errors;
  }
}
