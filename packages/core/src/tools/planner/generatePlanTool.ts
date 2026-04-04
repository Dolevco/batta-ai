import { BaseTool } from '../baseTool';
import { Tool, ToolCategory, ToolParameter, ToolResult } from '../types';
import { DelegationLimits, CodeIntegrationInfo, DYNAMIC_CODE_INTEGRATION } from '../delegation';
import { StoredPlan, PlannedSubTask } from '../../task/planner/types';
import { PlanMemory } from '../../task/planner/planMemory';
import { PLANNER_CATEGORY } from '.';
import { TaskCompletionCategory } from '../task/taskCompletionTool';

export interface GeneratePlanParams extends Record<string, unknown> {
  taskDescription: string;
  message: string;
  planDescription: string;
  subTasks: Array<PlannedSubTask>;
}

/**
 * Tool that generates and validates a task plan.
 * 
 * The LLM provides the sub-tasks, this tool validates the schema
 * and stores the plan in memory for reuse.
 */
export class GeneratePlanTool extends BaseTool<GeneratePlanParams> {
  name = 'generate_plan';
  category = TaskCompletionCategory;
  description = `Generate a plan to break down a complex task into focused sub-tasks`;

  parameters: ToolParameter[] = [
    {
      name: 'taskDescription',
      description: 'The original task description being planned',
      required: true,
      type: 'string'
    },
    {
      name: 'planDescription',
      description: 'Plan high level short description of the steps',
      required: true,
      type: 'string'
    },
    {
      name: 'message',
      description: 'Message to send to the user. use it to explain on the created plan if created successfuly',
      required: true,
      type: 'string'
    },
    {
      name: 'subTasks',
      description: `Array of sub-tasks. Each sub-task must have:
- name (string, required): unique readable name for the sub task
- toolsCategories (array, required): Array of tool categories names (NOT tool names). to use code tools, you MUST specify the codeIntegrationId
- intent (string, required): Single goal that includes both action AND analysis
- expectedOutput (string, required): Fully Analyzed/summarized result description, that can be used by another agent without any other context.
- anticipatedSteps (number, required): Estimated steps (1-${DelegationLimits.MAX_ANTICIPATED_STEPS}, default: 5)
- dependsOn (array, optional): Array of sub-task indices this depends on (default: [])
- codeIntegrationId (string, optional): ID of code integration to use for coding tasks. this will add the code tools category. when using code integration, this field required (not optional). Use '${DYNAMIC_CODE_INTEGRATION}' to select repository dynamically from a previous step's output (the previous step must provide repositoryName in its requiredOutputs)
- requiredOutputs (object, required): Mapping of result keys to descriptions that MUST be provided by this step for dependent steps (e.g., {"repositoryName": "the repository to use in next step, format owner/name", "detailedData": "This is the full data needed for..." }). make sure it's aligned with the intent and we provide the expected results.
- requiredInputs (object, required (may be empty)): Mapping of input keys to descriptions that this step requires from its dependencies' requiredOutputs. Each key MUST be provided by at least one of the sub-tasks listed in dependsOn.
- reason (string, required): why it is seperated step and tools selection explanation. if the code integration selected, detailed explaination why the specific repository has been selected and why we 100% sure this is the right repository out of all (you MUST quote the explicit repository ask). make sure we do not guess the repository name.
- executionPlan (string, required): Detailed, step-by-step execution plan describing how to achieve the expectedOutput given the provided context, inputs and available tools. This should be actionable and clear enough for an executor (human or agent) to follow.`,
      required: true,
      type: 'object'
    }
  ];

  private readonly planMemory: PlanMemory;
  private readonly availableToolsCategories: ToolCategory[];
  private readonly maxSubTasks: number;
  private readonly codeIntegrations: CodeIntegrationInfo[];

  constructor(
    planMemory: PlanMemory,
    availableTools: Tool[],
    maxSubTasks: number = 10,
    codeIntegrations: CodeIntegrationInfo[] = []
  ) {
    super();
    this.planMemory = planMemory;
    this.availableToolsCategories = Array.from(
      new Map(availableTools.map(t => [t.category.name, t.category])).values()
    );
    this.maxSubTasks = maxSubTasks;
    this.codeIntegrations = codeIntegrations;
  }

  async execute(params: GeneratePlanParams): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      const { taskDescription, subTasks } = params;

      // Validate sub-tasks array
      /*if (!Array.isArray(subTasks) || subTasks.length === 0) {
        return {
          success: false,
          error: 'subTasks must be a non-empty array',
          message: 'Please provide at least one sub-task'
        };
      }*/

