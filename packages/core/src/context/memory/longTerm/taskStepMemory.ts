import { BaseTypedMemory, TypedMemoryConfig } from './baseTypedMemory';
import { MemoryInsight, MemoryEntry } from '../types';
import { formatChainOfThoughts, ChainThoughtEvent } from '../../../task/chainOfThoughtsFormatter';

/**
 * Represents a task run with execution details
 */
export interface TaskRun {
  id: string;
  taskId: string;
  taskName?: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  result?: any;
  error?: string;
  chainOfThoughts: ChainThoughtEvent[];
}

/**
 * Represents a single step execution within a task run
 */
export interface TaskStep {
  stepId: string;
  stepName: string;
  taskId: string;
  taskName?: string;
  startedAt: string;
  intent: string;
  completedAt?: string;
  status: 'completed' | 'failed';
  error?: string;
  chainOfThoughts: ChainThoughtEvent[];
  result?: any;
}

/**
 * Long-term memory type for storing individual task step executions.
 * Enables learning from specific step patterns and retrieving relevant insights per step.
 */
export class TaskStepLongTermMemory extends BaseTypedMemory<TaskStep, TaskRun> {
  readonly memoryType = 'task_step';

  protected readonly config: TypedMemoryConfig = {
    processingInstructions: `Analyze the task step execution and extract key insights about how this specific step was executed, 
what tools were used, what worked well, and what challenges were encountered. Focus on actionable learnings for similar steps.`,
  };

  /**
   * Store a task run by splitting it into individual step memories.
   * Each step gets its own memory entry for granular learning.
   * Returns a summary memory entry representing the storage operation.
   * @param taskRun - The task run to store
   * @param feedback - Optional user feedback to include in the memory (format: "like: content..." or "dislike: content...")
   */
  async store(taskRun: TaskRun, feedback?: string): Promise<MemoryEntry> {
    const steps = this.splitTaskRunIntoSteps(taskRun);
    let lastEntry: MemoryEntry | undefined;

    for (const step of steps) {
      try {
        if (this.llmApi) {
          const formattedData = this.formatStepForMemoryTask(step, feedback);
          lastEntry = await this.longTermMemory.storeWithInsightGeneration(
            formattedData,
            this.memoryType,
            this.config,
            step.intent,
          );
        } else {
          const insight = this.createInsight(step);
          if (feedback) {
            insight.feedback = feedback;
          }
          lastEntry = await this.longTermMemory.storeMemoryInsight(insight, this.memoryType);
        }
      } catch (error) {
        console.warn(`Failed to store step memory for: ${step.stepName}`, error);
      }
    }

    // Return the last stored entry, or create a summary entry if none were stored
    if (lastEntry) {
      return lastEntry;
    }

    // Fallback: create a summary entry for the entire task run
    const summaryInsight: MemoryInsight<TaskStep> = {
      intent: `Task run: ${taskRun.taskName || taskRun.taskId}`,
      executionPlan: `Stored ${steps.length} step memories`,
      outcome: `Task ${taskRun.status}`,
      data: {
        stepId: taskRun.id,
        stepName: taskRun.taskName || 'Task run summary',
        taskId: taskRun.taskId,
        taskName: taskRun.taskName,
        startedAt: taskRun.startedAt,
        intent: taskRun.taskName!,
        completedAt: taskRun.completedAt,
        status: taskRun.status === 'completed' ? 'completed' : 'failed',
        chainOfThoughts: taskRun.chainOfThoughts,
        result: taskRun.result,
        error: taskRun.error
      },
      insights: `No individual steps found to store`,
      tags: ['task_run_summary', taskRun.status],
      feedback
    };

    return this.longTermMemory.storeMemoryInsight(summaryInsight, this.memoryType);
  }

