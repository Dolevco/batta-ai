import { BaseTool } from '../baseTool';
import { ToolParameter, ToolResult } from '../types';
import { DelegateTool, DYNAMIC_CODE_INTEGRATION } from '../delegation';
import { StoredPlan, PlanResult, SubTaskResult } from '../../task/planner/types';
import { PLANNER_CATEGORY } from './';
import { TypedEventEmitter } from '../../task/eventEmitter';
import { TaskEventMap } from '../../task/types';

export interface ExecutePlanParams extends Record<string, unknown> {
  plan: StoredPlan;
  /** Optional shared events emitter to propagate to sub-agents */
  events?: TypedEventEmitter<TaskEventMap>;
  context?: string;
}

/**
 * Tool that executes a previously generated plan.
 * 
 * Executes sub-tasks in order, respecting dependencies,
 * with parallel execution within each stage.
 */
export class ExecutePlanTool extends BaseTool<ExecutePlanParams> {
  name = 'execute_plan';
  category = PLANNER_CATEGORY;
  description = `Execute a previously generated plan.

The plan's sub-tasks will be executed in dependency order,
with independent tasks running in parallel.

Each sub-task is delegated to a sub-agent that executes the
specified tools and returns an analyzed result.`;

  parameters: ToolParameter[] = [
    {
      name: 'plan',
      description: 'The plan object returned from generate_plan',
      required: true,
      type: 'object'
    }
  ];

  private readonly delegateTool: DelegateTool;

  constructor(delegateTool: DelegateTool) {
    super();
    this.delegateTool = delegateTool;
  }

  /**
   * Compute execution order groups based on task dependencies.
   * Tasks with no dependencies or whose dependencies are satisfied can run in parallel.
   * Returns groups of task indices where each group can execute in parallel.
   */
  private computeExecutionOrder(subTasks: StoredPlan['subTasks']): number[][] {
    const executionOrder: number[][] = [];
    const completed = new Set<number>();
    const remaining = new Set(subTasks.map((_, idx) => idx));

    while (remaining.size > 0) {
      // Find all tasks whose dependencies are satisfied
      const ready: number[] = [];
      
      for (const idx of remaining) {
        const task = subTasks[idx];
        const allDepsCompleted = task.dependsOn.every(dep => completed.has(dep));
        
        if (allDepsCompleted) {
          ready.push(idx);
        }
      }

      // If no tasks are ready but we still have remaining tasks, there's a circular dependency
      if (ready.length === 0) {
        throw new Error('Circular dependency detected in plan');
      }

      // Add this group to execution order
      executionOrder.push(ready);

      // Mark these tasks as completed and remove from remaining
      for (const idx of ready) {
        completed.add(idx);
        remaining.delete(idx);
      }
    }

    return executionOrder;
  }

  async execute(params: ExecutePlanParams): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      const { plan, context } = params;

      // Validate plan structure
      if (!plan || !Array.isArray(plan.subTasks)) {
        return {
          success: false,
          error: 'Invalid plan structure',
          message: 'Plan must have subTasks array'
        };
      }

      if (plan.subTasks.length === 0) {
        return {
          success: false,
          error: 'Empty plan',
          message: 'Plan has no sub-tasks to execute'
        };
      }

      // Compute execution order based on dependencies
      const executionOrder = this.computeExecutionOrder(plan.subTasks);

      const results: SubTaskResult[] = new Array(plan.subTasks.length);
      const subTaskResults: string[] = [];

