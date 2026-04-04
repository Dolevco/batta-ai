import { BaseTool, GraphBaseTool, ToolCategory, ToolParameter, ToolResult, GraphToolResult, ToolConfig } from '@ai-agent/core';
import type { SecurityQueryTools, SemanticSearchResult, RelationshipNode, VulnerabilityImpact } from './securityQueryTools';

export const SecurityCategory: ToolCategory = {
  name: 'security',
  description: 'Security analysis tools for querying indexed data and analyzing vulnerabilities',
  keywords: ['security', 'vulnerability', 'dependencies', 'blast radius', 'impact'],
  requireAllTools: false,
};

export interface VulnerabilityImpactParams {
  packageName: string;
  version?: string;
  vulnerabilityId?: string;
}

interface GetEntitiesByTypeParams extends Record<string, unknown> {
  entityType: string;
}

interface AnalyzeVulnerabilityImpactParams extends Record<string, unknown> {
  packageName: string;
  version?: string;
  vulnerabilityId?: string;
}

interface SearchEntitiesParams extends Record<string, unknown> {
  searchTerm: string;
  entityType?: string;
}

interface SearchSemanticParams extends Record<string, unknown> {
  query: string;
  limit?: number;
}

interface GetRelationshipGraphParams extends Record<string, unknown> {
  entityId: string;
  depth?: number;
}

export class GetEntitiesByTypeTool extends BaseTool<GetEntitiesByTypeParams> {
  name = 'get_entities_by_type';
  category = SecurityCategory;
  description = 'Get all entities of a specific type (e.g., code_service, dependency, cloud_resource)';
  parameters: ToolParameter[] = [
    {
      name: 'entityType',
      description: 'Type of entity to retrieve (e.g., code_service, dependency, cloud_resource)',
      required: true,
      type: 'string',
    },
  ];
  private queryTools: SecurityQueryTools;

  constructor(queryTools: SecurityQueryTools, config?: ToolConfig) {
    super(config);
    this.queryTools = queryTools;
  }

  async execute(params: GetEntitiesByTypeParams): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      try {
        const entities = await this.queryTools.getEntitiesByType(params.entityType);
        return {
          success: true,
          message: `Found ${entities.length} entities of type ${params.entityType}`,
          result: JSON.stringify({
            count: entities.length,
            entities: entities.slice(0, 50),
            message: entities.length > 50 ? `Showing first 50 of ${entities.length} entities` : undefined,
          }, null, 2),
        };
      } catch (error: any) {
        return {
          success: false,
          message: `Failed to get entities: ${error.message}`,
          error: error.message,
        };
      }
    });
  }
}

export class AnalyzeVulnerabilityImpactTool extends GraphBaseTool<AnalyzeVulnerabilityImpactParams> {
  name = 'analyze_vulnerability_impact';
  category = SecurityCategory;
  description = 'Analyze the blast radius and impact of a vulnerability in a specific dependency/package';
  parameters: ToolParameter[] = [
    {
      name: 'packageName',
      description: 'Name of the package/dependency with vulnerability',
      required: true,
      type: 'string',
    },
    {
      name: 'version',
      description: 'Optional version of the package',
      required: false,
      type: 'string',
    },
    {
      name: 'vulnerabilityId',
      description: 'Optional CVE or vulnerability identifier',
      required: false,
      type: 'string',
    },
  ];
  private queryTools: SecurityQueryTools;

  constructor(queryTools: SecurityQueryTools, config?: ToolConfig) {
    super(config);
    this.queryTools = queryTools;
  }

  async execute(params: AnalyzeVulnerabilityImpactParams): Promise<GraphToolResult> {
    return this.wrapGraphExecution(params, async () => {
      try {
        const impact = await this.queryTools.analyzeVulnerabilityImpact({
          packageName: params.packageName,
          version: params.version,
          vulnerabilityId: params.vulnerabilityId,
        });
        
        if (!impact) {
          return {
            success: false,
            message: `No vulnerability impact found for package: ${params.packageName}`,
            graph: {
              nodes: [],
              edges: [],
            },
          };
        }

        return {
          success: true,
          message: `Analyzed impact for ${params.packageName}: ${impact.blastRadius.services.length} services affected`,
          result: JSON.stringify(impact, null, 2),
          graph: impact.graph,
        };
      } catch (error: any) {
        return {
          success: false,
          message: `Failed to analyze vulnerability impact: ${error.message}`,
          error: error.message,
          graph: {
            nodes: [],
            edges: [],
          },
        };
      }
    });
  }
}

