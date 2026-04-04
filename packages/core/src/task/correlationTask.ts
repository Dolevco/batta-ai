/**
 * Generic Correlation Task
 * 
 * A reusable task for correlating entities using LLM reasoning.
 * Provides a clean abstraction for entity correlation workflows.
 */

import { Task } from './task';
import { ILLMApiHandler } from '../api';
import { createReadOnlyFileTools } from '../tools';
import { MODES } from '../context/prompts/modes';
import { CorrelationResult, CorrelationTaskCompletionTool, ValidationContext } from '../tools/correlation/correlationTaskCompletionTool';

/**
 * Configuration for a correlation task
 */
export interface CorrelationConfig<TEntity> {
  /** The main entity being analyzed */
  mainEntity: TEntity;
  /** Type label for the main entity (e.g., "Build Artifact", "Service") */
  mainEntityType: string;
  /** All entities that can participate in relationships */
  allEntities: TEntity[];
  /** Path to the repository/workspace for file access */
  repositoryPath: string;
  /** Function to extract entity ID */
  getEntityId: (entity: TEntity) => string;
  /** Function to extract entity name */
  getEntityName: (entity: TEntity) => string;
  /** Function to build context description for the main entity */
  buildMainEntityContext: (entity: TEntity) => string;
  /** Function to build context for target entities */
  buildTargetEntitiesContext: (entities: TEntity[]) => string;
  /** Function to build the analysis prompt */
  buildAnalysisPrompt: (entity: TEntity) => string;
  /** Task instructions */
  taskInstructions: string;
  /** Valid relationship types (optional) */
  validRelationshipTypes?: string[];
}


/**
 * Generic correlation task for analyzing entity relationships
 */
export class CorrelationTask<TEntity> {
  private api: ILLMApiHandler;
  private config: CorrelationConfig<TEntity>;

  constructor(api: ILLMApiHandler, config: CorrelationConfig<TEntity>) {
    this.api = api;
    this.config = config;
  }

  /**
   * Execute the correlation task
   */
  async execute(): Promise<CorrelationResult> {
    const validationContext = this.buildValidationContext();
    const context = this.buildContext();
    const customPrompt = this.buildPrompt();

    const completionTool = new CorrelationTaskCompletionTool(validationContext);
    const tools = [...createReadOnlyFileTools({ workspacePath: this.config.repositoryPath }), completionTool];

    const task = new Task(this.api, {
      mode: MODES.ENTITY_CORRELATION,
      customInstructions: customPrompt,
      workspace: this.config.repositoryPath,
      tools,
      maxIterations: 25,
    });

    const result = await task.execute<CorrelationResult>(context);

    if (!result.success || !result.requiredOutput) {
      return {
        relationships: [],
        reasoning: result.summary || 'Task failed',
      };
    }

    return {
      relationships: (result.requiredOutput as any).relationships || [],
      reasoning: (result.requiredOutput as any).reasoning || '',
    };
  }

  /**
   * Build validation context
   */
  private buildValidationContext(): ValidationContext {
    const { mainEntity, mainEntityType, allEntities, getEntityId, getEntityName, validRelationshipTypes } = this.config;
    
    const validEntityIds = new Set<string>();
    const entityIdToName = new Map<string, string>();

    allEntities.forEach(entity => {
      const id = getEntityId(entity);
      validEntityIds.add(id);
      entityIdToName.set(id, getEntityName(entity));
    });

    return {
      mainEntityId: getEntityId(mainEntity),
      mainEntityName: getEntityName(mainEntity),
      mainEntityType,
      validEntityIds,
      entityIdToName,
      validRelationshipTypes,
    };
  }

  /**
   * Build task context
   */
  private buildContext(): string {
    const { mainEntity, allEntities, buildMainEntityContext, buildTargetEntitiesContext, taskInstructions, getEntityId } = this.config;
    
    const parts: string[] = [];
    
    parts.push('=== MAIN ENTITY TO ANALYZE ===');
    parts.push(buildMainEntityContext(mainEntity));
    parts.push('');
    
    parts.push('=== AVAILABLE TARGET ENTITIES ===');
    parts.push(buildTargetEntitiesContext(allEntities));
    parts.push('');
    
    parts.push('TASK: ' + taskInstructions);
    parts.push('');
    parts.push('IMPORTANT:');
    parts.push(`- Every relationship MUST have "${getEntityId(mainEntity)}" as sourceId or targetId`);
    parts.push('- Use the exact entity IDs listed above (not names)');
    parts.push('- Only create relationships if you find concrete evidence');
    
    return parts.join('\n');
  }

  /**
   * Build analysis prompt
   */
  private buildPrompt(): string {
    const { mainEntity, buildAnalysisPrompt } = this.config;
    return buildAnalysisPrompt(mainEntity);
  }
}