      if (subTasks.length > this.maxSubTasks) {
        return {
          success: false,
          error: `Too many sub-tasks (${subTasks.length}). Maximum is ${this.maxSubTasks}`,
          message: `Break down into ${this.maxSubTasks} or fewer comprehensive sub-tasks`
        };
      }

      // Validate and normalize each sub-task
      const validatedSubTasks: PlannedSubTask[] = [];
      const errors: string[] = [];

      for (let i = 0; i < subTasks.length; i++) {
        const st = subTasks[i];
        const prefix = `Sub-task ${i}:`;

        // Validate required fields
        if (!st.intent || typeof st.intent !== 'string') {
          errors.push(`${prefix} missing or invalid 'intent'`);
          continue;
        }

        if (!st.name || typeof st.name !== 'string') {
          errors.push(`${prefix} missing or invalid 'name'`);
          continue;
        }

        if (!st.expectedOutput || typeof st.expectedOutput !== 'string') {
          errors.push(`${prefix} missing or invalid 'expectedOutput'`);
          continue;
        }

        if (!Array.isArray(st.toolsCategories) || st.toolsCategories.length === 0) {
          errors.push(`${prefix} 'toolsCategories' must be a non-empty array`);
          continue;
        }

        // Validate tool names exist
        if (st.toolsCategories.includes('code') && !st.codeIntegrationId) {
          st.codeIntegrationId = 'dynamic';
        }

        // Check if 'code' category is used with other categories
        if (st.toolsCategories.includes('code') && st.toolsCategories.length > 1) {
          errors.push(
            `${prefix} 'code' tool category must be used alone. ` +
            `When using code tools, no other tool categories are allowed. consider spliting to multiple steps` +
            `Found additional categories: ${st.toolsCategories.filter(t => t !== 'code').join(', ')}`
          );
          continue;
        }

        const invalidTools = st.toolsCategories.filter(
          t => !this.availableToolsCategories.some(atc => atc.name === t) && !(t.toLowerCase() === 'code' && st.codeIntegrationId)); // code category could be included if codeIntegrationId specified
        if (invalidTools.length > 0) {
          if (invalidTools.includes('code')) {
            errors.push('to use code tools, you MUST specify the codeIntegrationId');
          } else {
            errors.push(`${prefix} unknown tools categories: ${invalidTools.join(', ')}`);
          }
          continue;
        }

        if (st.toolsCategories.length === 0) {
          errors.push(`Step must have at least one tools category`);
          continue;
        }

        // Validate dependencies
        const dependsOn = st.dependsOn ?? [];
        if (!Array.isArray(dependsOn)) {
          errors.push(`${prefix} 'dependsOn' must be an array`);
          continue;
        }

        const invalidDeps = dependsOn.filter(d => d < 0 || d >= i);
        if (invalidDeps.length > 0) {
          errors.push(`${prefix} invalid dependencies: ${invalidDeps.join(', ')} (must reference earlier sub-tasks)`);
          continue;
        }

        // Validate anticipated steps
        const anticipatedSteps = st.anticipatedSteps ?? 5;
        if (anticipatedSteps < 1 || anticipatedSteps > DelegationLimits.MAX_ANTICIPATED_STEPS) {
          errors.push(`${prefix} anticipatedSteps must be 1-${DelegationLimits.MAX_ANTICIPATED_STEPS}`);
          continue;
        }

        // Validate code integration if provided
        if (st.codeIntegrationId) {
          if (typeof st.codeIntegrationId !== 'string') {
            errors.push(`${prefix} 'codeIntegrationId' must be a string`);
            continue;
          }
          // Allow 'dynamic' or valid code integration IDs
          if (st.codeIntegrationId !== DYNAMIC_CODE_INTEGRATION && 
              !this.codeIntegrations.some(ci => ci.id === st.codeIntegrationId)) {
            errors.push(`${prefix} unknown codeIntegrationId: ${st.codeIntegrationId}`);
            continue;
          }

          // Validate code integration usage based on dependencies
          const isFirstStep = dependsOn.length === 0;
          const usesCodeTools = st.toolsCategories.includes('code');

          if (usesCodeTools || st.codeIntegrationId) {
            if (isFirstStep) {
              // First step with code tools MUST specify a concrete repository (not dynamic)
              if (st.codeIntegrationId === DYNAMIC_CODE_INTEGRATION) {
                errors.push(
                  `${prefix} is the first step using code tools and MUST specify a concrete repository. ` +
                  `Use a specific 'codeIntegrationId' from the available integrations instead of '${DYNAMIC_CODE_INTEGRATION}'. ` +
                  `Only subsequent steps that depend on a previous step can use '${DYNAMIC_CODE_INTEGRATION}' ` +
                  `if that previous step provides 'repositoryName' in its requiredOutputs.`
                );
                continue;
              }
            } else {
              // Non-first step with code tools
              if (st.codeIntegrationId !== DYNAMIC_CODE_INTEGRATION) {
                // If using a concrete repository, should have a strong reason (will be validated in reason field)
                errors.push(
                    `codeIntegrationId '${DYNAMIC_CODE_INTEGRATION}' MUST be used when the step is not the first one. ` +
                    `make sure  (steps [${dependsOn.join(', ')}]) provide 'repositoryName' in their requiredOutputs.`
                  );
              } else {
                // If dynamic, ensure there's at least one dependency to provide the repo name
                const hasRepoNameDependency = dependsOn.some(d => {
                  const dep = subTasks[d];
                  return dep && dep.requiredOutputs && typeof dep.requiredOutputs === 'object' && 
                         Object.prototype.hasOwnProperty.call(dep.requiredOutputs, 'repositoryName');
                });

                if (!hasRepoNameDependency) {
                  errors.push(
                    `${prefix} uses codeIntegrationId '${DYNAMIC_CODE_INTEGRATION}' but none of its dependencies ` +
                    `(steps [${dependsOn.join(', ')}]) provide 'repositoryName' in their requiredOutputs. `
                  );
                  continue;
                }
              }
            }
          }
        }

        // Validate requiredOutputs if provided (now an object mapping key->description)
        const requiredOutputs = st.requiredOutputs ?? {};
        if (requiredOutputs && typeof requiredOutputs !== 'object') {
          errors.push(`${prefix} 'requiredOutputs' must be an object mapping key->description`);
          continue;
        }

        // Validate requiredInputs (mandatory, may be empty object) and ensure dependencies provide them
        const requiredInputs = st.requiredInputs ?? {};
        if (requiredInputs === undefined || requiredInputs === null || typeof requiredInputs !== 'object') {
          errors.push(`${prefix} 'requiredInputs' must be an object mapping key->description (may be empty)`);
          continue;
        }

        const reqInputKeys = Object.keys(requiredInputs);
        if (reqInputKeys.length > 0) {
          if (!Array.isArray(dependsOn) || dependsOn.length === 0) {
            errors.push(`${prefix} has requiredInputs but no dependencies to satisfy them`);
            continue;
          }

          const missingInputs = reqInputKeys.filter(key => !dependsOn.some(d => {
            const dep = subTasks[d];
            return dep && dep.requiredOutputs && typeof dep.requiredOutputs === 'object' && Object.prototype.hasOwnProperty.call(dep.requiredOutputs, key);
          }));

          if (missingInputs.length > 0) {
            errors.push(`${prefix} requiredInputs not satisfied by dependencies requiredOutput: ${missingInputs.join(', ')}`);
            continue;
          }
        }

        // Validate reason field: why tools/repo chosen and how they'll be used
        if (!st.reason || typeof st.reason !== 'string') {
          errors.push(`${prefix} missing or invalid 'reason' (explain why tools/repo chosen and how they'll be used)`);
          continue;
        }

        // Validate executionPlan: required detailed steps for execution
        if (!st.executionPlan || typeof st.executionPlan !== 'string') {
          errors.push(`${prefix} missing or invalid 'executionPlan' (detailed actionable steps required)`);
          continue;
        }

        validatedSubTasks.push({
          id: st.name.replace(/ /g, '_'),
          name: st.name.replace(/_/g, ' '),
          toolsCategories: st.toolsCategories,
          tools: [],
          taskType: 'delegating',
          intent: st.intent,
          context: st.executionPlan,
          expectedOutput: st.expectedOutput,
          anticipatedSteps,
          dependsOn,
          ...(st.codeIntegrationId && { codeIntegrationId: st.codeIntegrationId }),
          ...(Object.keys(requiredOutputs || {}).length > 0 && { requiredOutputs }),
          requiredInputs,
          reason: st.reason,
          executionPlan: st.executionPlan
        });
      }

