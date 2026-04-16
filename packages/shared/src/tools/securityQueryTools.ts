/**
 * Security Analysis Tools
 * 
 * Tools for querying indexed security data and analyzing relationships
 */

import { Neo4jAdapter } from '../persistence/neo4jAdapter';
import { QdrantAdapter } from '../persistence/qdrantDataAdapter';
import { VulnerabilityImpactAnalyzer } from './vulnerabilityImpactAnalyzer';
import {
  TenantId,
  CanonicalEntity,
  Relationship,
  CodeService,
  VulnerabilityQuery,
  EntityId,
  RelationshipType,
  SemanticDocument,
  CloudResource,
  ThreatModelData,
  TrustBoundary,
  Threat,
} from '../types/canonical.types';
import {
  GraphProjection,
  GraphNode,
  GraphEdge,
  GraphNodeType,
} from '@ai-agent/core';

export interface VulnerabilityImpact {
  blastRadius: {
    services: object[];
    buildArtifacts?: object[];
    deploymentArtifacts?: object[];
    cloudResources?: object[];
  };
  vulnerability?: string;
  dependency?: string;
  affectedComponents?: string[];
  flows?: any[];
  graph: GraphProjection;
}

export interface ThreatModelProjection {
  entity: CanonicalEntity;
  threatModel?: ThreatModelData;
  relatedThreats: ThreatSummary[];
  exposureChain: ExposureChainItem[];
  graph: GraphProjection;
}

export interface InternetExposureReport {
  totalExposed: number;
  exposedResources: CloudResource[];
  exposedServices: CodeService[];
  graph: GraphProjection;
}

export interface TrustBoundaryReport {
  totalBoundaries: number;
  boundaries: TrustBoundaryGroup[];
  graph: GraphProjection;
}

export interface TrustBoundaryGroup {
  boundary: TrustBoundary;
  resources: CanonicalEntity[];
}

export interface RiskReport {
  totalHighRisk: number;
  resources: CanonicalEntity[];
  averageRiskScore: number;
  graph: GraphProjection;
}

export interface ExposureChainItem {
  entity: CanonicalEntity;
  internetExposed: boolean;
  trustBoundaries: TrustBoundary[];
  // The relationships connecting this entity to other entities in the chain
  relationshipsToNext: Array<{
    type: RelationshipType;
    sourceId: EntityId;
    targetId: EntityId;
  }>;
}

export interface ThreatSummary {
  sourceEntity: CanonicalEntity;
  threat: Threat;
}

export interface SecurityQueryConfig {
  tenantId: TenantId;
  neo4j: Neo4jAdapter;
  qdrant: QdrantAdapter;
}

export interface SemanticSearchResult {
  document: SemanticDocument;
  score: number;
  entity?: CanonicalEntity;
}

export interface RelationshipNode {
  entity: CanonicalEntity;
  relationships: {
    outgoing: Array<{ relationship: Relationship; target: CanonicalEntity }>;
    incoming: Array<{ relationship: Relationship; source: CanonicalEntity }>;
  };
}

export interface RelationshipGraphResult {
  nodes: RelationshipNode[];
  graph: GraphProjection;
}

export class SecurityQueryTools {
  private tenantId: TenantId;
  private neo4j: Neo4jAdapter;
  private qdrant: QdrantAdapter;

  constructor(config: SecurityQueryConfig) {
    this.tenantId = config.tenantId;
    this.neo4j = config.neo4j;
    this.qdrant = config.qdrant;
  }

  /**
   * Search for code semantically using natural language
   * Returns semantic documents with their scores and linked entities
   */
  async searchSemantic(
    query: string,
    limit: number = 10
  ): Promise<SemanticSearchResult[]> {
    // Search semantic documents collection using embeddings
    const results = await this.qdrant.searchSemanticDocuments(
      this.tenantId,
      query,
      limit
    );

    // Enrich results with linked entities
    const enrichedResults: SemanticSearchResult[] = [];
    
    for (const result of results) {
      const semanticResult: SemanticSearchResult = {
        document: result.document,
        score: result.score,
      };

      // Try to find the linked entity by ID
      try {
        const linkedEntity = await this.qdrant.getEntity(
          this.tenantId,
          result.document.artifactId
        );
        if (linkedEntity) {
          semanticResult.entity = linkedEntity;
        }
      } catch (error) {
        // Continue without entity if lookup fails
        console.warn(`Failed to lookup entity for semantic document ${result.document.id}:`, error);
      }

      enrichedResults.push(semanticResult);
    }

    return enrichedResults;
  }