export class SearchEntitiesTool extends BaseTool<SearchEntitiesParams> {
  name = 'search_entities';
  category = SecurityCategory;
  description = 'Search for entities by name or attributes';
  parameters: ToolParameter[] = [
    {
      name: 'searchTerm',
      description: 'Search term to find entities',
      required: true,
      type: 'string',
    },
    {
      name: 'entityType',
      description: 'Optional entity type to filter by',
      required: false,
      type: 'string',
    },
  ];
  private queryTools: SecurityQueryTools;

  constructor(queryTools: SecurityQueryTools, config?: ToolConfig) {
    super(config);
    this.queryTools = queryTools;
  }

  async execute(params: SearchEntitiesParams): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      try {
        const entities = await this.queryTools.searchEntities(
          params.searchTerm,
          params.entityType
        );
        return {
          success: true,
          message: `Found ${entities.length} matching entities`,
          result: JSON.stringify({
            count: entities.length,
            entities: entities.slice(0, 30),
            message: entities.length > 30 ? `Showing first 30 of ${entities.length} entities` : undefined,
          }, null, 2),
        };
      } catch (error: any) {
        return {
          success: false,
          message: `Failed to search entities: ${error.message}`,
          error: error.message,
        };
      }
    });
  }
}

export class SearchSemanticTool extends BaseTool<SearchSemanticParams> {
  name = 'search_semantic';
  category = SecurityCategory;
  description = 'Search for code semantically using natural language. Returns code components with semantic descriptions and their relevance scores.';
  parameters: ToolParameter[] = [
    {
      name: 'query',
      description: 'Natural language query describing what code you are looking for (e.g., "authentication logic", "database queries")',
      required: true,
      type: 'string',
    },
    {
      name: 'limit',
      description: 'Maximum number of results to return (default: 10)',
      required: false,
      type: 'number',
    },
  ];
  private queryTools: SecurityQueryTools;

  constructor(queryTools: SecurityQueryTools, config?: ToolConfig) {
    super(config);
    this.queryTools = queryTools;
  }

  async execute(params: SearchSemanticParams): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      try {
        const results = await this.queryTools.searchSemantic(
          params.query,
          params.limit || 10
        );
        return {
          success: true,
          message: `Found ${results.length} semantic matches for "${params.query}"`,
          result: JSON.stringify({
            count: results.length,
            results: results.map((r: any) => ({
              score: r.score,
              responsibility: r.document.responsibility,
              filePath: r.document.filePath,
              language: r.document.language,
              entity: r.entity ? {
                id: r.entity.id,
                type: r.entity.entityType,
                name: (r.entity as any).name || (r.entity as any).codePath,
              } : undefined,
            })),
          }, null, 2),
        };
      } catch (error: any) {
        return {
          success: false,
          message: `Failed to search semantically: ${error.message}`,
          error: error.message,
        };
      }
    });
  }
}

export class GetRelationshipGraphTool extends GraphBaseTool<GetRelationshipGraphParams> {
  name = 'get_relationship_graph';
  category = SecurityCategory;
  description = 'Get a relationship graph for an entity, showing all connected entities and their relationships up to a specified depth. Useful for understanding dependencies and impact.';
  parameters: ToolParameter[] = [
    {
      name: 'entityId',
      description: 'ID of the entity to get relationships for',
      required: true,
      type: 'string',
    },
    {
      name: 'depth',
      description: 'Depth of relationships to traverse (default: 1, max: 3)',
      required: false,
      type: 'number',
    },
  ];
  private queryTools: SecurityQueryTools;

  constructor(queryTools: SecurityQueryTools, config?: ToolConfig) {
    super(config);
    this.queryTools = queryTools;
  }

