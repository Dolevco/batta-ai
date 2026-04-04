import { BaseTypedMemory, TypedMemoryConfig } from './baseTypedMemory';
import { MemoryInsight } from '../types';
import { StoredPlan } from '../../../task/planner/types';

/**
 * Long-term memory type for storing and retrieving task plans.
 * Helps agents learn from past planning decisions and approaches.
 * 
 * Note: This is different from the PlanMemory class in task/planner,
 * which handles plan caching for reuse.
 */
export class PlanLongTermMemory extends BaseTypedMemory<StoredPlan> {
  readonly memoryType = 'plan';

  protected readonly config: TypedMemoryConfig = {
    processingInstructions: `Analyze the task plan and extract key insights about the planning approach, 
task decomposition strategy, tool selection, and dependency management.`,
    outputSchema: `{
  task: string,
  description: string,
  message: string,
  subTasks: Array<{
    id: string,
    name: string,
    tools: string[],
    taskType?: string,
    intent: string,
    context: string,
    expectedOutput: string,
    dependsOn: number[],
    codeIntegrationId?: string,
    requiredOutputs?: Record<string, string>,
    requiredInputs: Record<string, string>,
    reason: string,
    executionPlan: string
  }>,
  createdAt: string
}`,
    requiredFields: {
      task: 'The main task being planned',
      description: 'Description of the task',
      subTasks: 'Array of planned sub-tasks with their configurations',
    },
  };

  /**
   * Format StoredPlan data for memory insight generation.
   */
  protected formatDataForMemoryTask(data: StoredPlan): string {
    let formatted = `Task Plan:\n\n`;
    formatted += `Task: ${data.task}\n`;
    formatted += `Description: ${data.description}\n`;
    formatted += `Message: ${data.message}\n`;
    formatted += `Created: ${data.createdAt}\n\n`;

    formatted += `## Sub-Tasks (${data.subTasks.length}):\n\n`;
    
    data.subTasks.forEach((st, i) => {
      formatted += `### ${i + 1}. ${st.name}\n`;
      formatted += `ID: ${st.id}\n`;
      formatted += `Intent: ${st.intent}\n`;
      formatted += `Expected Output: ${st.expectedOutput}\n`;
      
      if (st.taskType) {
        formatted += `Task Type: ${st.taskType}\n`;
      }
      
      if (st.tools && st.tools.length > 0) {
        formatted += `Tools: ${st.tools.join(', ')}\n`;
      }
      
      if (st.dependsOn && st.dependsOn.length > 0) {
        formatted += `Dependencies: ${st.dependsOn.map(d => `Sub-task ${d + 1}`).join(', ')}\n`;
      }
      
      if (st.codeIntegrationId) {
        formatted += `Code Integration: ${st.codeIntegrationId}\n`;
      }
      
      formatted += `Reason: ${st.reason}\n`;
      formatted += `Execution Plan: ${st.executionPlan}\n`;
      
      if (st.requiredInputs && Object.keys(st.requiredInputs).length > 0) {
        formatted += `Required Inputs: ${Object.keys(st.requiredInputs).join(', ')}\n`;
      }
      
      if (st.requiredOutputs && Object.keys(st.requiredOutputs).length > 0) {
        formatted += `Required Outputs: ${Object.keys(st.requiredOutputs).join(', ')}\n`;
      }
      
      formatted += `\n`;
    });

    return formatted;
  }