  /**
   * Get a relationship graph for an entity
   * Returns the entity with all its relationships and connected entities
   * 
   * Code modules and build/deployment artifacts are shown as related entities 
   * rather than graph nodes/edges (for cleaner visualization) unless the focus 
   * entity is a module, dependency, or artifact itself
   */
  async getRelationshipGraph(
    entityId: EntityId,
    depth: number = 1
  ): Promise<RelationshipGraphResult> {
    const visited = new Set<EntityId>();
    const graphNodes: Map<EntityId, RelationshipNode> = new Map();
    const queue: Array<{ id: EntityId; currentDepth: number }> = [{ id: entityId, currentDepth: 0 }];

    // Get the focus entity to determine if we should include modules in the graph
    const focusEntity = await this.qdrant.getEntity(this.tenantId, entityId);
    if (!focusEntity) {
      return {
        nodes: [],
        graph: {
          nodes: [],
          edges: [],
          explanation: 'Entity not found',
        },
      };
    }

    // Include modules/artifacts/dependencies as nodes/edges only if the focus is one of them
    // Otherwise show them as related entities in the side panel for cleaner graphs
    // Exclude data_store completely as they duplicate cloud resources
    const includeModulesInGraph = focusEntity.entityType === 'code_module';
    const includeArtifactsInGraph = focusEntity.entityType === 'build_artifact' || 
                                     focusEntity.entityType === 'deployment_artifact';
    const includeDependenciesInGraph = focusEntity.entityType === 'dependency';
    const includeDataStoresInGraph = false; // Never include data_store nodes - they duplicate cloud resources
    // Always include identity nodes — they are first-class assets in the IAM graph
    const includeIdentitiesInGraph = true;

    while (queue.length > 0) {
      const { id, currentDepth } = queue.shift()!;
      
      if (visited.has(id) || currentDepth > depth) {
        continue;
      }
      
      visited.add(id);

      // Get entity directly by ID — try Qdrant first, fall back to Neo4j for
      // cloud graph nodes (FrontDoorProfile, FrontDoorEndpoint, etc.) that may
      // not yet be in Qdrant if the re-index hasn't run since the fix.
      let entity = await this.qdrant.getEntity(this.tenantId, id);
      if (!entity) {
        // Neo4j fallback: cloud graph nodes store their full payload in a
        // `properties` JSON column.  getNodeById reconstructs a CanonicalEntity.
        entity = await this.neo4j.getNodeById(this.tenantId, id);
      }
      if (!entity) {
        console.warn(`Entity ${id} not found in Qdrant or Neo4j`);
        continue;
      }

      // Get relationships
      const outgoing = await this.neo4j.getRelationshipsBySource(this.tenantId, id);
      const incoming = await this.neo4j.getRelationshipsByTarget(this.tenantId, id);

      // Build relationship node
      const node: RelationshipNode = {
        entity,
        relationships: {
          outgoing: await Promise.all(
            outgoing.map(async rel => {
              let target = await this.qdrant.getEntity(this.tenantId, rel.targetId);
              if (!target) target = await this.neo4j.getNodeById(this.tenantId, rel.targetId);
              if (target && currentDepth < depth) {
                // Only traverse to non-module/artifact/dependency/data_store entities, or if we're focused on them
                const isModule = target.entityType === 'code_module';
                const isArtifact = target.entityType === 'build_artifact' || target.entityType === 'deployment_artifact';
                const isDependency = target.entityType === 'dependency';
                const isDataStore = target.entityType === 'data_store';
                const isIdentity = target.entityType === 'azure_identity' || target.entityType === 'iam_role_assignment';
                const shouldTraverse = (includeModulesInGraph || !isModule) && 
                                      (includeArtifactsInGraph || !isArtifact) &&
                                      (includeDependenciesInGraph || !isDependency) &&
                                      (includeDataStoresInGraph || !isDataStore) &&
                                      (includeIdentitiesInGraph || !isIdentity);
                if (shouldTraverse) {
                  queue.push({ id: rel.targetId, currentDepth: currentDepth + 1 });
                }
              }
              return {
                relationship: rel,
                target: target!,
              };
            })
          ).then(results => results.filter(r => r.target)), // Filter out missing targets
          incoming: await Promise.all(
            incoming.map(async rel => {
              let source = await this.qdrant.getEntity(this.tenantId, rel.sourceId);
              if (!source) source = await this.neo4j.getNodeById(this.tenantId, rel.sourceId);
              if (source && currentDepth < depth) {
                // Only traverse to non-module/artifact/dependency/data_store entities, or if we're focused on them
                const isModule = source.entityType === 'code_module';
                const isArtifact = source.entityType === 'build_artifact' || source.entityType === 'deployment_artifact';
                const isDependency = source.entityType === 'dependency';
                const isDataStore = source.entityType === 'data_store';
                const isIdentity = source.entityType === 'azure_identity' || source.entityType === 'iam_role_assignment';
                const shouldTraverse = (includeModulesInGraph || !isModule) && 
                                      (includeArtifactsInGraph || !isArtifact) &&
                                      (includeDependenciesInGraph || !isDependency) &&
                                      (includeDataStoresInGraph || !isDataStore) &&
                                      (includeIdentitiesInGraph || !isIdentity);
                if (shouldTraverse) {
                  queue.push({ id: rel.sourceId, currentDepth: currentDepth + 1 });
                }
              }
              return {
                relationship: rel,
                source: source!,
              };
            })
          ).then(results => results.filter(r => r.source)), // Filter out missing sources
        },
      };

      graphNodes.set(id, node);
    }

    const nodes = Array.from(graphNodes.values());
    
    // ========================================================================
    // PHASE 1: Fetch all repositories upfront for link generation
    // ========================================================================
    const repositoryIds = new Set<EntityId>();
    
    // Collect all unique repository IDs from entities
    nodes.forEach(node => {
      const entity = node.entity as any;
      if (entity.repositoryId) {
        repositoryIds.add(entity.repositoryId);
      }
      
      // Also collect from related entities in relationships
      node.relationships.outgoing.forEach(rel => {
        const target = rel.target as any;
        if (target.repositoryId) {
          repositoryIds.add(target.repositoryId);
        }
      });
      
      node.relationships.incoming.forEach(rel => {
        const source = rel.source as any;
        if (source.repositoryId) {
          repositoryIds.add(source.repositoryId);
        }
      });
    });

    // Fetch all repositories in parallel
    const repositoryCache = new Map<EntityId, any>();
    const repoFetchPromises = Array.from(repositoryIds).map(async (repoId) => {
      const entity = await this.qdrant.getEntity(this.tenantId, repoId);
      if (entity && entity.entityType === 'code_repository') {
        repositoryCache.set(repoId, entity);
      }
    });
    await Promise.all(repoFetchPromises);

    // Helper to generate link for code path
    const generateCodeLink = (repositoryId: EntityId | undefined, codePath: string | undefined): string | undefined => {
      if (!repositoryId || !codePath) return undefined;
      
      const repo = repositoryCache.get(repositoryId) as any;
      if (!repo) return undefined;
      
      const repoUrl = repo.url?.replace(/\.git$/, '');
      if (!repoUrl) return undefined;
      
      const branch = repo.defaultBranch || 'main';
      return `${repoUrl}/blob/${branch}/${codePath}`;
    };

    // Helper to generate Azure portal link
    const generateAzurePortalLink = (resourceId: string): string => {
      return `https://portal.azure.com/#@/resource${resourceId}`;
    };

    // ========================================================================
    // PHASE 2: Build graph projection with rich metadata and links
    // ========================================================================
    const graphProjectionNodes: GraphNode[] = [];
    const graphProjectionEdges: GraphEdge[] = [];
    const addedNodes = new Set<string>();
    const addedEdges = new Set<string>();

    nodes.forEach(node => {
      const isModule = node.entity.entityType === 'code_module';
      const isBuildArtifact = node.entity.entityType === 'build_artifact';
      const isDeployArtifact = node.entity.entityType === 'deployment_artifact';
      const isDependency = node.entity.entityType === 'dependency';
      const isDataStore = node.entity.entityType === 'data_store';
      // Identity nodes are always shown in the graph
      const isIdentity = node.entity.entityType === 'azure_identity' || node.entity.entityType === 'iam_role_assignment';
      
      // Skip modules/artifacts/dependencies/data_stores as graph nodes unless we're in focused mode
      if (!isIdentity && (
          (isModule && !includeModulesInGraph) || 
          ((isBuildArtifact || isDeployArtifact) && !includeArtifactsInGraph) ||
          (isDependency && !includeDependenciesInGraph) ||
          (isDataStore && !includeDataStoresInGraph))) {
        return;
      }

      const entity = node.entity as any;
      
      // Generate link for the entity based on its type
      let entityLink: string | undefined;
      if (entity.entityType === 'cloud_resource' && entity.resourceId) {
        entityLink = generateAzurePortalLink(entity.resourceId);
      } else if (entity.entityType === 'azure_identity' && entity.principalId) {
        // Link to Azure AD / Entra object page
        entityLink = `https://portal.azure.com/#view/Microsoft_AAD_IAM/ObjectDetailsBlade/objectId/${entity.principalId}`;
      } else if (entity.repositoryId && entity.codePath) {
        entityLink = generateCodeLink(entity.repositoryId, entity.codePath);
      }

      // Collect related entities (modules and artifacts) with proper links
      const relatedEntities: any[] = [];

      // Add main node with rich metadata
      if (!addedNodes.has(node.entity.id)) {
        graphProjectionNodes.push({
          id: node.entity.id,
          type: this.mapEntityTypeToGraphNodeType(node.entity.entityType),
          label: entity.name || entity.codePath || entity.resourceName || node.entity.id,
          metadata: {
            name: entity.name,
            id: entity.id,
            type: node.entity.entityType,
            language: entity.language,
            codePath: entity.codePath,
            repository: entity.repositoryId,
            description: entity.responsibility || entity.description,
            ...(entity.entityType === 'code_service' && { serviceType: entity.serviceType }),
            ...(entity.entityType === 'dependency' && { 
              packageManager: entity.packageManager,
              version: entity.version,
            }),
            ...(entity.entityType === 'cloud_resource' && {
              resourceType: entity.resourceType,
              resourceId: entity.resourceId,
              region: entity.region,
            }),
            ...(entity.entityType === 'azure_identity' && {
              identityKind: entity.identityKind,
              principalId: entity.principalId,
              clientId: entity.clientId,
              resourceId: entity.resourceId,
              region: entity.region,
            }),
          },
          link: entityLink,
          relatedEntities: undefined, // Will be populated below
        });
        addedNodes.add(node.entity.id);
      }

      // Handle outgoing relationships
      node.relationships.outgoing.forEach(rel => {
        const target = rel.target as any;
        const targetIsModule = rel.target.entityType === 'code_module';
        const targetIsBuildArtifact = rel.target.entityType === 'build_artifact';
        const targetIsDeployArtifact = rel.target.entityType === 'deployment_artifact';
        const targetIsDependency = rel.target.entityType === 'dependency';
        const targetIsDataStore = rel.target.entityType === 'data_store';
        const targetIsIdentity = rel.target.entityType === 'azure_identity' || rel.target.entityType === 'iam_role_assignment';
        
        // Skip data_store completely - don't add as related entity or node
        if (targetIsDataStore) {
          return;
        }
        
        // Add as related entity if it's a module, artifact, or dependency and we're not in focused mode
        if (((targetIsBuildArtifact || targetIsDeployArtifact) && !includeArtifactsInGraph) ||
            (targetIsDependency && !includeDependenciesInGraph)) {
          const link = generateCodeLink(target.repositoryId, target.codePath);
          relatedEntities.push({
            id: rel.target.id,
            type: this.mapEntityTypeToGraphNodeType(rel.target.entityType),
            label: target.name || target.codePath || target.packageName || rel.target.id,
            relationshipType: rel.relationship.type,
            metadata: {
              name: target.name,
              codePath: target.codePath,
              language: target.language,
              description: target.responsibility,
              ...(targetIsDependency && {
                packageManager: target.packageManager,
                version: target.version,
                packageName: target.packageName,
              }),
            },
            link,
          });
        } else if (!targetIsModule || includeModulesInGraph) {
          // Generate link for target
          let targetLink: string | undefined;
          if (target.entityType === 'cloud_resource' && target.resourceId) {
            targetLink = generateAzurePortalLink(target.resourceId);
          } else if (target.entityType === 'azure_identity' && target.principalId) {
            targetLink = `https://portal.azure.com/#view/Microsoft_AAD_IAM/ObjectDetailsBlade/objectId/${target.principalId}`;
          } else if (target.repositoryId && target.codePath) {
            targetLink = generateCodeLink(target.repositoryId, target.codePath);
          }

          // Add target node
          if (!addedNodes.has(rel.target.id)) {
            graphProjectionNodes.push({
              id: rel.target.id,
              type: this.mapEntityTypeToGraphNodeType(rel.target.entityType),
              label: target.name || target.codePath || target.resourceName || rel.target.id,
              metadata: {
                name: target.name,
                id: target.id,
                type: rel.target.entityType,
                language: target.language,
                codePath: target.codePath,
                repository: target.repositoryId,
                description: target.responsibility || target.description,
                ...(target.entityType === 'code_service' && { serviceType: target.serviceType }),
                ...(target.entityType === 'dependency' && { 
                  packageManager: target.packageManager,
                  version: target.version,
                }),
                ...(target.entityType === 'cloud_resource' && {
                  resourceType: target.resourceType,
                  resourceId: target.resourceId,
                  region: target.region,
                }),
                ...(targetIsIdentity && {
                  identityKind: target.identityKind,
                  principalId: target.principalId,
                  clientId: target.clientId,
                }),
              },
              link: targetLink,
            });
            addedNodes.add(rel.target.id);
          }

          // Add edge
          const edgeId = `${node.entity.id}-${rel.relationship.type}-${rel.target.id}`;
          if (!addedEdges.has(edgeId)) {
            graphProjectionEdges.push({
              id: edgeId,
              from: node.entity.id,
              to: rel.target.id,
              type: rel.relationship.type as any,
              confidence: rel.relationship.confidence as any,
            });
            addedEdges.add(edgeId);
          }
        }
      });

      // Handle incoming relationships
      node.relationships.incoming.forEach(rel => {
        const source = rel.source as any;
        const sourceIsModule = rel.source.entityType === 'code_module';
        const sourceIsBuildArtifact = rel.source.entityType === 'build_artifact';
        const sourceIsDeployArtifact = rel.source.entityType === 'deployment_artifact';
        const sourceIsDependency = rel.source.entityType === 'dependency';
        const sourceIsDataStore = rel.source.entityType === 'data_store';
        const sourceIsIdentity = rel.source.entityType === 'azure_identity' || rel.source.entityType === 'iam_role_assignment';
        
        // Skip data_store completely - don't add as related entity or node
        if (sourceIsDataStore) {
          return;
        }
        
        // Add as related entity if it's a module, artifact, or dependency and we're not in focused mode
        if (((sourceIsBuildArtifact || sourceIsDeployArtifact) && !includeArtifactsInGraph) ||
            (sourceIsDependency && !includeDependenciesInGraph)) {
          const link = generateCodeLink(source.repositoryId, source.codePath);
          relatedEntities.push({
            id: rel.source.id,
            type: this.mapEntityTypeToGraphNodeType(rel.source.entityType),
            label: source.name || source.codePath || source.packageName || rel.source.id,
            relationshipType: rel.relationship.type,
            metadata: {
              name: source.name,
              codePath: source.codePath,
              language: source.language,
              description: source.responsibility,
              ...(sourceIsDependency && {
                packageManager: source.packageManager,
                version: source.version,
                packageName: source.packageName,
              }),
            },
            link,
          });
        } else if (!sourceIsModule || includeModulesInGraph) {
          // Generate link for source
          let sourceLink: string | undefined;
          if (source.entityType === 'cloud_resource' && source.resourceId) {
            sourceLink = generateAzurePortalLink(source.resourceId);
          } else if (source.entityType === 'azure_identity' && source.principalId) {
            sourceLink = `https://portal.azure.com/#view/Microsoft_AAD_IAM/ObjectDetailsBlade/objectId/${source.principalId}`;
          } else if (source.repositoryId && source.codePath) {
            sourceLink = generateCodeLink(source.repositoryId, source.codePath);
          }

          // Add source node
          if (!addedNodes.has(rel.source.id)) {
            graphProjectionNodes.push({
              id: rel.source.id,
              type: this.mapEntityTypeToGraphNodeType(rel.source.entityType),
              label: source.name || source.codePath || source.resourceName || rel.source.id,
              metadata: {
                name: source.name,
                id: source.id,
                type: rel.source.entityType,
                language: source.language,
                codePath: source.codePath,
                repository: source.repositoryId,
                description: source.responsibility || source.description,
                ...(source.entityType === 'code_service' && { serviceType: source.serviceType }),
                ...(source.entityType === 'dependency' && { 
                  packageManager: source.packageManager,
                  version: source.version,
                }),
                ...(source.entityType === 'cloud_resource' && {
                  resourceType: source.resourceType,
                  resourceId: source.resourceId,
                  region: source.region,
                }),
                ...(sourceIsIdentity && {
                  identityKind: source.identityKind,
                  principalId: source.principalId,
                  clientId: source.clientId,
                }),
              },
              link: sourceLink,
            });
            addedNodes.add(rel.source.id);
          }

          // Add edge
          const edgeId = `${rel.source.id}-${rel.relationship.type}-${node.entity.id}`;
          if (!addedEdges.has(edgeId)) {
            graphProjectionEdges.push({
              id: edgeId,
              from: rel.source.id,
              to: node.entity.id,
              type: rel.relationship.type as any,
              confidence: rel.relationship.confidence as any,
            });
            addedEdges.add(edgeId);
          }
        }
      });

      // Attach related entities to the node if any were found
      if (relatedEntities.length > 0) {
        const nodeIndex = graphProjectionNodes.findIndex(n => n.id === node.entity.id);
        if (nodeIndex >= 0) {
          graphProjectionNodes[nodeIndex].relatedEntities = relatedEntities;
        }
      }
    });

    const graphMode = includeModulesInGraph && includeArtifactsInGraph && includeDependenciesInGraph
      ? 'detailed (including modules, artifacts, and dependencies)' 
      : includeModulesInGraph && includeArtifactsInGraph
        ? 'detailed (including modules and artifacts)' 
        : includeModulesInGraph 
          ? 'detailed (including modules)' 
          : includeArtifactsInGraph 
            ? 'detailed (including artifacts)' 
            : includeDependenciesInGraph
              ? 'detailed (including dependencies)'
              : 'minimal (modules, artifacts, and dependencies as related entities)';
    
    return {
      nodes,
      graph: {
        nodes: graphProjectionNodes,
        edges: graphProjectionEdges,
        focusNodeId: focusEntity.id,
        explanation: `Relationship graph (${graphMode}) with ${graphProjectionNodes.length} nodes and ${graphProjectionEdges.length} edges`,
      },
    };
  }