  async execute(params: GetRelationshipGraphParams): Promise<GraphToolResult> {
    return this.wrapGraphExecution(params, async () => {
      try {
        const depth = Math.min(params.depth || 1, 3); // Cap at depth 3
        const result = await this.queryTools.getRelationshipGraph(
          params.entityId,
          depth
        );
        
        if (result.nodes.length === 0) {
          return {
            success: false,
            message: `No entity found with ID: ${params.entityId}`,
            graph: {
              nodes: [],
              edges: [],
            },
          };
        }

        // Build summary
        const totalNodes = result.nodes.length;
        const totalOutgoing = result.nodes.reduce((sum: number, node: any) => 
          sum + node.relationships.outgoing.length, 0
        );
        const totalIncoming = result.nodes.reduce((sum: number, node: any) => 
          sum + node.relationships.incoming.length, 0
        );

        return {
          success: true,
          message: `Retrieved relationship graph: ${totalNodes} nodes, ${totalOutgoing} outgoing edges, ${totalIncoming} incoming edges`,
          result: JSON.stringify({
            summary: {
              totalNodes,
              totalOutgoing,
              totalIncoming,
              depth,
            },
          }, null, 2),
          graph: result.graph,
        };
      } catch (error: any) {
        return {
          success: false,
          message: `Failed to get relationship graph: ${error.message}`,
          error: error.message,
          graph: {
            nodes: [],
            edges: [],
          },
        };
      }
    });
  }
}

export class GetThreatModelTool extends GraphBaseTool<{ entityId: string }> {
  name = 'get_threat_model';
  category = SecurityCategory;
  description = 'Get comprehensive threat model for a specific entity (service or cloud resource), including identified threats, trust boundaries, and exposure chain. Can search by entity ID or name.';
  parameters: ToolParameter[] = [
    {
      name: 'entityId',
      description: 'ID or name of the entity to get threat model for (e.g., "payment-api" or "/subscriptions/xxx/resourceGroups/prod/providers/...")',
      required: true,
      type: 'string',
    },
  ];
  private queryTools: SecurityQueryTools;

  constructor(queryTools: SecurityQueryTools, config?: ToolConfig) {
    super(config);
    this.queryTools = queryTools;
  }

  async execute(params: { entityId: string }): Promise<GraphToolResult> {
    return this.wrapGraphExecution(params, async () => {
      try {
        const threatModel = await this.queryTools.getThreatModel(params.entityId);
        
        if (!threatModel) {
          return {
            success: false,
            message: `No entity found with ID or name: ${params.entityId}`,
            graph: { nodes: [], edges: [] },
          };
        }

        const entityName = (threatModel.entity as any).name || params.entityId;
        const threatCount = threatModel.threatModel?.identifiedThreats?.length || 0;
        const riskScore = threatModel.threatModel?.riskScore || 0;

        return {
          success: true,
          message: `Threat model for ${entityName}: ${threatCount} threats, risk score: ${riskScore}`,
          result: JSON.stringify({
            entity: entityName,
            riskScore,
            internetExposed: threatModel.threatModel?.internetExposed,
            threatCount,
            exposureChainLength: threatModel.exposureChain.length,
          }, null, 2),
          graph: threatModel.graph,
        };
      } catch (error: any) {
        return {
          success: false,
          message: `Failed to get threat model: ${error.message}`,
          error: error.message,
          graph: { nodes: [], edges: [] },
        };
      }
    });
  }
}

export class GetInternetExposedResourcesTool extends GraphBaseTool<Record<string, never>> {
  name = 'get_internet_exposed_resources';
  category = SecurityCategory;
  description = 'Get all resources and services that are exposed to the internet, showing potential attack surface';
  parameters: ToolParameter[] = [];
  private queryTools: SecurityQueryTools;

  constructor(queryTools: SecurityQueryTools, config?: ToolConfig) {
    super(config);
    this.queryTools = queryTools;
  }

  async execute(params: Record<string, never>): Promise<GraphToolResult> {
    return this.wrapGraphExecution(params, async () => {
      try {
        const report = await this.queryTools.getInternetExposedResources();
        
        return {
          success: true,
          message: `Found ${report.totalExposed} internet-exposed resources (${report.exposedResources.length} cloud resources, ${report.exposedServices.length} services)`,
          result: JSON.stringify({
            totalExposed: report.totalExposed,
            resources: report.exposedResources.slice(0, 20).map((r: any) => ({
              name: r.name,
              type: r.resourceType,
              endpoint: r.threatModel?.publicEndpoint,
              riskScore: r.threatModel?.riskScore,
            })),
            services: report.exposedServices.slice(0, 20).map((s: any) => ({
              name: s.name,
              type: s.serviceType,
              riskScore: s.threatModel?.riskScore,
            })),
          }, null, 2),
          graph: report.graph,
        };
      } catch (error: any) {
        return {
          success: false,
          message: `Failed to get internet-exposed resources: ${error.message}`,
          error: error.message,
          graph: { nodes: [], edges: [] },
        };
      }
    });
  }
}