      if (errors.length > 0) {
        return {
          success: false,
          error: 'Plan validation failed',
          message: `Validation errors:\n${errors.join('\n')}`
        };
      }

      // Validate no cycles in dependencies
      try {
        this.validateNoCycles(validatedSubTasks);
      } catch (err) {
        return {
          success: false,
          error: 'Cycle detected in sub-task dependencies',
          message: err instanceof Error ? err.message : 'Please ensure dependsOn references do not create circular dependencies'
        };
      }

      try {
        this.validateConnected(validatedSubTasks);
      } catch (err) {
        return {
          success: false,
          error: 'Disconnected sub-tasks',
          message: err instanceof Error ? err.message : 'Ensure all sub-tasks are connected via dependsOn relationships'
        };
      }

      try {
        this.validateNoConsecutiveMergeableSteps(validatedSubTasks);
      } catch (err) {
        return {
          success: false,
          error: 'Consecutive steps should be merged',
          message: err instanceof Error ? err.message : 'Merge consecutive dependent steps using the same or fewer tools'
        };
      }

      const plan: StoredPlan = {
        task: params.taskDescription,
        description: params.planDescription,
        message: params.message ?? '',
        subTasks: validatedSubTasks,
        createdAt: new Date().toISOString()
      };

      // Store the plan
      await this.planMemory.storePlan(taskDescription, plan);

