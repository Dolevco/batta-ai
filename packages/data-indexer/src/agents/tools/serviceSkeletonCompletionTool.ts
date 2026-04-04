/**
 * ServiceSkeletonCompletionTool
 *
 * Completion tool for the ServiceSkeletonExtractor agent (Pass 1).
 * The LLM calls this tool to submit a structured skeleton of a service,
 * reading only the high-signal priority files identified in the file map.
 *
 * The skeleton replaces the old ServiceAnalyzer for the "shape" pass and
 * feeds into:
 *   - ServiceSurfaceExtractor as orientation context (Pass 2)
 *   - FeatureListExtractor as pre-built context (Pass 3)
 *   - DfdExtractor as pre-built context (Pass 4)
 *
 * Security:
 *   - No secret values allowed in any field.
 *   - Evidence fields must only contain key names and file paths.
 *   - Classification: INTERNAL.
 */

import { BaseTool, TaskCompletionCategory } from '@ai-agent/core';
import type { ToolCategory, ToolParameter, ToolResult } from '@ai-agent/core';
import type { ServiceSkeleton } from '@ai-agent/shared';

export interface ServiceSkeletonInput extends Record<string, unknown> {
  skeleton: ServiceSkeleton;
  reasoning: string;
}

const MAX_STRING_LENGTH = 2000;
const MAX_ARRAY_ITEMS = 50;
const MAX_ENDPOINTS = 100;

export class ServiceSkeletonCompletionTool extends BaseTool<ServiceSkeletonInput> {
  name = 'complete_service_skeleton';
  category: ToolCategory = TaskCompletionCategory;
  description =
    'Submit the structural skeleton of the service. Call ONLY after reading the priority ' +
    'files from the file map. ' +
    'SECURITY: Do NOT include secret values — only key names and file paths in evidence.';

  parameters: ToolParameter[] = [
    {
      name: 'skeleton',
      description:
        'ServiceSkeleton object with:\n' +
        '  serviceDescription  (string) — 1–3 sentence business description\n' +
        '  businessValue       (string) — why this service exists, who benefits\n' +
        '  entryPointTypes     (string[]) — "http" | "queue" | "cron" | "cli" | "other"\n' +
        '  architecturalPatterns (string[]) — e.g. ["REST API", "Event-driven"]\n' +
        '  techStack           (string[]) — frameworks/runtimes/databases in use\n' +
        '  exposedEndpoints    (array) — each: { method, path, file }\n' +
        '  dataModels          (string[]) — domain model names\n' +
        '  internalDependencies (string[]) — sibling service package names',
      required: true,
      type: 'object',
    },
    {
      name: 'reasoning',
      description: 'Brief explanation of how the skeleton was derived (non-empty string).',
      required: true,
      type: 'string',
    },
  ];

  async execute(input: ServiceSkeletonInput): Promise<ToolResult> {
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
        `✅ Skeleton complete: ${input.skeleton.exposedEndpoints.length} endpoint(s), ` +
        `${input.skeleton.dataModels.length} model(s), ` +
        `tech: ${input.skeleton.techStack.slice(0, 3).join(', ')}`,
      );
      return {
        success: true,
        message: `Service skeleton complete.`,
        requiredOutput: {
          skeleton: input.skeleton,
          reasoning: input.reasoning,
        },
      };
    });
  }

  private validate(input: ServiceSkeletonInput): string[] {
    const errors: string[] = [];

    if (!input.skeleton || typeof input.skeleton !== 'object') {
      errors.push('`skeleton` must be an object.');
      return errors;
    }

    const sk = input.skeleton;

    if (!sk.serviceDescription?.trim())
      errors.push('`skeleton.serviceDescription` is required.');
    else if (sk.serviceDescription.length > MAX_STRING_LENGTH)
      errors.push('`skeleton.serviceDescription` is too long (max 2000 chars).');

    if (!sk.businessValue?.trim())
      errors.push('`skeleton.businessValue` is required.');
    else if (sk.businessValue.length > MAX_STRING_LENGTH)
      errors.push('`skeleton.businessValue` is too long (max 2000 chars).');

    if (!Array.isArray(sk.entryPointTypes) || sk.entryPointTypes.length === 0)
      errors.push('`skeleton.entryPointTypes` must be a non-empty array.');

    if (!Array.isArray(sk.architecturalPatterns))
      errors.push('`skeleton.architecturalPatterns` must be an array.');

    if (!Array.isArray(sk.techStack) || sk.techStack.length === 0)
      errors.push('`skeleton.techStack` must be a non-empty array.');
    else if (sk.techStack.length > MAX_ARRAY_ITEMS)
      errors.push(`\`skeleton.techStack\` has too many items (max ${MAX_ARRAY_ITEMS}).`);

    if (!Array.isArray(sk.exposedEndpoints))
      errors.push('`skeleton.exposedEndpoints` must be an array.');
    else if (sk.exposedEndpoints.length > MAX_ENDPOINTS)
      errors.push(`\`skeleton.exposedEndpoints\` has too many items (max ${MAX_ENDPOINTS}).`);
    else {
      sk.exposedEndpoints.forEach((ep, i) => {
        if (!ep.method?.trim()) errors.push(`\`skeleton.exposedEndpoints[${i}].method\` is required.`);
        if (!ep.path?.trim()) errors.push(`\`skeleton.exposedEndpoints[${i}].path\` is required.`);
        if (!ep.file?.trim()) errors.push(`\`skeleton.exposedEndpoints[${i}].file\` is required.`);
      });
    }

    if (!Array.isArray(sk.dataModels))
      errors.push('`skeleton.dataModels` must be an array.');

    if (!Array.isArray(sk.internalDependencies))
      errors.push('`skeleton.internalDependencies` must be an array.');

    if (!input.reasoning?.trim())
      errors.push('`reasoning` is required.');

    return errors;
  }
}
