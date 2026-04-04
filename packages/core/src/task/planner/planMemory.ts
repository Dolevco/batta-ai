import { LongTermMemory } from '../../context/memory/longTerm/longTermMemory';
import { StoredPlan } from './types';

/**
 * Stores and retrieves task plans using long-term memory for semantic similarity search
 */
export class PlanMemory {
  private readonly planType = 'task_plan';

  constructor(private memory: LongTermMemory) {}

  /**
   * Store a plan for a given task description
   */
  async storePlan(taskDescription: string, plan: StoredPlan): Promise<void> {
    await this.memory.store(taskDescription, {
      tags: [this.planType],
      solution: JSON.stringify(plan),
    });
  }

  /**
   * Find a similar plan based on task description
   * Returns undefined if no sufficiently similar plan exists
   */
  async findSimilarPlan(
    taskDescription: string,
    similarityThreshold = 0.85
  ): Promise<StoredPlan | undefined> {
    const results = await this.memory.search(taskDescription, 1);

    if (!results.length) return undefined;

    const [best] = results;
    
    // Check if it's a plan entry and meets threshold
    if (!best.metadata?.tags?.includes(this.planType)) {
      return undefined;
    }
    
    if (best.score < similarityThreshold) {
      return undefined;
    }

    try {
      return JSON.parse(best.metadata.solution as string);
    } catch {
      return undefined;
    }
  }
}
