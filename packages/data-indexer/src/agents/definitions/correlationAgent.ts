import { createReadOnlyFileTools } from '@batta/core';
import type { DataIndexerAgentDefinition } from '../types';
import { CorrelationTaskCompletionTool } from '../tools/correlationTaskCompletionTool';
import type { ValidationContext } from '../tools/correlationTaskCompletionTool';

export const ENTITY_CORRELATION_INSTRUCTIONS = `You are an entity correlation analyzer. Your task is to discover relationships between code entities by analyzing repository files.

Read and analyze relevant files to identify relationships. Return results using the task_complete tool.

RELATIONSHIP STRUCTURE:
Each relationship MUST be a JSON object with exactly these fields:
{
  "type": "BUILDS" | "DEPLOYS" | "USES",
  "sourceId": "exact-source-entity-id",
  "targetId": "exact-target-entity-id",
  "reason": "Clear explanation of why this relationship exists",
  "evidence": "Direct quote from file that proves the relationship"
}

RELATIONSHIP TYPES:
- BUILDS: Build artifact → Service (e.g., Dockerfile builds a service)
- DEPLOYS: Deployment artifact → Service/Cloud Resource (e.g., docker-compose deploys services)
- USES: Service → Cloud Resource (e.g., service uses database)

SECURITY WARNING: Do NOT include any secrets, passwords, API keys, tokens, connection strings, or credentials in the evidence field. Only include configuration KEY NAMES and file paths, never the actual secret VALUES.

CRITICAL RULES:
- ONLY use entity IDs provided in the context - DO NOT invent or modify IDs
- the targetId and sourceId MUST match those provided in the context, other ids won't be valid
- sourceId MUST be the exact ID specified in the prompt for the entity being analyzed
- targetId MUST be an exact ID from the provided entity list
- Include direct quotes as evidence from files you read
- Return empty array if no relationships found: {"relationships": [], "reasoning": "No relationships identified"}
- DO NOT GUESS. if there are multiple options, then research and try to find good evidence by using the file tools. if you can't be sure by the data, do not return relationship.
- Complete using task_complete tool with the exact structure shown above`;

/**
 * Creates a per-invocation DataIndexerAgentDefinition for entity correlation.
 * The validationContext captures the specific entities valid for this run.
 */
export function createCorrelationAgentDefinition(
  validationContext: ValidationContext,
  customInstructions: string,
): DataIndexerAgentDefinition {
  return {
    agentType: 'entity-correlator',
    description: 'Discovers relationships between code entities by analyzing repository files.',
    whenToUse: 'When correlating entities in the data-indexer pipeline.',
    maxIterations: 25,
    customInstructions,
    completionToolFactory: () => new CorrelationTaskCompletionTool(validationContext),
    toolsFactory: (workspacePath: string) => createReadOnlyFileTools({ workspacePath }),
  };
}