  /**
   * Split a task run into individual step executions.
   */
  private splitTaskRunIntoSteps(taskRun: TaskRun): TaskStep[] {
    const steps: TaskStep[] = [];
    const chainOfThoughts = taskRun.chainOfThoughts || [];
    
    let currentStep: {
      id: string;
      name: string;
      startTime: string;
      intent: string;
      events: ChainThoughtEvent[];
    } | null = null;

    for (const event of chainOfThoughts) {
      if (event.type === 'planStepStart') {
        // Start tracking a new step
        const stepName = event.intent || (event.data as any)?.intent || event.name || (event.data as any)?.name || 'unnamed_step';
        const stepId = (event.data as any)?.id || event.id;
        const intent = event.intent || (event.data as any)?.intent || '';
        
        currentStep = {
          id: stepId,
          name: stepName,
          intent,
          startTime: event.timestamp,
          events: [event]
        };
      } else if (event.type === 'planStepResult') {
        // Complete the current step
        if (currentStep) {
          currentStep.events.push(event);
          
          const stepName = currentStep.name;
          const hasError = !!event.error;
          
          steps.push({
            stepId: currentStep.id,
            stepName,
            taskId: taskRun.taskId,
            taskName: taskRun.taskName,
            startedAt: currentStep.startTime,
            intent: currentStep.intent,
            completedAt: event.timestamp,
            status: hasError ? 'failed' : 'completed',
            error: event.error,
            chainOfThoughts: currentStep.events,
            result: event.data || event.result
          });
          
          currentStep = null;
        }
      } else if (currentStep) {
        // Add event to current step
        currentStep.events.push(event);
      }
    }

    // Handle any unclosed step (shouldn't happen in well-formed runs)
    if (currentStep && currentStep.events.length > 0) {
      steps.push({
        stepId: currentStep.id,
        stepName: currentStep.name,
        taskId: taskRun.taskId,
        taskName: taskRun.taskName,
        startedAt: currentStep.startTime,
        intent: currentStep.intent,
        completedAt: taskRun.completedAt,
        status: 'completed',
        chainOfThoughts: currentStep.events
      });
    }

    return steps;
  }

  /**
   * Format TaskStep data for memory insight generation.
   * This is used when processing individual steps.
   * @param data - The task step to format
   * @param feedback - Optional user feedback (format: "like: content..." or "dislike: content...")
   */
  private formatStepForMemoryTask(data: TaskStep, feedback?: string): string {
    let formatted = `Task Step Execution:\n\n`;
    
    // Basic info
    formatted += `Step: ${data.stepName}\n`;
    formatted += `Task: ${data.taskName || data.taskId}\n`;
    formatted += `Status: ${data.status}\n`;
    formatted += `Started: ${data.startedAt}\n`;

    if (data.completedAt) {
      const duration = new Date(data.completedAt).getTime() - new Date(data.startedAt).getTime();
      formatted += `Completed: ${data.completedAt}\n`;
      formatted += `Duration: ${Math.round(duration / 1000)}s\n`;
    }

    if (data.error) {
      formatted += `Error: ${data.error}\n`;
    }
    
    // Include user feedback if provided
    if (feedback) {
      formatted += `\n## User Feedback\n${feedback}\n`;
    }
    formatted += `\n`;

    // Execution flow
    if (data.chainOfThoughts && data.chainOfThoughts.length > 0) {
      formatted += `## Step Execution Details\n`;
      formatted += formatChainOfThoughts(data.chainOfThoughts);
      formatted += `\n`;
    }

    // Result if available
    if (data.result) {
      formatted += `\n## Step Result\n`;
      formatted += JSON.stringify(data.result, null, 2);
    }

    return formatted;
  }

  /**
   * Format TaskRun data for memory task (required by base class).
   * Since we process TaskRun by splitting it into steps, this is mainly for completeness.
   */
  protected formatDataForMemoryTask(data: TaskRun): string {
    return `Task Run: ${data.taskName || data.taskId}\nStatus: ${data.status}\nSteps: ${data.chainOfThoughts?.length || 0} events`;
  }

