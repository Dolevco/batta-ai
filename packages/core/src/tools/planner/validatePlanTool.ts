import { BaseTool } from '../baseTool';
import { PLANNER_CATEGORY } from './';
import { ToolParameter, ToolResult } from '../types';

export interface ValidatePlanParams extends Record<string, unknown> {
  /** Whether the author (LLM) considers the plan valid */
  isPlanValid: boolean;
  /** Short explanation for the plan-level decision */
  explanation?: string;
  /** Array of per-step validation results */
  steps: Array<{
    id: string;
    isStepValid: boolean;
    explanation?: string;
  }>;
}

/**
 * Tool that validates the structure of a plan-validation result provided by the LLM.
 *
 * This tool does NOT perform content heuristics. Instead it verifies that the
 * caller provided the expected parameters and that they are consistent:
 * - `isPlanValid` (boolean)
 * - `explanation` (string, optional)
 * - `steps` (array of { id, isStepValid, explanation })
 *
 * The tool succeeds (ToolResult.success = true) only when `isPlanValid` is true
 * and all steps are marked `isStepValid: true`. Otherwise it returns success=false
 * and includes detailed invalid step explanations in the result.
 */

export const ValidatePlanToolName = 'validate_plan';

export class ValidatePlanTool extends BaseTool<ValidatePlanParams> {
  name = ValidatePlanToolName;
  // Keep same category as other planner tools so planner can use it
  category = PLANNER_CATEGORY;
  description = 'Validate that the plan is valid and can execute successfully';

  parameters: ToolParameter[] = [
    {
      name: 'isPlanValid',
      description: 'Boolean indicating whether the plan is valid',
      required: true,
      type: 'boolean'
    },
    {
      name: 'explanation',
      description: 'Optional human-readable explanation for the plan-level decision',
      required: false,
      type: 'string'
    },
    {
      name: 'steps',
      description: 'Array of per-step validation results: { id, isStepValid, explanation }',
      required: true,
      type: 'object'
    }
  ];

  constructor() {
    super();
  }

  async execute(params: ValidatePlanParams): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      // Basic parameter validation
      if (typeof params.isPlanValid !== 'boolean') {
        return {
          success: false,
          error: 'Invalid parameters',
          message: 'isPlanValid must be a boolean'
        };
      }

      if (!Array.isArray(params.steps)) {
        return {
          success: false,
          error: 'Invalid parameters',
          message: 'steps must be an array of { id, isStepValid, explanation? }'
        };
      }

      const steps = params.steps;
      const normalizedSteps: Array<{ id: string; isStepValid: boolean; explanation: string }> = [];
      const invalidStepEntries: string[] = [];

      for (let i = 0; i < steps.length; i++) {
        const s = steps[i] as any;
        if (!s || typeof s.id !== 'string') {
          invalidStepEntries.push(`Step ${i}: missing or invalid 'id'`);
          continue;
        }
        if (typeof s.isStepValid !== 'boolean') {
          invalidStepEntries.push(`Step ${s.id || i}: missing or invalid 'isStepValid'`);
          continue;
        }
        const explanation = typeof s.explanation === 'string' ? s.explanation : '';
        normalizedSteps.push({ id: s.id, isStepValid: s.isStepValid, explanation });
      }

      // Build an aggregated list of invalid steps (parsed invalid steps + parse errors)
      const parsedInvalidSteps = normalizedSteps
        .filter(s => !s.isStepValid)
        .map(s => ({ id: s.id, explanation: s.explanation || 'no explanation' }));

      const parseErrorEntries = invalidStepEntries.map((m, i) => ({ id: `invalid_entry_${i}`, explanation: m }));
      const allInvalidSteps = [...parsedInvalidSteps, ...parseErrorEntries];

      if (invalidStepEntries.length > 0) {
        return {
          success: false,
          error: 'Invalid step entries',
          message: 'One or more steps are missing required fields or have invalid types',
          result: {
            isPlanValid: false,
            explanation: 'Invalid steps format',
            steps: normalizedSteps,
            invalidStepEntries,
            invalidSteps: allInvalidSteps
          }
        };
      }

      // Determine validity consistency
      const planClaimsValid = params.isPlanValid === true;
      const invalidSteps = normalizedSteps.filter(s => !s.isStepValid);

      // If the plan is claimed valid but contains invalid steps, return failure
      if (planClaimsValid && invalidSteps.length > 0) {
        const invalidExplanations = invalidSteps.map(s => `Step ${s.id}: ${s.explanation || 'no explanation'}`);
        const explanation = `Plan marked valid but contains invalid steps: ${invalidExplanations.join(' | ')}`;
        return {
          success: false,
          error: 'Plan validation mismatch',
          message: explanation,
          result: {
            isPlanValid: false,
            explanation,
            steps: normalizedSteps,
            invalidSteps: allInvalidSteps
          }
        };
      }

      // If plan is not valid, return failure with provided explanations
      if (!planClaimsValid) {
        const explanation = params.explanation ?? 'Plan marked as invalid by validator';
        return {
          success: false,
          error: 'Plan invalid',
          message: explanation,
          result: {
            isPlanValid: false,
            explanation,
            steps: normalizedSteps,
            invalidSteps: allInvalidSteps
          }
        };
      }

      // Plan is valid and no invalid steps
      const explanation = params.explanation ?? 'Plan and all steps marked valid';
      return {
        success: true,
        result: {
          isPlanValid: true,
          explanation,
          steps: normalizedSteps,
          invalidSteps: []
        },
        message: explanation
      };
    });
  }
}
