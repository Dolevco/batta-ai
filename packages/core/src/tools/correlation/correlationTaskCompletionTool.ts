import { BaseTool, ToolParameter, ToolResult } from "..";
import { TaskCompletionCategory } from "../task/taskCompletionTool";

/**
 * Relationship input from LLM
 */
export interface RelationshipInput {
  type: string;
  sourceId: string;
  targetId: string;
  reason: string;
  evidence: string;
  confidence: number;
}

/**
 * Correlation task completion tool input
 */
export interface CorrelationTaskInput extends Record<string, unknown> {
  relationships: RelationshipInput[];
  reasoning: string;
}


/**
 * Validation context for entity correlation
 */
export interface ValidationContext {
  mainEntityId: string;
  mainEntityName: string;
  mainEntityType: string;
  validEntityIds: Set<string>;
  entityIdToName: Map<string, string>;
  validRelationshipTypes?: string[]; // Optional: valid relationship types
}


/**
 * Result from correlation execution
 */
export interface CorrelationResult {
  relationships: RelationshipInput[];
  reasoning: string;
}

/**
 * Completion tool for correlation tasks
 */
export class CorrelationTaskCompletionTool extends BaseTool<CorrelationTaskInput> {
  name = 'task_complete';
  category = TaskCompletionCategory;
  description = 'Mark task as complete';
  parameters: ToolParameter[];
  private validationContext: ValidationContext;

  constructor(validationContext: ValidationContext) {
    super();
    this.validationContext = validationContext;
    this.parameters = this.buildParametersList();
  }

  private buildParametersList(): ToolParameter[] {
    return [
      {
        name: 'relationships',
        description: `Array of relationship objects. Each MUST include ${this.validationContext.mainEntityId} as sourceId or targetId`,
        required: true,
        type: 'array',
      },
      {
        name: 'reasoning',
        description: 'Brief analysis summary of correlations found',
        required: true,
        type: 'string',
      },
    ];
  }

  async execute(input: CorrelationTaskInput): Promise<ToolResult> {
    return this.wrapExecution(input, async () => {
      const { relationships, reasoning } = input;
      const { mainEntityId, mainEntityName, mainEntityType, validEntityIds, entityIdToName, validRelationshipTypes } = this.validationContext;

      // Validate relationships
      const errors: string[] = [];
      const validRelationships: RelationshipInput[] = [];

      if (!relationships || relationships.length === 0) {
        return {
          success: true,
          message: `Task completed successfully with no relationships found.\n\nReasoning: ${reasoning || 'No correlations identified'}`,
          requiredOutput: { relationships: [], reasoning: reasoning || 'No correlations identified' },
        };
      }

      relationships.forEach((rel, index) => {
        const relErrors: string[] = [];

        // Rule 1: Main entity must be in the relationship
        if (rel.sourceId !== mainEntityId && rel.targetId !== mainEntityId) {
          relErrors.push(
            `Main entity "${mainEntityName}" (${mainEntityId}) must be either sourceId or targetId. ` +
            `Got sourceId="${rel.sourceId}", targetId="${rel.targetId}"`
          );
        }

        // Rule 2: Both IDs must be valid
        if (!validEntityIds.has(rel.sourceId)) {
          const available = Array.from(validEntityIds).map(id => `${id} (${entityIdToName.get(id)})`).join(', ');
          relErrors.push(
            `Invalid sourceId "${rel.sourceId}". Must be one of: ${available}`
          );
        }

        if (!validEntityIds.has(rel.targetId)) {
          const available = Array.from(validEntityIds).map(id => `${id} (${entityIdToName.get(id)})`).join(', ');
          relErrors.push(
            `Invalid targetId "${rel.targetId}". Must be one of: ${available}`
          );
        }

        // Additional validations
        if (!rel.type || typeof rel.type !== 'string') {
          relErrors.push('Missing or invalid "type" field');
        } else if (validRelationshipTypes && !validRelationshipTypes.includes(rel.type)) {
          relErrors.push(
            `Invalid relationship type "${rel.type}". Must be one of: ${validRelationshipTypes.join(', ')}`
          );
        }

        if (!rel.reason || typeof rel.reason !== 'string') {
          relErrors.push('Missing or invalid "reason" field');
        }

        if (!rel.evidence || typeof rel.evidence !== 'string') {
          relErrors.push('Missing or invalid "evidence" field');
        }

        if (relErrors.length > 0) {
          errors.push(`\nRelationship ${index + 1} errors:\n  ${relErrors.join('\n  ')}`);
        } else {
          validRelationships.push(rel);
        }
      });

      if (errors.length > 0) {
        const errorMessage = [
          '❌ VALIDATION FAILED',
          '',
          `Analyzing ${mainEntityType}: "${mainEntityName}" (${mainEntityId})`,
          '',
          'ERRORS FOUND:',
          ...errors,
          '',
          'REMINDER:',
          `- Every relationship MUST include ${mainEntityId} as sourceId OR targetId`,
          '- Use exact entity IDs from the provided list',
          '- Do not use entity names, only IDs',
          '',
          'Please fix these errors and try again.',
        ].join('\n');

        return {
          success: false,
          message: errorMessage,
          error: 'Validation failed',
        };
      }

      return {
        success: true,
        message: `Task completed successfully with ${validRelationships.length} valid relationship(s).\n\nReasoning: ${reasoning}`,
        requiredOutput: { relationships: validRelationships, reasoning },
      };
    });
  }
}