  /**
   * Get all entities of a specific type
   */
  async getEntitiesByType(entityType: string): Promise<CanonicalEntity[]> {
    return this.qdrant.listEntities(this.tenantId, entityType, 1000);
  }

  /**
   * Search for entities by name or attributes
   */
  async searchEntities(searchTerm: string, entityType?: string): Promise<CanonicalEntity[]> {
    // Use the Qdrant adapter's searchEntities method with filters
    try {
      const query: any = {
        tenantId: this.tenantId,
        query: searchTerm,
        limit: 1000,
      };

      if (entityType) {
        query.entityTypes = [entityType];
      }

      // Use OR-style filters so any of the fields matching the search term will return results
      query.filters = {
        _or: [
          { field: 'name', value: searchTerm },
          { field: 'codePath', value: searchTerm },
          { field: 'resourceName', value: searchTerm },
        ],
      };

      const results = await this.qdrant.searchEntities(query);
      // Map SearchResult[] -> CanonicalEntity[] (adapter returns entity + score)
      return results.map((r: any) => r.entity as CanonicalEntity);
    } catch (err) {
      console.error('qdrant.searchEntities failed:', err);
      throw err;
    }
  }

  /**
   * Calculate blast radius for a vulnerability in a specific dependency
   */
  async analyzeVulnerabilityImpact(query: VulnerabilityQuery): Promise<VulnerabilityImpact | null> {
    const analyzer = new VulnerabilityImpactAnalyzer(this.tenantId, this.neo4j, this.qdrant);
    return analyzer.analyzeImpact(query);
  }