      // Execute each group sequentially (groups run in parallel internally)
      for (const group of executionOrder) {
        // Execute all tasks in this group in parallel
        const groupPromises = group.map(async (idx) => {
          const subTask = plan.subTasks[idx];

          // Check that all dependencies have succeeded
          // Dependencies must be in previous groups, so results should be populated
          for (const depIdx of subTask.dependsOn) {
            if (!results[depIdx] || !results[depIdx].success) {
              return {
                index: idx,
                success: false,
                result: '',
                error: `Dependency ${depIdx} (${plan.subTasks[depIdx]?.name ?? 'unknown'}) failed or not completed`
              };
            }
          }

          // Execute the sub-task
          try {
            params.events?.emit('planStepStart', { id: subTask.id, name: subTask.name, intent: subTask.intent });
            
            // Build dependency results map
            const dependencyResults: Record<string, string> = {};
            const dependencyRequiredOutput: Record<string, string> = {};
            let resolvedCodeIntegrationId = subTask.codeIntegrationId;
            
            for (const depIdx of subTask.dependsOn) {
              const depTask = plan.subTasks[depIdx];
              const depResult = results[depIdx];
              if (depTask && depResult) {
                dependencyResults[depTask.intent] = `${depResult.result}${depResult.requiredOutput ? '\n\n OUTPUT:\n'  + JSON.stringify(depResult.requiredOutput) : ''}`;

                // Merge any metadata from the dependency into dependencyRequiredOutput
                if (depResult.requiredOutput && typeof depResult.requiredOutput === 'object') {
                  for (const [metaKey, metaVal] of Object.entries(depResult.requiredOutput)) {
                  // If repositoryName is provided by a dependency, use it to resolve dynamic code integration
                  if (metaKey === 'repositoryName') {
                    if (typeof metaVal === 'string') {
                      resolvedCodeIntegrationId = metaVal;
                    } else if (Array.isArray(metaVal) && metaVal.length > 0 && typeof metaVal[0] === 'string') {
                      resolvedCodeIntegrationId = metaVal[0];
                    }
                  }
                  
                  dependencyRequiredOutput[metaKey] = typeof metaVal === 'string' ? metaVal : JSON.stringify(metaVal);
                  }
                }
                
              }
            }
            
            // Validate dynamic code integration was resolved
            if (subTask.codeIntegrationId === DYNAMIC_CODE_INTEGRATION && 
                resolvedCodeIntegrationId === DYNAMIC_CODE_INTEGRATION) {
              return {
                index: idx,
                success: false,
                result: '',
                error: `Dynamic code integration requires a dependency to provide 'repositoryName' in metadata, but none was found`
              };
            }
            
            // Attempt execution with one retry if the first attempt fails
            let attempt = 0;
            let execResult: ToolResult | undefined;
            let lastError: string | undefined;

            while (attempt < 2) {
              try {
                execResult = await this.delegateTool.execute({
                  id: subTask.id,
                  name: subTask.name,
                  toolsCategories: subTask.toolsCategories,
                  tools: subTask.tools,
                  intent: subTask.intent,
                  context: `Execution plan: ${subTask.executionPlan}\n\n${context}`,
                  taskType: 'delegating',
                  expectedOutput: subTask.expectedOutput,
                  anticipatedSteps: subTask.anticipatedSteps,
                  codeIntegrationId: resolvedCodeIntegrationId,
                  events: params.events,
                  requiredInputs: Object.keys(dependencyResults).length > 0 ? dependencyResults : {} as Record<string, string>,
                  requiredOutputs: subTask.requiredOutputs
                });

                // If succeeded, stop retrying
                if (execResult && execResult.success) {
                  break;
                }

                // Record error/message for retry
                lastError = execResult?.error ?? execResult?.message ?? 'Unknown error';

                // Emit retry event and try once more
                if (attempt === 0) {
                  // cast event name to satisfy TypedEventEmitter's type
                  params.events?.emit('planStepRetry' as unknown as keyof TaskEventMap, { id: subTask.id, name: subTask.name, attempt: 1, error: lastError });
                }
              } catch (err) {
                lastError = err instanceof Error ? err.message : String(err);
                if (attempt === 0) {
                  // cast event name to satisfy TypedEventEmitter's type
                  params.events?.emit('planStepRetry' as unknown as keyof TaskEventMap, { id: subTask.id, name: subTask.name, attempt: 1, error: lastError });
                }
              }

              attempt++;
            }

            const result = execResult ?? { success: false, error: lastError, message: lastError } as ToolResult;

            params.events?.emit('planStepResult', { id: subTask.id, name: subTask.name, result });
            const resultStr = result.result?.toString() ?? result.message ?? '';

            return {
              index: idx,
              success: result.success,
              result: resultStr,
              error: result.error,
              requiredOutput: result.requiredOutput
            };
          } catch (err) {
            return {
              index: idx,
              success: false,
              result: '',
              error: err instanceof Error ? err.message : String(err)
            };
          }
        });

        const groupResults = await Promise.all(groupPromises);

        // Store results and build output
        for (const result of groupResults) {
          results[result.index] = result;
          if (result.success && result.result) {
            subTaskResults.push(`[${result.index}] ${plan.subTasks[result.index].name}:\n${result.result}`);
          }
        }

        // Stop execution if any task in this group failed
        const failure = groupResults.find(r => !r.success);
        if (failure) {
          const planResult: PlanResult = {
            success: false,
            results,
            error: `Sub-task ${failure.index} (${plan.subTasks[failure.index].name}) failed: ${failure.error}`
          };

          return {
            success: false,
            result: planResult,
            error: planResult.error,
            message: `Plan execution failed at sub-task ${failure.index}`
          };
        }
      }

      const planResult: PlanResult = {
        success: true,
        results
      };

      return {
        success: true,
        result: planResult,
        message: `Plan executed successfully. ${results.length} sub-tasks completed.\n\nResults:\n${subTaskResults.join('\n\n')}`
      };
    });
  }
}
