import { DelegateToolParams } from '../../tools/delegation';

/**
 * A sub-task in a plan, matching the delegate tool params schema
 */
export interface PlannedSubTask extends DelegateToolParams {
  /** Indices of sub-tasks this depends on (empty if none) */
  dependsOn: number[];
  /** Optional code integration ID for coding tasks */
  codeIntegrationId?: string;
  /** Required outputs mapping key -> description that this step must provide in metadata */
  requiredOutputs?: Record<string, string>;
  /**
   * Required inputs mapping key -> description that this step needs from its dependencies.
   * This field is mandatory (may be an empty object) and will be validated against the
   * requiredOutputs of the dependent sub-tasks.
   */
  requiredInputs: Record<string, string>;
  /**
   * Explanation why specific tools/code repository were chosen and how they will be used
   * to complete the sub-task. This should include why tools are needed, which repo
   * (if any) will be used and the intended usage plan.
   */
  reason: string;
  /**
   * Detailed execution plan: step-by-step explanation of how to achieve the expectedOutput
   * given the provided context, inputs and available tools. This should be a clear,
   * actionable description that an executor (human or agent) can follow to complete the sub-task.
   */
  executionPlan: string;
}

/**
 * A stored plan for task decomposition
 */
export interface StoredPlan {
  task: string;
  description: string;
  message: string;
  /** The sub-tasks to execute */
  subTasks: PlannedSubTask[];
  /** When the plan was created */
  createdAt: string;
}

/**
 * Result of plan execution
 */
export interface PlanResult {
  success: boolean;
  results: SubTaskResult[];
  error?: string;
}

/**
 * Result from a single sub-task execution
 */
export interface SubTaskResult {
  index: number;
  success: boolean;
  result: string;
  error?: string;
  /** Optional structured metadata (e.g., repositoryName for dynamic code integration) */
  requiredOutput?: {
    repositoryName?: string;
    [key: string]: unknown;
  };
}

/**
 * Configuration for the task planner
 */
export interface PlannerConfig {
  /** LLM temperature for plan generation (default: 0 for consistency) */
  temperature?: number;
  /** Minimum similarity score to reuse a cached plan (default: 0.85) */
  similarityThreshold?: number;
  /** Maximum sub-tasks per plan (default: 10) */
  maxSubTasks?: number;
}
