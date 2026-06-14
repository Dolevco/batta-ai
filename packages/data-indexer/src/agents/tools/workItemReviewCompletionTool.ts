/**
 * WorkItemReviewCompletionTool
 *
 * Completion tool for the work item review agent.
 * The LLM calls this tool to submit its structured questionnaire answers after
 * reasoning over the Jira issue context.
 *
 * Security:
 *   - No raw issue descriptions or comments stored — only structured answers.
 *   - All string fields are length-capped to prevent oversized payloads.
 *   - Classification: INTERNAL — no secret values may appear in any field.
 */

import { BaseTool, TaskCompletionCategory } from '@batta/core';
import type { ToolCategory, ToolParameter, ToolResult } from '@batta/core';
import type { SecurityReviewAnswer } from '@batta/shared';

export class WorkItemReviewCompletionTool extends BaseTool<Record<string, unknown>> {
  name = 'submit_work_item_review';
  category: ToolCategory = TaskCompletionCategory;
  description =
    'Call this when you have finished reasoning over all questions. ' +
    'Submits structured answers for the work item security review. ' +
    'Do NOT call this until you have addressed every question.';

  parameters: ToolParameter[] = [
    {
      name: 'answers',
      description:
        'Array of answer objects. Each must have: questionId (string), answer ("yes"|"no"|"unknown"), ' +
        'rationale (string, 1-2 sentences), evidence (string[], max 5 short phrases), ' +
        'confidence ("high"|"medium"|"low").',
      required: true,
      type: 'array',
    },
  ];

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return this.wrapExecution(input, async () => {
      if (!Array.isArray(input.answers) || input.answers.length === 0) {
        return {
          success: false,
          message: '`answers` must be a non-empty array.',
          error: 'VALIDATION_ERROR',
        };
      }

      const answers = this.normaliseAnswers(input.answers);

      await this.notify(
        `✅ Work item review answers submitted: ${answers.length} question(s) answered.`,
      );

      return {
        success: true,
        message: 'Work item review answers submitted.',
        requiredOutput: { answers } as unknown as Record<string, unknown>,
      };
    });
  }

  private normaliseAnswers(raw: unknown[]): SecurityReviewAnswer[] {
    const VALID_ANSWERS = ['yes', 'no', 'unknown'];
    const VALID_CONFIDENCE = ['high', 'medium', 'low'];

    return raw.slice(0, 50).map((a: any) => ({
      questionId: String(a.questionId ?? '').trim().slice(0, 100),
      answer: VALID_ANSWERS.includes(String(a.answer ?? '').toLowerCase())
        ? String(a.answer).toLowerCase()
        : 'unknown',
      rationale: a.rationale ? String(a.rationale).trim().slice(0, 1000) : undefined,
      evidence: Array.isArray(a.evidence)
        ? a.evidence.slice(0, 5).map((e: unknown) => String(e).trim().slice(0, 200))
        : undefined,
      confidence: VALID_CONFIDENCE.includes(a.confidence) ? a.confidence : undefined,
    }));
  }
}
