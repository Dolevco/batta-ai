import { SecurityQueryTools } from '../tools/securityQueryTools';
import { Neo4jAdapter } from '../persistence/neo4jAdapter';
import { QdrantAdapter } from '../persistence/qdrantDataAdapter';
import { createSecurityQueryTools } from '../tools/securityQueryTool';
import type { TenantId } from '../types/canonical.types';
import type { Tool } from '@ai-agent/core';

export interface SecurityQueryToolsConfig {
  tenantId: TenantId;
  neo4j: Neo4jAdapter;
  qdrant: QdrantAdapter;
}

/**
 * Initialize security query tools for use with PlannedTask
 * This factory creates tools that can query indexed security data
 * 
 * @param config Configuration including tenantId and optional adapters
 * @returns Array of security query tools
 */
export async function initializeSecurityQueryTools(
  config: SecurityQueryToolsConfig
): Promise<Tool[]> {
  const { tenantId, neo4j, qdrant } = config;

  // Create SecurityQueryTools instance
  const queryTools = new SecurityQueryTools({
    tenantId,
    neo4j,
    qdrant,
  });

  // Create and return tool instances
  return createSecurityQueryTools(queryTools);
}
