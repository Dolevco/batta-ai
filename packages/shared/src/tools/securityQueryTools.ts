/**
 * Security Analysis Tools
 * 
 * Tools for querying indexed security data and analyzing relationships
 */

import { PostgresGraphAdapter } from '../persistence/graph-adapter';
import { PostgresDataAdapter } from '../persistence/data-adapter';
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
} from '@batta/core';

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
  graphAdapter: PostgresGraphAdapter;
  dataAdapter: PostgresDataAdapter;
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
  private graphAdapter: PostgresGraphAdapter;
  private dataAdapter: PostgresDataAdapter;

  constructor(config: SecurityQueryConfig) {
    this.tenantId = config.tenantId;
    this.graphAdapter = config.graphAdapter;
    this.dataAdapter = config.dataAdapter;
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
    const results = await this.dataAdapter.searchSemanticDocuments(
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
        const linkedEntity = await this.dataAdapter.getEntity(
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
   * Get a relationship graph for an entity.
   * Returns the entity with all its relationships and connected entities.
   *
   * Optimised to use only 2 DB round-trips:
   *   1. A single graph query that returns the full subgraph up to
   *      `depth` hops, excluding structural super-nodes (Tenant, CodeRepository)
   *      that would cause combinatorial explosion.
   *   2. A single batch-fetch for all entity payloads.
   *
   * Code modules and build/deployment artifacts are shown as related entities
   * rather than graph nodes/edges (for cleaner visualisation) unless the focus
   * entity is a module, dependency, or artifact itself.
   */
  async getRelationshipGraph(
    entityId: EntityId,
    depth: number = 1
  ): Promise<RelationshipGraphResult> {

    // ── Step 1: Fetch focus entity ───────────────────────────────────────
    const focusEntity = await this.dataAdapter.getEntity(this.tenantId, entityId);
    if (!focusEntity) {
      return {
        nodes: [],
        graph: { nodes: [], edges: [], explanation: 'Entity not found' },
      };
    }

    // Determine which entity types to promote to full graph nodes vs. related entities
    const includeModulesInGraph   = focusEntity.entityType === 'code_module';
    const includeArtifactsInGraph = focusEntity.entityType === 'build_artifact' ||
                                    focusEntity.entityType === 'deployment_artifact';
    const includeDependenciesInGraph = focusEntity.entityType === 'dependency';

    // ── Step 2: Fetch full subgraph from graph store ──────────────────────
    // Exclude structural super-nodes that fan out to every entity.
    const excludeNodeTypes = ['Tenant', 'CodeRepository'];
    const subgraph = await this.graphAdapter.getSubgraph(
      this.tenantId,
      entityId,
      depth,
      excludeNodeTypes,
    );

    // ── Step 3: Batch-fetch all entity payloads ───────────────────────────
    const entityMap = await this.dataAdapter.getEntitiesByIds(
      this.tenantId,
      subgraph.nodeIds,
    );

    // For any IDs not found in the data store, try graph adapter fallback (cloud graph nodes
    // that haven't been re-indexed yet).  Collect missing IDs first so we can
    // do the fallbacks in parallel.
    const missingIds = subgraph.nodeIds.filter(id => !entityMap.has(id));
    if (missingIds.length > 0) {
      const fallbackResults = await Promise.all(
        missingIds.map(id => this.graphAdapter.getNodeById(this.tenantId, id)),
      );
      fallbackResults.forEach((entity, i) => {
        if (entity) entityMap.set(missingIds[i], entity);
      });
    }

    // Ensure the focus entity is in the map
    if (!entityMap.has(entityId)) {
      entityMap.set(entityId, focusEntity);
    }

    // ── Step 4: Build per-node relationship structures in-memory ────────
    // Index: nodeId → { outgoing[], incoming[] }
    const relIndex = new Map<string, {
      outgoing: Array<{ type: string; targetId: string; props: Record<string, any> }>;
      incoming: Array<{ type: string; sourceId: string; props: Record<string, any> }>;
    }>();

    const ensureIndex = (id: string) => {
      if (!relIndex.has(id)) relIndex.set(id, { outgoing: [], incoming: [] });
      return relIndex.get(id)!;
    };

    for (const rel of subgraph.relationships) {
      ensureIndex(rel.sourceId).outgoing.push({
        type: rel.type,
        targetId: rel.targetId,
        props: rel.properties,
      });
      ensureIndex(rel.targetId).incoming.push({
        type: rel.type,
        sourceId: rel.sourceId,
        props: rel.properties,
      });
    }

    // Build RelationshipNode[] (the "nodes" field of the result)
    const relationshipNodes: RelationshipNode[] = [];
    for (const nodeId of subgraph.nodeIds) {
      const entity = entityMap.get(nodeId);
      if (!entity) continue;

      const idx = relIndex.get(nodeId) || { outgoing: [], incoming: [] };

      const outgoing = idx.outgoing
        .map(r => {
          const target = entityMap.get(r.targetId);
          if (!target) return null;
          return {
            relationship: {
              id: `${nodeId}-${r.type}-${r.targetId}`,
              tenantId: this.tenantId,
              sourceId: nodeId,
              targetId: r.targetId,
              type: r.type as RelationshipType,
              confidence: (r.props.confidence || 'high') as any,
            } as Relationship,
            target,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      const incoming = idx.incoming
        .map(r => {
          const source = entityMap.get(r.sourceId);
          if (!source) return null;
          return {
            relationship: {
              id: `${r.sourceId}-${r.type}-${nodeId}`,
              tenantId: this.tenantId,
              sourceId: r.sourceId,
              targetId: nodeId,
              type: r.type as RelationshipType,
              confidence: (r.props.confidence || 'high') as any,
            } as Relationship,
            source,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      relationshipNodes.push({ entity, relationships: { outgoing, incoming } });
    }

    // ── Step 5: Collect repository IDs & batch-fetch for link generation ──
    const repositoryIds = new Set<EntityId>();
    for (const entity of entityMap.values()) {
      const e = entity as any;
      if (e.repositoryId) repositoryIds.add(e.repositoryId);
    }

    // Only fetch repos not already in the entity map
    const missingRepoIds = Array.from(repositoryIds).filter(id => !entityMap.has(id));
    const repoMap = missingRepoIds.length > 0
      ? await this.dataAdapter.getEntitiesByIds(this.tenantId, missingRepoIds)
      : new Map<string, CanonicalEntity>();
    // Merge already-fetched repos
    for (const repoId of repositoryIds) {
      if (entityMap.has(repoId)) repoMap.set(repoId, entityMap.get(repoId)!);
    }

    // Link helpers
    const generateCodeLink = (repositoryId: EntityId | undefined, codePath: string | undefined): string | undefined => {
      if (!repositoryId || !codePath) return undefined;
      const repo = repoMap.get(repositoryId) as any;
      if (!repo) return undefined;
      const repoUrl = repo.url?.replace(/\.git$/, '');
      if (!repoUrl) return undefined;
      return `${repoUrl}/blob/${repo.defaultBranch || 'main'}/${codePath}`;
    };

    const generateAzurePortalLink = (resourceId: string): string =>
      `https://portal.azure.com/#@/resource${resourceId}`;

    const generateEntityLink = (entity: any): string | undefined => {
      if (entity.entityType === 'cloud_resource' && entity.resourceId)
        return generateAzurePortalLink(entity.resourceId);
      if (entity.entityType === 'azure_identity' && entity.principalId)
        return `https://portal.azure.com/#view/Microsoft_AAD_IAM/ObjectDetailsBlade/objectId/${entity.principalId}`;
      if (entity.repositoryId && entity.codePath)
        return generateCodeLink(entity.repositoryId, entity.codePath);
      return undefined;
    };

    // ── Step 6: Build graph projection ──────────────────────────────────
    const graphProjectionNodes: GraphNode[] = [];
    const graphProjectionEdges: GraphEdge[] = [];
    const addedNodes = new Set<string>();
    const addedEdges = new Set<string>();

    /**
     * Decide whether an entity type should appear as a full graph node
     * or be demoted to a "related entity" attached to its parent node.
     */
    const shouldBeGraphNode = (entityType: string): boolean => {
      if (entityType === 'data_store') return true; // now fully-populated entities – show in graph
      if (entityType === 'code_module' && !includeModulesInGraph) return false;
      if ((entityType === 'build_artifact' || entityType === 'deployment_artifact') && !includeArtifactsInGraph) return false;
      if (entityType === 'dependency' && !includeDependenciesInGraph) return false;
      return true;
    };

    const buildNodeMetadata = (entity: any) => ({
      name: entity.name,
      id: entity.id,
      type: entity.entityType,
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
      ...((entity.entityType === 'azure_identity' || entity.entityType === 'iam_role_assignment') && {
        identityKind: entity.identityKind,
        principalId: entity.principalId,
        clientId: entity.clientId,
        resourceId: entity.resourceId,
        region: entity.region,
      }),
    });

    const addGraphNode = (entity: any) => {
      if (addedNodes.has(entity.id)) return;
      addedNodes.add(entity.id);
      graphProjectionNodes.push({
        id: entity.id,
        type: this.mapEntityTypeToGraphNodeType(entity.entityType),
        label: entity.name || entity.codePath || entity.resourceName || entity.id,
        metadata: buildNodeMetadata(entity),
        link: generateEntityLink(entity),
      });
    };

    for (const node of relationshipNodes) {
      const entity = node.entity as any;
      if (!shouldBeGraphNode(entity.entityType)) continue;

      addGraphNode(entity);

      const relatedEntities: any[] = [];

      // Process outgoing
      for (const rel of node.relationships.outgoing) {
        const target = rel.target as any;
        // data_store nodes are now fully populated — do not skip them

        if (!shouldBeGraphNode(target.entityType)) {
          // Demote to related entity
          relatedEntities.push({
            id: target.id,
            type: this.mapEntityTypeToGraphNodeType(target.entityType),
            label: target.name || target.codePath || target.packageName || target.id,
            relationshipType: rel.relationship.type,
            metadata: {
              name: target.name,
              codePath: target.codePath,
              language: target.language,
              description: target.responsibility,
              ...(target.entityType === 'dependency' && {
                packageManager: target.packageManager,
                version: target.version,
                packageName: target.packageName,
              }),
            },
            link: generateCodeLink(target.repositoryId, target.codePath),
          });
        } else {
          addGraphNode(target);
          const edgeId = `${entity.id}-${rel.relationship.type}-${target.id}`;
          if (!addedEdges.has(edgeId)) {
            addedEdges.add(edgeId);
            graphProjectionEdges.push({
              id: edgeId,
              from: entity.id,
              to: target.id,
              type: rel.relationship.type as any,
              confidence: rel.relationship.confidence as any,
            });
          }
        }
      }

      // Process incoming
      for (const rel of node.relationships.incoming) {
        const source = rel.source as any;
        // data_store nodes are now fully populated — do not skip them

        if (!shouldBeGraphNode(source.entityType)) {
          relatedEntities.push({
            id: source.id,
            type: this.mapEntityTypeToGraphNodeType(source.entityType),
            label: source.name || source.codePath || source.packageName || source.id,
            relationshipType: rel.relationship.type,
            metadata: {
              name: source.name,
              codePath: source.codePath,
              language: source.language,
              description: source.responsibility,
              ...(source.entityType === 'dependency' && {
                packageManager: source.packageManager,
                version: source.version,
                packageName: source.packageName,
              }),
            },
            link: generateCodeLink(source.repositoryId, source.codePath),
          });
        } else {
          addGraphNode(source);
          const edgeId = `${source.id}-${rel.relationship.type}-${entity.id}`;
          if (!addedEdges.has(edgeId)) {
            addedEdges.add(edgeId);
            graphProjectionEdges.push({
              id: edgeId,
              from: source.id,
              to: entity.id,
              type: rel.relationship.type as any,
              confidence: rel.relationship.confidence as any,
            });
          }
        }
      }

      // Attach related entities
      if (relatedEntities.length > 0) {
        const nodeIndex = graphProjectionNodes.findIndex(n => n.id === entity.id);
        if (nodeIndex >= 0) {
          graphProjectionNodes[nodeIndex].relatedEntities = relatedEntities;
        }
      }
    }

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
      nodes: relationshipNodes,
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
    return this.dataAdapter.listEntities(this.tenantId, entityType, 1000);
  }

  /**
   * Search for entities by name or attributes
   */
  async searchEntities(searchTerm: string, entityType?: string): Promise<CanonicalEntity[]> {
    // Use the data adapter's searchEntities method with filters
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

      const results = await this.dataAdapter.searchEntities(query);
      // Map SearchResult[] -> CanonicalEntity[] (adapter returns entity + score)
      return results.map((r: any) => r.entity as CanonicalEntity);
    } catch (err) {
      console.error('dataAdapter.searchEntities failed:', err);
      throw err;
    }
  }

  /**
   * Calculate blast radius for a vulnerability in a specific dependency
   */
  async analyzeVulnerabilityImpact(query: VulnerabilityQuery): Promise<VulnerabilityImpact | null> {
    const analyzer = new VulnerabilityImpactAnalyzer(this.tenantId, this.graphAdapter, this.dataAdapter);
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
      const incomingRels = await this.graphAdapter.getRelationshipsByTarget(this.tenantId, id);
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
      const entity = await this.dataAdapter.getEntity(this.tenantId, depId);
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
    return this.graphAdapter.getRelationships(this.tenantId, type, limit);
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
    const allResources = await this.dataAdapter.listEntities(this.tenantId, 'cloud_resource', 1000);
    const allServices = await this.dataAdapter.listEntities(this.tenantId, 'code_service', 1000);
    
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
    const allResources = await this.dataAdapter.listEntities(this.tenantId, 'cloud_resource', 1000);
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
    const allResources = await this.dataAdapter.listEntities(this.tenantId, 'cloud_resource', 1000);
    const allServices = await this.dataAdapter.listEntities(this.tenantId, 'code_service', 1000);
    
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

      const entity = await this.dataAdapter.getEntity(this.tenantId, currentId);
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
      const relationships = await this.graphAdapter.getRelationshipsBySource(this.tenantId, currentId);
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
    const relationships = await this.graphAdapter.getRelationshipsBySource(this.tenantId, entityId);
    const dependencyRels = relationships.filter(r => r.type === 'DEPENDS_ON');

    for (const rel of dependencyRels) {
      const dependency = await this.dataAdapter.getEntity(this.tenantId, rel.targetId);
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
    exposureChain.forEach((item) => {
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
      case 'data_store':
        return 'DataStore' as GraphNodeType;
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
    const entityById = await this.dataAdapter.getEntity(this.tenantId, idOrName);
    if (entityById) {
      return entityById;
    }

    // Search by name across all entity types
    const searchResults = await this.dataAdapter.searchEntities({
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
