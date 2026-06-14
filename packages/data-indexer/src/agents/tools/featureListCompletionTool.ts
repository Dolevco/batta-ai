/**
 * FeatureListCompletionTool
 *
 * Completion tool for Step 1 of the business feature extraction pipeline.
 * The LLM calls this tool to submit the list of identified business features
 * (1–5) for a given CodeService.  The tool validates the payload and marks
 * the Task as complete so the caller can extract `requiredOutput`.
 */

import { BaseTool } from '@batta/core';
import { TaskCompletionCategory } from '@batta/core';
import type { ToolCategory, ToolParameter, ToolResult } from '@batta/core';
import type { CorrelationTag } from '@batta/shared';

export interface FeatureDraft {
  name: string;
  description: string;
  businessValue: string;
  userStories: string[];
  technicalSummary: string;
  correlationTags: CorrelationTag[];
}

export interface FeatureListInput extends Record<string, unknown> {
  features: FeatureDraft[];
  reasoning: string;
}

export class FeatureListCompletionTool extends BaseTool<FeatureListInput> {
  name = 'task_complete';
  category: ToolCategory = TaskCompletionCategory;
  description =
    'Submit the list of identified business features (1–5) for this service. ' +
    'Call ONLY when the full list is ready and validated. ' +
    'All fields are required; validation errors will be returned so you can fix and retry.';

  parameters: ToolParameter[] = [
    {
      name: 'features',
      description:
        'Array of 1–5 FeatureDraft objects. Each object MUST contain ALL of these fields:\n' +
        '  name (string, non-empty) — short business-oriented feature name.\n' +
        '  description (string, non-empty) — 1–2 sentence business description.\n' +
        '  businessValue (string, non-empty) — why this feature exists and who benefits.\n' +
        '  userStories (string[], min 1 item) — "As a <role>, I can <action>" sentences.\n' +
        '  technicalSummary (string, non-empty) — key technical components involved.\n' +
        '  correlationTags (array) — each item: { entityType: one of (code_service | cloud_resource | data_store | api_endpoint | external_dependency | identity), keywords: string[] (non-empty) }.',
      required: true,
      type: 'array',
    },
    {
      name: 'reasoning',
      description: 'Brief explanation of how you identified these features (non-empty string).',
      required: true,
      type: 'string',
    },
  ];

  async execute(input: FeatureListInput): Promise<ToolResult> {
    return this.wrapExecution(input, async () => {
      const errors = this.validate(input);
      if (errors.length) {
        return {
          success: false,
          message: `Validation failed – fix these issues and call again:\n${errors.join('\n')}`,
          error: 'VALIDATION_ERROR',
        };
      }
      await this.notify(`✅ Feature list complete: ${input.features.length} features extracted`);
      return {
        success: true,
        message: `Extracted ${input.features.length} business features.`,
        requiredOutput: {
          features: input.features,
          reasoning: input.reasoning,
        },
      };
    });
  }

  private validate(input: FeatureListInput): string[] {
    const errors: string[] = [];
    if (!Array.isArray(input.features)) {
      errors.push('`features` must be an array.');
      return errors;
    }
    if (input.features.length < 1) errors.push('At least 1 feature is required.');
    if (input.features.length > 5) errors.push('At most 5 features are allowed.');

    input.features.forEach((f, i) => {
      const prefix = `features[${i}]`;
      if (!f.name?.trim()) errors.push(`${prefix}.name is required.`);
      if (!f.description?.trim()) errors.push(`${prefix}.description is required.`);
      if (!f.businessValue?.trim()) errors.push(`${prefix}.businessValue is required.`);
      if (!Array.isArray(f.userStories) || f.userStories.length === 0)
        errors.push(`${prefix}.userStories must be a non-empty array.`);
      if (!f.technicalSummary?.trim()) errors.push(`${prefix}.technicalSummary is required.`);
      if (!Array.isArray(f.correlationTags))
        errors.push(`${prefix}.correlationTags must be an array.`);
      f.correlationTags?.forEach((tag, j) => {
        const VALID_ENTITY_TYPES = [
          'code_service',
          'cloud_resource',
          'data_store',
          'api_endpoint',
          'external_dependency',
          'identity',
        ];
        if (!VALID_ENTITY_TYPES.includes(tag.entityType))
          errors.push(
            `${prefix}.correlationTags[${j}].entityType "${tag.entityType}" is not valid. Must be one of: ${VALID_ENTITY_TYPES.join(', ')}`
          );
        if (!Array.isArray(tag.keywords) || tag.keywords.length === 0)
          errors.push(`${prefix}.correlationTags[${j}].keywords must be a non-empty array.`);
      });
    });

    if (!input.reasoning?.trim()) errors.push('`reasoning` is required.');

    return errors;
  }
}