  protected createInsight(data: StoredPlan): MemoryInsight<StoredPlan> {
    // Extract key information from the plan
    const subTaskCount = data.subTasks.length;
    const toolTypes = new Set<string>();
    const taskTypes = new Set<string>();
    let hasCodeIntegration = false;
    let hasDependencies = false;

    data.subTasks.forEach(st => {
      if (st.tools) {
        st.tools.forEach((tool: string) => toolTypes.add(tool));
      }
      if (st.taskType) {
        taskTypes.add(st.taskType);
      }
      if (st.codeIntegrationId) {
        hasCodeIntegration = true;
      }
      if (st.dependsOn && st.dependsOn.length > 0) {
        hasDependencies = true;
      }
    });

    const intent = `Plan for: ${data.task}`;
    
    const executionPlan = `Decomposed into ${subTaskCount} sub-tasks` +
      (taskTypes.size > 0 ? ` using ${Array.from(taskTypes).join(', ')} task types` : '') +
      (hasCodeIntegration ? ' with code integration' : '') +
      (hasDependencies ? ' and task dependencies' : '');

    const outcome = `Created structured plan with ${subTaskCount} steps` +
      (toolTypes.size > 0 ? ` using tools: ${Array.from(toolTypes).join(', ')}` : '');

    const insights = this.extractPlanningInsights(data, toolTypes, taskTypes, hasCodeIntegration, hasDependencies);

    const tags = [
      'plan',
      `subtasks:${subTaskCount}`,
      ...Array.from(taskTypes),
      ...Array.from(toolTypes).slice(0, 3), // Limit tool tags
    ];

    if (hasCodeIntegration) tags.push('code-integration');
    if (hasDependencies) tags.push('dependencies');

    return {
      intent,
      executionPlan,
      outcome,
      data,
      insights,
      tags,
    };
  }

  protected isStructuredData(data: any): data is StoredPlan {
    return (
      typeof data === 'object' &&
      data !== null &&
      typeof data.task === 'string' &&
      typeof data.description === 'string' &&
      Array.isArray(data.subTasks) &&
      data.subTasks.every((st: any) =>
        typeof st.id === 'string' &&
        typeof st.name === 'string' &&
        typeof st.intent === 'string'
      )
    );
  }

  protected formatSingleMemory(memory: MemoryInsight, index: number): string {
    const plan = memory.data as unknown as StoredPlan;
    if (!plan) return `[${this.memoryType} ${index + 1}] ${memory.insights}`;

    let formatted = `[Plan ${index + 1}] ${plan.task}\n`;
    formatted += `  Description: ${plan.description}\n`;
    formatted += `  Sub-tasks: ${plan.subTasks.length}\n`;

    if (plan.subTasks.length > 0) {
      formatted += `  Approach:\n`;
      plan.subTasks.forEach((st, i) => {
        formatted += `    ${i + 1}. ${st.name}`;
        if (st.taskType) {
          formatted += ` (${st.taskType})`;
        }
        if (st.dependsOn && st.dependsOn.length > 0) {
          formatted += ` [depends on: ${st.dependsOn.map(d => d + 1).join(', ')}]`;
        }
        formatted += `\n`;
      });
    }

    return formatted;
  }

  private extractPlanningInsights(
    plan: StoredPlan,
    toolTypes: Set<string>,
    taskTypes: Set<string>,
    hasCodeIntegration: boolean,
    hasDependencies: boolean
  ): string {
    const insights: string[] = [];

    // Planning approach
    insights.push(`Task decomposition created ${plan.subTasks.length} steps`);

    // Task type usage patterns
    if (taskTypes.size > 1) {
      insights.push(`Used multiple task types: ${Array.from(taskTypes).join(', ')}`);
    }

    // Tool selection patterns
    if (toolTypes.size > 0) {
      insights.push(`Utilized ${toolTypes.size} different tool types`);
    }

    // Dependency management
    if (hasDependencies) {
      const maxDependencies = Math.max(...plan.subTasks.map(st => st.dependsOn?.length || 0));
      insights.push(`Managed task dependencies with up to ${maxDependencies} dependencies per task`);
    }

    // Code integration usage
    if (hasCodeIntegration) {
      const codeTaskCount = plan.subTasks.filter(st => st.codeIntegrationId).length;
      insights.push(`${codeTaskCount} tasks involved code integration`);
    }

    return insights.join('. ');
  }
}