      return {
        success: true,
        result: plan,
        message: `Plan generated with ${validatedSubTasks.length} sub-tasks`
      };
    });
  }

  private validateNoCycles(subTasks: PlannedSubTask[]): void {
    const inDegree = subTasks.map(t => t.dependsOn.length);
    const completed = new Set<number>();

    while (completed.size < subTasks.length) {
      const ready = subTasks
        .map((_, i) => i)
        .filter(i => !completed.has(i) && inDegree[i] === 0);

      if (!ready.length) {
        throw new Error('Circular dependency detected in plan');
      }

      for (const i of ready) {
        completed.add(i);
        subTasks.forEach((t, j) => {
          if (t.dependsOn.includes(i)) {
            inDegree[j]--;
          }
        });
      }
    }
  }

  private validateConnected(subTasks: PlannedSubTask[]): void {
    // A single or empty list is trivially connected
    if (subTasks.length <= 1) return;

    // Build undirected adjacency from dependsOn relationships
    const adj: Set<number>[] = subTasks.map(() => new Set<number>());
    subTasks.forEach((t, i) => {
      (t.dependsOn || []).forEach(dep => {
        // dependsOn should reference valid indices lower than i (validated earlier)
        if (typeof dep === 'number' && dep >= 0 && dep < subTasks.length) {
          adj[i].add(dep);
          adj[dep].add(i);
        }
      });
    });

    // BFS/DFS from the first node
    const visited = new Set<number>();
    const stack = [0];
    visited.add(0);

    while (stack.length) {
      const cur = stack.pop() as number;
      for (const nb of adj[cur]) {
        if (!visited.has(nb)) {
          visited.add(nb);
          stack.push(nb);
        }
      }
    }

    if (visited.size !== subTasks.length) {
      throw new Error(`Sub-tasks are not connected: only ${visited.size}/${subTasks.length} are reachable. Ensure each sub-task connects to others via dependsOn to form a single connected plan`);
    }
  }

  private validateNoConsecutiveMergeableSteps(subTasks: PlannedSubTask[]): void {
    // Check for consecutive dependent steps that use the same or fewer tools
    for (let i = 0; i < subTasks.length; i++) {
      const currentTask = subTasks[i];
      const dependencies = currentTask.dependsOn || [];
      
      // For each direct dependency, check if tools overlap suggests they should be merged
      for (const depIdx of dependencies) {
        if (depIdx < 0 || depIdx >= i) continue;
        
        const depTask = subTasks[depIdx];
        const currentTools = new Set(currentTask.toolsCategories);
        const depTools = new Set(depTask.toolsCategories);
        
        // Check if current task uses same or fewer tools than its dependency
        const currentUsesSubsetOfDepTools = [...currentTools].every(tool => depTools.has(tool));
        
        // Also check if they use exactly the same tools
        const sameTools = currentTools.size === depTools.size && currentUsesSubsetOfDepTools;
        
        if (sameTools || (currentUsesSubsetOfDepTools && currentTools.size <= depTools.size)) {
          throw new Error(
            `Sub-tasks '${depTask.name}' (index ${depIdx}) and '${currentTask.name}' (index ${i}) should be merged into a single step. ` +
            `They are consecutive dependent steps using the same or overlapping tool categories (${[...currentTools].join(', ')}). ` +
            `Combine their intents, contexts, and expected outputs into one comprehensive sub-task.`
          );
        }
      }
    }
  }
}