  protected createInsight(data: TaskStep): MemoryInsight<TaskStep> {
    const wasSuccessful = data.status === 'completed';
    const toolsUsed = new Set<string>();
    let errorCount = 0;

    // Analyze chain of thoughts for this step
    data.chainOfThoughts.forEach(event => {
      if (event.type === 'toolUse') {
        const toolName = event.name || (event.data as any)?.name || (event.data as any)?.tool;
        if (toolName) toolsUsed.add(toolName);
      }
      if (event.error) {
        errorCount++;
      }
    });

    const intent = `Step: ${data.stepName}`;

    const executionTime = data.completedAt && data.startedAt
      ? new Date(data.completedAt).getTime() - new Date(data.startedAt).getTime()
      : null;

    const executionPlan = `Used ${toolsUsed.size} tools` +
      (executionTime ? ` in ${Math.round(executionTime / 1000)}s` : '') +
      (toolsUsed.size > 0 ? `: ${Array.from(toolsUsed).join(', ')}` : '');

    const outcome = wasSuccessful
      ? `Step completed successfully with ${data.chainOfThoughts.length} events`
      : `Step failed: ${data.error || 'Unknown error'}`;

    const insights = this.extractStepInsights(data, toolsUsed, errorCount, wasSuccessful);

    const tags = [
      'task_step',
      data.status,
      ...Array.from(toolsUsed).slice(0, 3), // Limit tool tags
      `events:${data.chainOfThoughts.length}`,
    ];

    if (errorCount > 0) tags.push('had-errors');
    if (wasSuccessful) tags.push('successful');

    return {
      intent,
      executionPlan,
      outcome,
      data,
      insights,
      tags,
    };
  }

  protected isStructuredData(data: any): data is TaskStep {
    return (
      typeof data === 'object' &&
      data !== null &&
      typeof data.stepId === 'string' &&
      typeof data.stepName === 'string' &&
      typeof data.status === 'string' &&
      Array.isArray(data.chainOfThoughts)
    );
  }

  protected formatSingleMemory(memory: MemoryInsight, index: number): string {
    // Use the MemoryInsight properties directly
    let result = `[Step ${index + 1}]\n`;
    
    if (memory.intent) {
      result += `Intent: ${memory.intent}\n`;
    }

    if (memory.insights) {
      result += `Insights: ${memory.insights}\n`;
    }

    if (memory.feedback) {
      result += `User Feedback: ${memory.feedback}\n`;
    }

    // Access the step data from the memory
    const stepData = memory.data as unknown as TaskStep;
    if (stepData?.chainOfThoughts && stepData.chainOfThoughts.length > 0) {
      result += `\nStep Details:\n`;
      result += formatChainOfThoughts(stepData.chainOfThoughts);
    }

    return result;
  }

  /**
   * Format memories as context for LLM.
   * Works with generic MemoryInsight data from retrieved memories.
   */
  formatAsContext(memories: MemoryInsight[]): string {
    if (memories.length === 0) return '';

    const formattedMemories = memories
      .map((m, i) => this.formatSingleMemory(m, i))
      .join('\n\n---\n\n');

    return `Past step execution memories:\n\n${formattedMemories}`;
  }

  private extractStepInsights(
    step: TaskStep,
    toolsUsed: Set<string>,
    errorCount: number,
    wasSuccessful: boolean
  ): string {
    const insights: string[] = [];

    // Step execution pattern
    insights.push(`Step executed ${step.chainOfThoughts.length} events`);

    // Tool usage patterns
    if (toolsUsed.size > 0) {
      insights.push(`Used ${toolsUsed.size} tools: ${Array.from(toolsUsed).join(', ')}`);
    }

    // Error handling
    if (errorCount > 0) {
      insights.push(`Encountered ${errorCount} errors during step`);
    }

    // Outcome analysis
    if (wasSuccessful) {
      insights.push('Step completed successfully');
    } else {
      insights.push(`Step ${step.status}: ${step.error || 'See details for more'}`);
    }

    return insights.join('. ');
  }
}