export class GetTrustBoundaryAnalysisTool extends GraphBaseTool<Record<string, never>> {
  name = 'get_trust_boundary_analysis';
  category = SecurityCategory;
  description = 'Analyze trust boundaries across the infrastructure, showing how resources cross security zones';
  parameters: ToolParameter[] = [];
  private queryTools: SecurityQueryTools;

  constructor(queryTools: SecurityQueryTools, config?: ToolConfig) {
    super(config);
    this.queryTools = queryTools;
  }

  async execute(params: Record<string, never>): Promise<GraphToolResult> {
    return this.wrapGraphExecution(params, async () => {
      try {
        const report = await this.queryTools.getTrustBoundaryAnalysis();
        
        return {
          success: true,
          message: `Found ${report.totalBoundaries} trust boundaries`,
          result: JSON.stringify({
            totalBoundaries: report.totalBoundaries,
            boundaries: report.boundaries.map(b => ({
              name: b.boundary.name,
              type: b.boundary.type,
              resourceCount: b.resources.length,
            })),
          }, null, 2),
          graph: report.graph,
        };
      } catch (error: any) {
        return {
          success: false,
          message: `Failed to get trust boundary analysis: ${error.message}`,
          error: error.message,
          graph: { nodes: [], edges: [] },
        };
      }
    });
  }
}

export class GetHighRiskResourcesTool extends GraphBaseTool<{ minRiskScore?: number }> {
  name = 'get_high_risk_resources';
  category = SecurityCategory;
  description = 'Get all high-risk resources based on threat model analysis, prioritized by risk score';
  parameters: ToolParameter[] = [
    {
      name: 'minRiskScore',
      description: 'Minimum risk score threshold (default: 50, range: 0-100)',
      required: false,
      type: 'number',
    },
  ];
  private queryTools: SecurityQueryTools;

  constructor(queryTools: SecurityQueryTools, config?: ToolConfig) {
    super(config);
    this.queryTools = queryTools;
  }

  async execute(params: { minRiskScore?: number }): Promise<GraphToolResult> {
    return this.wrapGraphExecution(params, async () => {
      try {
        const minScore = params.minRiskScore || 50;
        const report = await this.queryTools.getHighRiskResources(minScore);
        
        return {
          success: true,
          message: `Found ${report.totalHighRisk} high-risk resources (avg risk score: ${report.averageRiskScore.toFixed(1)})`,
          result: JSON.stringify({
            totalHighRisk: report.totalHighRisk,
            averageRiskScore: report.averageRiskScore,
            topRisks: report.resources.slice(0, 10).map((r: any) => ({
              name: r.name,
              type: r.entityType,
              riskScore: r.threatModel?.riskScore,
              threatCount: r.threatModel?.identifiedThreats?.length || 0,
            })),
          }, null, 2),
          graph: report.graph,
        };
      } catch (error: any) {
        return {
          success: false,
          message: `Failed to get high-risk resources: ${error.message}`,
          error: error.message,
          graph: { nodes: [], edges: [] },
        };
      }
    });
  }
}

export function createSecurityQueryTools(queryTools: SecurityQueryTools, config?: ToolConfig) {
  return [
    new GetEntitiesByTypeTool(queryTools, config),
    new AnalyzeVulnerabilityImpactTool(queryTools, config),
    new SearchEntitiesTool(queryTools, config),
    new SearchSemanticTool(queryTools, config),
    new GetRelationshipGraphTool(queryTools, config),
    new GetThreatModelTool(queryTools, config),
    new GetInternetExposedResourcesTool(queryTools, config),
    new GetTrustBoundaryAnalysisTool(queryTools, config),
    new GetHighRiskResourcesTool(queryTools, config),
  ];
}