  /**
   * Get all services that transitively depend on a given service
   */
  async getTransitiveDependents(serviceId: EntityId, maxDepth: number = 5): Promise<CodeService[]> {
    const visited = new Set<EntityId>();
    const dependents = new Set<EntityId>();
    const queue: Array<{ id: EntityId; depth: number }> = [{ id: serviceId, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      
      if (visited.has(id) || depth >= maxDepth) {
        continue;
      }
      
      visited.add(id);

      // Get services that depend on this one
      const incomingRels = await this.neo4j.getRelationshipsByTarget(this.tenantId, id);
      const dependentIds = incomingRels
        .filter(r => r.type === 'DEPENDS_ON')
        .map(r => r.sourceId);

      for (const depId of dependentIds) {
        if (depId !== serviceId) {
          dependents.add(depId);
          queue.push({ id: depId, depth: depth + 1 });
        }
      }
    }

    // Fetch all dependent services individually
    const services: CodeService[] = [];
    for (const depId of dependents) {
      const entity = await this.qdrant.getEntity(this.tenantId, depId);
      if (entity && entity.entityType === 'code_service') {
        services.push(entity as CodeService);
      }
    }
    
    return services;
  }

  /**
   * Get all relationships of a specific type
   */
  async getRelationshipsByType(type: RelationshipType, limit?: number): Promise<Relationship[]> {
    return this.neo4j.getRelationships(this.tenantId, type, limit);
  }

  /**
   * Get threat model for a specific entity (service or resource)
   */
  async getThreatModel(entityId: EntityId): Promise<ThreatModelProjection | null> {
    const entity = await this.getEntityByIdOrName(entityId);
    if (!entity) return null;

    const threatModel = (entity as any).threatModel;
    if (!threatModel) {
      return {
        entity,
        threatModel: undefined,
        relatedThreats: [],
        exposureChain: [],
        graph: {
          nodes: [],
          edges: [],
          explanation: 'No threat model data available for this entity',
        },
      };
    }

    // Get relationships to understand exposure chain
    const exposureChain = await this.buildExposureChain(entity.id);
    
    // Get related threats from dependencies
    const relatedThreats = await this.getRelatedThreats(entity.id);

    // Build threat model graph
    const graph = await this.buildThreatModelGraph(entity.id, entity, exposureChain);

    return {
      entity,
      threatModel,
      relatedThreats,
      exposureChain,
      graph,
    };
  }

  /**
   * Get all internet-exposed resources
   */
  async getInternetExposedResources(): Promise<InternetExposureReport> {
    const allResources = await this.qdrant.listEntities(this.tenantId, 'cloud_resource', 1000);
    const allServices = await this.qdrant.listEntities(this.tenantId, 'code_service', 1000);
    
    const exposedResources = allResources.filter((r: any) => 
      r.threatModel?.internetExposed === true
    );

    const exposedServices = allServices.filter((s: any) => 
      s.threatModel?.internetExposed === true
    );

    // Build exposure graph
    const exposureGraph = await this.buildInternetExposureGraph(
      [...exposedResources, ...exposedServices]
    );

    return {
      totalExposed: exposedResources.length + exposedServices.length,
      exposedResources: exposedResources as CloudResource[],
      exposedServices: exposedServices as CodeService[],
      graph: exposureGraph,
    };
  }

  /**
   * Get trust boundary analysis
   */
  async getTrustBoundaryAnalysis(): Promise<TrustBoundaryReport> {
    const allResources = await this.qdrant.listEntities(this.tenantId, 'cloud_resource', 1000);
    const boundaryMap = new Map<string, TrustBoundaryGroup>();

    allResources.forEach((resource: any) => {
      const boundaries = resource.threatModel?.trustBoundaries || [];
      boundaries.forEach((boundary: any) => {
        if (!boundaryMap.has(boundary.name)) {
          boundaryMap.set(boundary.name, {
            boundary,
            resources: [],
          });
        }
        boundaryMap.get(boundary.name)!.resources.push(resource);
      });
    });

    const boundaries = Array.from(boundaryMap.values());

    // Build boundary graph
    const graph = await this.buildTrustBoundaryGraph(boundaries);

    return {
      totalBoundaries: boundaries.length,
      boundaries,
      graph,
    };
  }

  /**
   * Get all high-risk resources based on threat model
   */
  async getHighRiskResources(minRiskScore: number = 50): Promise<RiskReport> {
    const allResources = await this.qdrant.listEntities(this.tenantId, 'cloud_resource', 1000);
    const allServices = await this.qdrant.listEntities(this.tenantId, 'code_service', 1000);
    
    const highRiskResources = allResources.filter((r: any) => 
      (r.threatModel?.riskScore || 0) >= minRiskScore
    );

    const highRiskServices = allServices.filter((s: any) => 
      (s.threatModel?.riskScore || 0) >= minRiskScore
    );

    const allHighRisk = [...highRiskResources, ...highRiskServices].sort((a: any, b: any) => 
      (b.threatModel?.riskScore || 0) - (a.threatModel?.riskScore || 0)
    );

    // Build risk graph
    const graph = await this.buildRiskGraph(allHighRisk);

    return {
      totalHighRisk: allHighRisk.length,
      resources: allHighRisk,
      averageRiskScore: allHighRisk.reduce((sum: number, r: any) => 
        sum + (r.threatModel?.riskScore || 0), 0) / allHighRisk.length || 0,
      graph,
    };
  }

  /**
   * Build exposure chain from entity to internet
   */
  private async buildExposureChain(entityId: EntityId): Promise<ExposureChainItem[]> {
    const chain: ExposureChainItem[] = [];
    const visited = new Set<EntityId>();
    const queue: Array<{ 
      id: EntityId; 
      fromId?: EntityId;
      relationship?: Relationship;
    }> = [{ id: entityId }];

    while (queue.length > 0 && chain.length < 10) {
      const { id: currentId, fromId, relationship } = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const entity = await this.qdrant.getEntity(this.tenantId, currentId);
      if (!entity) continue;

      const threatModel = (entity as any).threatModel;
      
      // Find the chain item that corresponds to the source entity (if any)
      // and add the relationship to its list of outgoing relationships
      if (fromId && relationship) {
        const sourceItem = chain.find(item => item.entity.id === fromId);
        if (sourceItem) {
          sourceItem.relationshipsToNext.push({
            type: relationship.type,
            sourceId: relationship.sourceId,
            targetId: relationship.targetId,
          });
        }
      }

      chain.push({
        entity,
        internetExposed: threatModel?.internetExposed || false,
        trustBoundaries: threatModel?.trustBoundaries || [],
        relationshipsToNext: [],
      });

      // If this entity is internet-exposed, we've reached the end
      if (threatModel?.internetExposed) break;

      // Otherwise, follow DEPLOYED_TO and USES relationships
      const relationships = await this.neo4j.getRelationshipsBySource(this.tenantId, currentId);
      relationships
        .filter(r => r.type === 'DEPLOYED_TO' || r.type === 'USES')
        .forEach(r => queue.push({ 
          id: r.targetId, 
          fromId: currentId,
          relationship: r 
        }));
    }

    return chain;
  }

  /**
   * Get related threats from dependencies
   */
  private async getRelatedThreats(entityId: EntityId): Promise<ThreatSummary[]> {
    const threats: ThreatSummary[] = [];
    
    // Get all dependencies
    const relationships = await this.neo4j.getRelationshipsBySource(this.tenantId, entityId);
    const dependencyRels = relationships.filter(r => r.type === 'DEPENDS_ON');

    for (const rel of dependencyRels) {
      const dependency = await this.qdrant.getEntity(this.tenantId, rel.targetId);
      if (!dependency) continue;

      const depThreats = (dependency as any).threatModel?.identifiedThreats || [];
      depThreats.forEach((threat: any) => {
        threats.push({
          sourceEntity: dependency,
          threat,
        });
      });
    }

    return threats;
  }

  /**
   * Build threat model graph visualization
   */
  private async buildThreatModelGraph(
    entityId: EntityId,
    entity: CanonicalEntity,
    exposureChain: ExposureChainItem[]
  ): Promise<GraphProjection> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Add main entity
    const entityData = entity as any;
    nodes.push({
      id: entity.id,
      type: this.mapEntityTypeToGraphNodeType(entity.entityType),
      label: entityData.name || entityData.codePath || entity.id,
      metadata: {
        name: entityData.name,
        riskScore: entityData.threatModel?.riskScore,
        internetExposed: entityData.threatModel?.internetExposed,
        threats: entityData.threatModel?.identifiedThreats?.length || 0,
      },
    });

    // Add exposure chain nodes and edges
    exposureChain.forEach((item, index) => {
      const itemData = item.entity as any;
      if (item.entity.id !== entityId) {
        nodes.push({
          id: item.entity.id,
          type: this.mapEntityTypeToGraphNodeType(item.entity.entityType),
          label: itemData.name || itemData.codePath || item.entity.id,
          metadata: {
            name: itemData.name,
            internetExposed: item.internetExposed,
            trustBoundaries: item.trustBoundaries.map((b: TrustBoundary) => b.name).join(', '),
          },
        });
      }

      // Add all edges from this chain item using the relationships stored in it
      item.relationshipsToNext.forEach(relationship => {
        edges.push({
          id: `${relationship.sourceId}-${relationship.targetId}`,
          from: relationship.sourceId,
          to: relationship.targetId,
          type: relationship.type as any,
          confidence: 'deterministic',
        });
      });
    });

    // Add threat nodes
    const threats = entityData.threatModel?.identifiedThreats || [];
    threats.forEach((threat: any, index: number) => {
      const threatId = `threat-${entity.id}-${index}`;
      nodes.push({
        id: threatId,
        type: 'Threat',
        label: threat.description.substring(0, 50) + '...',
        severity: threat.severity,
        metadata: {
          category: threat.category,
          severity: threat.severity,
          mitigations: threat.mitigations?.join(', '),
          status: threat.status,
        },
      });

      edges.push({
        id: `${entity.id}-${threatId}`,
        from: threatId,
        to: entity.id,
        type: 'THREATENS',
        confidence: 'deterministic',
        label: threat.category,
      });
    });

    return {
      nodes,
      edges,
      focusNodeId: entityId,
      explanation: `Threat model for ${entityData.name || entity.id} with ${threats.length} identified threats`,
    };
  }

