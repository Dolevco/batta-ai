/**
 * PRValidationCompletionTool
 *
 * Completion tool for the PR validation agent.
 * The LLM calls this tool to submit its structured validation report after
 * reviewing each security answer against the cloned PR branch code.
 *
 * Security:
 *   - No source code or diff content is stored — only the LLM-generated report.
 *   - All string fields are length-capped to prevent oversized payloads.
 *   - Classification: INTERNAL — no secret values may appear in any field.
 */

import { BaseTool, TaskCompletionCategory } from '@ai-agent/core';
import type { ToolCategory, ToolParameter, ToolResult } from '@ai-agent/core';
import type { PRValidationReport } from '@ai-agent/shared';

export class PRValidationCompletionTool extends BaseTool<Record<string, unknown>> {
  name = 'submit_pr_validation_report';
  category: ToolCategory = TaskCompletionCategory;
  description =
    'Call this when you have finished reviewing all security answers. ' +
    'Submits the structured validation report. Do NOT call this until ' +
    'you have checked every question/answer pair.';

  parameters: ToolParameter[] = [
    {
      name: 'overallOutcome',
      description: '"clean" — all answers confirmed; "attention" — some disputed or unverifiable; "critical" — disputed answers with security impact.',
      required: true,
      type: 'string',
    },
    {
      name: 'executiveSummary',
      description: '2–4 sentence summary of the validation result.',
      required: true,
      type: 'string',
    },
    {
      name: 'findings',
      description: 'Array of per-question validation findings.',
      required: true,
      type: 'array',
    },
    {
      name: 'additionalRisks',
      description: 'Security risks found in the PR code that were NOT mentioned in the agent answers.',
      required: true,
      type: 'array',
    },
    {
      name: 'filesReviewed',
      description: 'Total number of source files read during validation.',
      required: true,
      type: 'number',
    },
    {
      name: 'linesReviewed',
      description: 'Approximate total lines of code reviewed.',
      required: true,
      type: 'number',
    },
  ];

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return this.wrapExecution(input, async () => {
      const errors = this.validate(input);
      if (errors.length) {
        return {
          success: false,
          message: `Validation failed – fix these issues and call again:\n${errors.join('\n')}`,
          error: 'VALIDATION_ERROR',
        };
      }

      const report = this.buildReport(input);

      await this.notify(
        `✅ PR validation complete: outcome=${report.overallOutcome}, ` +
        `findings=${report.findings.length}, additionalRisks=${report.additionalRisks.length}`,
      );

      return {
        success: true,
        message: 'PR validation report submitted.',
        requiredOutput: report as unknown as Record<string, unknown>,
      };
    });
  }

  private buildReport(input: Record<string, unknown>): PRValidationReport {
    return {
      status:           'completed',
      overallOutcome:   input.overallOutcome as PRValidationReport['overallOutcome'],
      executiveSummary: String(input.executiveSummary ?? '').slice(0, 2000),
      findings:         this.normaliseFindings(input.findings),
      additionalRisks:  this.normaliseAdditionalRisks(input.additionalRisks),
      filesReviewed:    Number(input.filesReviewed ?? 0),
      linesReviewed:    Number(input.linesReviewed ?? 0),
      validatedAt:      new Date().toISOString(),
    };
  }

  private normaliseFindings(raw: unknown): PRValidationReport['findings'] {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 200).map((f: any) => ({
      questionId:    String(f.questionId   ?? '').slice(0, 100),
      questionText:  String(f.questionText ?? '').slice(0, 500),
      agentAnswer:   String(f.agentAnswer  ?? '').slice(0, 1000),
      outcome:       (['confirmed', 'disputed', 'unverifiable'] as const).includes(f.outcome)
        ? f.outcome
        : 'unverifiable',
      rationale:     String(f.rationale    ?? '').slice(0, 2000),
      relevantFiles: Array.isArray(f.relevantFiles)
        ? f.relevantFiles.slice(0, 50).map((p: unknown) => String(p).slice(0, 500))
        : [],
    }));
  }

  private normaliseAdditionalRisks(raw: unknown): PRValidationReport['additionalRisks'] {
    if (!Array.isArray(raw)) return [];
    const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
    return raw
      .slice(0, 50)
      .map((r: any) => ({
        severity:      VALID_SEVERITIES.includes(r.severity) ? r.severity : 'medium',
        title:         String(r.title       ?? '').trim().slice(0, 200),
        description:   String(r.description ?? '').trim().slice(0, 2000),
        relevantFiles: Array.isArray(r.relevantFiles)
          ? r.relevantFiles.slice(0, 50).map((p: unknown) => String(p).slice(0, 500))
          : [],
      }))
      .filter(r => r.title.length > 0 && r.description.length > 0);
  }

  private validate(input: Record<string, unknown>): string[] {
    const errors: string[] = [];

    const validOutcomes = ['clean', 'attention', 'critical'];
    if (!validOutcomes.includes(input.overallOutcome as string)) {
      errors.push(`\`overallOutcome\` must be one of: ${validOutcomes.join(', ')}.`);
    }

    if (!input.executiveSummary || typeof input.executiveSummary !== 'string' || !input.executiveSummary.trim()) {
      errors.push('`executiveSummary` is required and must be a non-empty string.');
    }

    if (!Array.isArray(input.findings)) {
      errors.push('`findings` must be an array.');
    } else {
      input.findings.forEach((f: any, i: number) => {
        if (!f.questionId) errors.push(`findings[${i}].questionId is required.`);
        if (!f.outcome || !['confirmed', 'disputed', 'unverifiable'].includes(f.outcome)) {
          errors.push(`findings[${i}].outcome must be confirmed | disputed | unverifiable.`);
        }
        if (!f.rationale) errors.push(`findings[${i}].rationale is required.`);
      });
    }

    if (!Array.isArray(input.additionalRisks)) {
      errors.push('`additionalRisks` must be an array (can be empty).');
    }

    if (typeof input.filesReviewed !== 'number' || input.filesReviewed < 0) {
      errors.push('`filesReviewed` must be a non-negative number.');
    }

    if (typeof input.linesReviewed !== 'number' || input.linesReviewed < 0) {
      errors.push('`linesReviewed` must be a non-negative number.');
    }

    return errors;
  }
}