  /**
   * Build internet exposure graph
   */
  private async buildInternetExposureGraph(exposedEntities: CanonicalEntity[]): Promise<GraphProjection> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Add internet node
    nodes.push({
      id: 'internet',
      type: 'TrustBoundary',
      label: 'Internet',
      metadata: { boundaryType: 'external' },
    });

    // Add exposed entities
    for (const entity of exposedEntities) {
      const entityData = entity as any;
      nodes.push({
        id: entity.id,
        type: this.mapEntityTypeToGraphNodeType(entity.entityType),
        label: entityData.name || entityData.codePath || entity.id,
        metadata: {
          name: entityData.name,
          publicEndpoint: entityData.threatModel?.publicEndpoint,
          riskScore: entityData.threatModel?.riskScore,
        },
      });

      edges.push({
        id: `internet-${entity.id}`,
        from: 'internet',
        to: entity.id,
        type: 'EXPOSES',
        confidence: 'deterministic',
        label: 'public access',
      });
    }

    return {
      nodes,
      edges,
      explanation: `${exposedEntities.length} resources exposed to the internet`,
    };
  }

  /**
   * Build trust boundary graph
   */
  private async buildTrustBoundaryGraph(boundaries: TrustBoundaryGroup[]): Promise<GraphProjection> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    boundaries.forEach(group => {
      // Add boundary node
      nodes.push({
        id: `boundary-${group.boundary.name}`,
        type: 'TrustBoundary',
        label: group.boundary.name,
        metadata: {
          type: group.boundary.type,
          resourceCount: group.resources.length,
        },
      });

      // Add resources in this boundary
      group.resources.forEach((resource: CanonicalEntity) => {
        const resourceData = resource as any;
        const resourceNodeId = `${group.boundary.name}-${resource.id}`;
        
        nodes.push({
          id: resourceNodeId,
          type: this.mapEntityTypeToGraphNodeType(resource.entityType),
          label: resourceData.name || resource.id,
          metadata: {
            name: resourceData.name,
            riskScore: resourceData.threatModel?.riskScore,
          },
        });

        edges.push({
          id: `${resourceNodeId}-boundary`,
          from: resourceNodeId,
          to: `boundary-${group.boundary.name}`,
          type: 'CROSSES',
          confidence: 'deterministic',
        });
      });
    });

    return {
      nodes,
      edges,
      explanation: `${boundaries.length} trust boundaries identified`,
    };
  }

  /**
   * Build risk graph
   */
  private async buildRiskGraph(highRiskEntities: CanonicalEntity[]): Promise<GraphProjection> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Group by risk level
    const critical = highRiskEntities.filter((e: any) => (e.threatModel?.riskScore || 0) >= 80);
    const high = highRiskEntities.filter((e: any) => {
      const score = e.threatModel?.riskScore || 0;
      return score >= 50 && score < 80;
    });

    // Add risk level nodes
    if (critical.length > 0) {
      nodes.push({
        id: 'risk-critical',
        type: 'RiskLevel',
        label: `Critical Risk (${critical.length})`,
        severity: 'critical',
        metadata: { level: 'critical', count: critical.length },
      });
    }

    if (high.length > 0) {
      nodes.push({
        id: 'risk-high',
        type: 'RiskLevel',
        label: `High Risk (${high.length})`,
        severity: 'high',
        metadata: { level: 'high', count: high.length },
      });
    }

    // Add entity nodes and edges
    [...critical, ...high].forEach(entity => {
      const entityData = entity as any;
      const riskScore = entityData.threatModel?.riskScore || 0;
      const riskLevel = riskScore >= 80 ? 'critical' : 'high';

      nodes.push({
        id: entity.id,
        type: this.mapEntityTypeToGraphNodeType(entity.entityType),
        label: entityData.name || entityData.codePath || entity.id,
        severity: riskLevel === 'critical' ? 'critical' : 'high',
        metadata: {
          name: entityData.name,
          riskScore,
          threats: entityData.threatModel?.identifiedThreats?.length || 0,
        },
      });

      edges.push({
        id: `${entity.id}-risk`,
        from: entity.id,
        to: `risk-${riskLevel}`,
        type: 'HAS_RISK',
        confidence: 'deterministic',
        label: `score: ${riskScore}`,
      });
    });

    return {
      nodes,
      edges,
      explanation: `${highRiskEntities.length} high-risk resources identified`,
    };
  }

  /**
   * Map entity type to graph node type
   */
  private mapEntityTypeToGraphNodeType(entityType: string): GraphNodeType {
    switch (entityType) {
      case 'code_module':
        return 'CodeModule';
      case 'code_service':
        return 'CodeService';
      case 'build_artifact':
        return 'BuildArtifact';
      case 'deployment_artifact':
        return 'DeploymentArtifact';
      case 'cloud_resource':
        return 'CloudResource';
      case 'dependency':
        return 'Dependency';
      case 'azure_identity':
      case 'iam_role_assignment':
        return 'AzureIdentity';
      default:
        return 'CodeModule';
    }
  }

  /**
   * Get entity by ID or name
   * If the input looks like an ID (contains slashes or special chars), search by ID
   * Otherwise, search by name
   */
  private async getEntityByIdOrName(idOrName: string): Promise<CanonicalEntity | null> {
    // First, try to get by ID directly
    const entityById = await this.qdrant.getEntity(this.tenantId, idOrName);
    if (entityById) {
      return entityById;
    }

    // Search by name across all entity types
    const searchResults = await this.qdrant.searchEntities({
      tenantId: this.tenantId,
      name: idOrName,
      query: idOrName,
      limit: 10,
    });

    // Find exact match by name
    for (const result of searchResults) {
      const entity = (result as any).entity as CanonicalEntity;
      const entityName = (entity as any).name;
      if (entityName && entityName.toLowerCase() === idOrName.toLowerCase()) {
        return entity;
      }
    }

    // If no exact match, return the first result (highest relevance)
    if (searchResults.length > 0) {
      return (searchResults[0] as any).entity as CanonicalEntity;
    }

    return null;
  }
}
