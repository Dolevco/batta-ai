import type {
  Asset,
  AssetCategory,
  TenantId,
  CanonicalEntity,
  ThreatModelData,
  CodeService,
  DataStore,
  DataStoreServiceAccess,
} from '../types';
import type { ServiceDfd, ServiceThreatModel } from '../types/business-feature.types';
import { PostgresDataAdapter } from '../persistence/data-adapter';
import { PostgresGraphAdapter } from '../persistence/graph-adapter';
import { SecurityQueryTools } from '../tools/securityQueryTools';
import type { IIndexingRunRepository } from '../persistence/interfaces';
import type { GraphProjection } from '@batta/core';

export interface AssetDetail extends Asset {
  responsibility?: string;
  threatModel?: ThreatModelData;
  /** Service-level merged DFD, present on code_service entities after feature extraction */
  serviceDfd?: ServiceDfd;
  /** Service-level STRIDE threat model, present on code_service entities after feature extraction */
  serviceThreatModel?: ServiceThreatModel;
  fullEntity: CanonicalEntity;
  link?: string; // Add link field for entity URLs
}

export interface RelationshipNode {
  id: string;
  type: string;
  name: string;
  metadata: Record<string, any>;
}

export interface RelationshipEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  metadata: Record<string, any>;
}

export interface RelationshipGraph {
  nodes: RelationshipNode[];
  edges: RelationshipEdge[];
  graph?: GraphProjection; // Include the full graph projection from SecurityQueryTools
}

export interface RepositoryArtifact {
  id: string;
  entityType: string;
  name: string;
  codePath?: string;
  language?: string;
  techStack?: string[];
  serviceType?: string;
  buildType?: string;
  deploymentType?: string;
  technology?: string;
  isEntryPoint?: boolean;
  entryType?: string;
  responsibility?: string;
  riskScore?: number;
  businessCriticality?: 'critical' | 'high' | 'medium' | 'low';
  serviceIds?: string[];
  link?: string;
  /** The repository this artifact belongs to (resolved name, not ID) */
  repositoryName?: string;
  metadata: Record<string, any>;
}

export interface RepositoryArtifacts {
  repositoryId: string;
  services: RepositoryArtifact[];
  builds: RepositoryArtifact[];
  deployments: RepositoryArtifact[];
  modules: RepositoryArtifact[];
  cloudResources: RepositoryArtifact[];
}

// ── Data Store types ──────────────────────────────────────────────────────────

export interface DataStoreSummary {
  id: string;
  name: string;
  storeType: string;
  technology?: string;
  dataClassification?: string;
  encryptionAtRest?: boolean;
  cloudResourceName?: string;
  serviceCount: number;
  featureCount: number;
  dataTypes: string[];
  responsibility?: string;
  lastIndexedAt?: string;
}

export interface DataStoreDetail extends DataStoreSummary {
  cloudResourceId?: string;
  encryptionInTransit?: boolean;
  serviceAccess: DataStoreServiceAccess[];
  featureIds: string[];
  featureNames?: string[];
  metadata: Record<string, any>;
}

export class AssetService {
  constructor(
    private adapter: PostgresDataAdapter,
    private graphAdapter?: PostgresGraphAdapter,
    private indexingRunRepository?: IIndexingRunRepository,
  ) {
    // Initialize SecurityQueryTools if graphAdapter is available
    // We'll need to pass tenantId when calling methods
  }

  async getAssetsByCategory(tenantId: TenantId, category: string): Promise<Asset[]> {
    const entities = await this.adapter.listEntities(tenantId, category, 1000);
    const assets = entities.map(entity => this.mapEntityToAsset(entity));

    // For code_service assets, resolve repository names from their repositoryId
    if (category === 'code_service') {
      console.log(`[AssetService] getAssetsByCategory: found ${assets.length} code_service assets`);

      // Collect unique repository IDs — repositoryId may live directly on the entity
      // OR be mapped into metadata by mapEntityToAsset. Check both.
      const repoIds = new Set<string>();
      assets.forEach((a, idx) => {
        const repoIdFromMeta = a.metadata?.repositoryId;
        // Also check the raw entity in case it wasn't mapped
        const rawEntity = entities[idx];
        const repoIdFromEntity = (rawEntity as any).repositoryId;
        const repoId = repoIdFromMeta || repoIdFromEntity;
        if (repoId) {
          repoIds.add(repoId);
          // Ensure it's in metadata for the enrichment step below
          if (!a.metadata) a.metadata = {};
          a.metadata.repositoryId = repoId;
        }
        console.log(`[AssetService]   service "${a.name}": repositoryId from meta=${repoIdFromMeta}, from entity=${repoIdFromEntity}`);
      });

      console.log(`[AssetService] unique repoIds to resolve: ${Array.from(repoIds).join(', ')}`);

      if (repoIds.size > 0) {
        // Fetch repository entities to get their names
        const repoNameMap = new Map<string, string>();
        await Promise.all(Array.from(repoIds).map(async (repoId) => {
          try {
            const repoEntity = await this.adapter.getEntity(tenantId, repoId);
            console.log(`[AssetService]   fetched repo entity for id="${repoId}": found=${!!repoEntity}, name=${(repoEntity as any)?.name}`);
            if (repoEntity) {
              const name = (repoEntity as any).name || (repoEntity as any).path || repoId;
              repoNameMap.set(repoId, name);
            }
          } catch (err) {
            console.warn(`[AssetService]   failed to fetch repo entity "${repoId}":`, err);
          }
        }));

        console.log(`[AssetService] repoNameMap:`, Object.fromEntries(repoNameMap));

        // Enrich assets with resolved repository name
        assets.forEach(a => {
          const repoId = a.metadata?.repositoryId;
          if (repoId && repoNameMap.has(repoId)) {
            a.metadata.repositoryName = repoNameMap.get(repoId);
          }
        });
      }
    }

    return assets;
  }

  async getAssetById(tenantId: TenantId, assetId: string): Promise<AssetDetail | null> {
    console.log('[AssetService] getAssetById called with assetId:', assetId, 'tenantId:', tenantId);
    const entity = await this.adapter.getEntity(tenantId, assetId);
    
    if (!entity) {
      console.log('[AssetService] Entity not found for assetId:', assetId);
      return null;
    }

    console.log('[AssetService] Found entity:', entity.entityType, entity.id);
    // Get the full entity details and map to AssetDetail
    return this.mapEntityToAssetDetail(entity);
  }

  async getAssetRelationships(tenantId: TenantId, assetId: string): Promise<RelationshipGraph> {
    if (!this.graphAdapter) {
      return { nodes: [], edges: [] };
    }

    try {
      // Use SecurityQueryTools to build the relationship graph
      // This ensures we exclude code modules and use the same logic as security tools
      const securityQueryTools = new SecurityQueryTools({
        tenantId,
        graphAdapter: this.graphAdapter!,
        dataAdapter: this.adapter,
      });

      // The number of hops needed depends on the entity type:
      //   cloud_resource: 6 — deep cloud topology chains, e.g. AFD:
      //                       Internet→Profile→Endpoint→Route→OriginGroup→Origin→compute (6 hops)
      //   code_service:   3 — service → CALLS_API → service → READS_FROM → cloud_resource
      //   others:         2 — usually 1–2 hops to reach immediate neighbours + their cloud deps
      const focusEntityForDepth = await this.adapter.getEntity(tenantId, assetId);
      const entityType = focusEntityForDepth?.entityType;
      const graphDepth = entityType === 'cloud_resource' ? 6
                       : entityType === 'code_service'   ? 3
                       : 2;
      const relationshipGraphResult = await securityQueryTools.getRelationshipGraph(assetId, graphDepth);
      
      if (!relationshipGraphResult || relationshipGraphResult.nodes.length === 0) {
        return { nodes: [], edges: [] };
      }

      // Transform the SecurityQueryTools result to our RelationshipGraph format
      // Extract nodes and edges from the graph projection
      const nodes: RelationshipNode[] = relationshipGraphResult.graph.nodes.map(node => ({
        id: node.id,
        type: node.type,
        name: node.label,
        metadata: {
          ...node.metadata,
          link: node.link,
        },
      }));

      const edges: RelationshipEdge[] = relationshipGraphResult.graph.edges.map(edge => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        type: edge.type,
        metadata: {
          confidence: edge.confidence,
          label: edge.label,
        },
      }));

      return {
        nodes,
        edges,
        graph: relationshipGraphResult.graph, // Include full graph projection for UI
      };
    } catch (error) {
      console.error('Failed to get asset relationships:', error);
      return { nodes: [], edges: [] };
    }
  }

  async getRepositoryArtifacts(tenantId: TenantId, repositoryId: string): Promise<RepositoryArtifacts> {
    const result: RepositoryArtifacts = {
      repositoryId,
      services: [],
      builds: [],
      deployments: [],
      modules: [],
      cloudResources: [],
    };

    if (!this.graphAdapter) {
      // Fallback: scan data store for entities whose repositoryId matches
      const artifactTypes = ['code_service', 'build_artifact', 'deployment_artifact', 'code_module'];
      await Promise.all(artifactTypes.map(async (entityType) => {
        const entities = await this.adapter.listEntities(tenantId, entityType, 2000);
        entities
          .filter((e: any) => e.repositoryId === repositoryId)
          .forEach((e: CanonicalEntity) => {
            const artifact = this.mapEntityToRepositoryArtifact(e);
            if (e.entityType === 'code_service') result.services.push(artifact);
            else if (e.entityType === 'build_artifact') result.builds.push(artifact);
            else if (e.entityType === 'deployment_artifact') result.deployments.push(artifact);
            else if (e.entityType === 'code_module') result.modules.push(artifact);
          });
      }));
      return result;
    }

    // Use graph store to follow CONTAINS / BUILDS / DEPLOYS relationships from the repo
    const outgoing = await this.graphAdapter.getRelationshipsBySource(tenantId, repositoryId);

    // Also fetch services, then their builds/deployments/modules via graph store
    const serviceIds: string[] = [];

    await Promise.all(outgoing.map(async (rel: any) => {
      const entity = await this.adapter.getEntity(tenantId, rel.targetId);
      if (!entity) return;
      const artifact = this.mapEntityToRepositoryArtifact(entity);

      switch (entity.entityType) {
        case 'code_service':
          result.services.push(artifact);
          serviceIds.push(entity.id);
          break;
        case 'build_artifact':
          result.builds.push(artifact);
          break;
        case 'deployment_artifact':
          result.deployments.push(artifact);
          break;
        case 'code_module':
          result.modules.push(artifact);
          break;
        case 'cloud_resource':
          result.cloudResources.push(artifact);
          break;
      }
    }));

    // Also walk service relationships to pick up builds/deployments/modules not directly on repo
    if (serviceIds.length > 0 && this.graphAdapter) {
      await Promise.all(serviceIds.map(async (svcId) => {
        const svcRels = await this.graphAdapter!.getRelationshipsBySource(tenantId, svcId);
        await Promise.all(svcRels.map(async (rel: any) => {
          const entity = await this.adapter.getEntity(tenantId, rel.targetId);
          if (!entity) return;
          // Avoid duplicates
          const artifact = this.mapEntityToRepositoryArtifact(entity);
          const isDup = (arr: RepositoryArtifact[]) => arr.some(a => a.id === entity.id);

          switch (entity.entityType) {
            case 'build_artifact':
              if (!isDup(result.builds)) result.builds.push(artifact);
              break;
            case 'deployment_artifact':
              if (!isDup(result.deployments)) result.deployments.push(artifact);
              break;
            case 'code_module':
              if (!isDup(result.modules)) result.modules.push(artifact);
              break;
            case 'cloud_resource':
              if (!isDup(result.cloudResources)) result.cloudResources.push(artifact);
              break;
          }
        }));
      }));
    }

    // If graph store gave us nothing (graph not yet projected), fall back to data store scan
    const totalFound = result.services.length + result.builds.length + result.deployments.length + result.modules.length;
    if (totalFound === 0) {
      const artifactTypes = ['code_service', 'build_artifact', 'deployment_artifact', 'code_module'];
      await Promise.all(artifactTypes.map(async (entityType) => {
        const entities = await this.adapter.listEntities(tenantId, entityType, 2000);
        entities
          .filter((e: any) => e.repositoryId === repositoryId)
          .forEach((e: CanonicalEntity) => {
            const artifact = this.mapEntityToRepositoryArtifact(e);
            if (e.entityType === 'code_service') result.services.push(artifact);
            else if (e.entityType === 'build_artifact') result.builds.push(artifact);
            else if (e.entityType === 'deployment_artifact') result.deployments.push(artifact);
            else if (e.entityType === 'code_module') result.modules.push(artifact);
          });
      }));
    }

    return result;
  }

  private mapEntityToRepositoryArtifact(entity: CanonicalEntity): RepositoryArtifact {
    const e = entity as any;
    const threatModel = e.threatModel;
    return {
      id: entity.id,
      entityType: entity.entityType,
      name: e.name || e.codePath || e.resourceName || entity.id,
      codePath: e.codePath,
      language: e.language,
      techStack: e.techStack,
      serviceType: e.serviceType,
      buildType: e.buildType,
      deploymentType: e.deploymentType,
      technology: e.technology,
      isEntryPoint: e.isEntryPoint,
      entryType: e.entryType,
      responsibility: e.responsibility,
      riskScore: threatModel?.riskScore,
      businessCriticality: this.determineBusinessCriticality(entity),
      serviceIds: e.serviceIds,
      link: this.generateEntityLink(entity),
      metadata: {
        ...entity.metadata,
        name: e.name,
        language: e.language,
        techStack: e.techStack,
        serviceType: e.serviceType,
        buildType: e.buildType,
        deploymentType: e.deploymentType,
        technology: e.technology,
        isEntryPoint: e.isEntryPoint,
        entryType: e.entryType,
        responsibility: e.responsibility,
        codePath: e.codePath,
        repositoryId: e.repositoryId,
        riskScore: threatModel?.riskScore,
        businessCriticality: this.determineBusinessCriticality(entity),
      },
    };
  }

  /** Returns all DataStore entities for the tenant, sorted by dataClassification desc */
  async getDataStores(tenantId: TenantId): Promise<DataStoreSummary[]> {
    const entities = await this.adapter.listEntities(tenantId, 'data_store', 1000);
    const classOrder: Record<string, number> = { restricted: 0, confidential: 1, internal: 2, public: 3 };
    const summaries: DataStoreSummary[] = entities.map(e => this.mapDataStoreToSummary(e as DataStore));
    summaries.sort((a, b) => (classOrder[a.dataClassification ?? 'public'] ?? 4) - (classOrder[b.dataClassification ?? 'public'] ?? 4));
    return summaries;
  }

  /** Returns full DataStore entity enriched with resolved service + feature names */
  async getDataStoreById(tenantId: TenantId, id: string): Promise<DataStoreDetail | null> {
    // Validate id to prevent injection — allow alphanumeric + hyphens/underscores/colons only
    if (!/^[a-zA-Z0-9_\-:.]+$/.test(id)) {
      console.warn('[AssetService] getDataStoreById: invalid id format rejected');
      return null;
    }
    const entity = await this.adapter.getEntity(tenantId, id);
    if (!entity || entity.entityType !== 'data_store') return null;
    return this.mapDataStoreToDetail(entity as DataStore);
  }

  /** Returns the relationship graph centred on the given DataStore */
  async getDataStoreRelationships(tenantId: TenantId, id: string): Promise<RelationshipGraph> {
    return this.getAssetRelationships(tenantId, id);
  }

  private mapDataStoreToSummary(ds: DataStore): DataStoreSummary {
    return {
      id: ds.id,
      name: ds.name,
      storeType: ds.storeType,
      technology: ds.technology,
      dataClassification: ds.dataClassification,
      encryptionAtRest: ds.encryptionAtRest,
      cloudResourceName: ds.cloudResourceName,
      serviceCount: (ds.serviceAccess ?? []).length,
      featureCount: (ds.featureIds ?? []).length,
      dataTypes: ds.dataTypes ?? [],
      responsibility: ds.responsibility,
      lastIndexedAt: ds.lastIndexedAt,
    };
  }

  private mapDataStoreToDetail(ds: DataStore): DataStoreDetail {
    return {
      ...this.mapDataStoreToSummary(ds),
      cloudResourceId: ds.cloudResourceId,
      encryptionInTransit: ds.encryptionInTransit,
      serviceAccess: ds.serviceAccess ?? [],
      featureIds: ds.featureIds ?? [],
      featureNames: ds.featureNames,
      metadata: ds.metadata ?? {},
    };
  }

  async deleteAllAssets(tenantId: TenantId): Promise<void> {
    await this.adapter.deleteTenant(tenantId);
    if (this.graphAdapter) {
      await this.graphAdapter.deleteTenant(tenantId);
    }
    if (this.indexingRunRepository) {
      await this.indexingRunRepository.deleteByTenant(tenantId);
    }
  }

  async getAssetCategories(tenantId: TenantId): Promise<AssetCategory[]> {
    // Define asset entity types and their display labels
    const assetTypes = [
      { type: 'code_repository', label: 'Repositories' },
      { type: 'code_service', label: 'Services' },
      { type: 'cloud_resource', label: 'Cloud Resources' },
      { type: 'azure_identity', label: 'Identities' },
      // data_store is excluded here — it has its own dedicated tab in the UI
      { type: 'api_endpoint', label: 'API Endpoints' },
      { type: 'network_segment', label: 'Network Segments' },
      { type: 'external_dependency', label: 'External Dependencies' },
    ];

    const categories: AssetCategory[] = [];

    // Get count for each entity type
    for (const assetType of assetTypes) {
      const entities = await this.adapter.listEntities(tenantId, assetType.type, 1);
      // If we get any results, include this category
      if (entities.length > 0) {
        // For now, we'll fetch all to get accurate count
        const allEntities = await this.adapter.listEntities(tenantId, assetType.type, 10000);
        categories.push({
          type: assetType.type,
          label: assetType.label,
          count: allEntities.length,
        });
      }
    }

    return categories;
  }

  private mapEntityToAsset(entity: CanonicalEntity): Asset {
    const isCodeService = entity.entityType === 'code_service';
    const isAzureIdentity = entity.entityType === 'azure_identity';
    const baseAsset = {
      id: entity.id,
      type: entity.entityType,
      name: this.extractName(entity),
      metadata: {
        ...entity.metadata,
        // Add responsibility to metadata for easy access in UI
        responsibility: (entity as any).responsibility,
        ...(isCodeService && {
          language: (entity as CodeService).language,
          techStack: (entity as CodeService).techStack,
          repositoryId: (entity as CodeService).repositoryId,
        }),
        ...(isAzureIdentity && {
          identityKind: (entity as any).identityKind,
          principalId: (entity as any).principalId,
          clientId: (entity as any).clientId,
          resourceId: (entity as any).resourceId,
          region: (entity as any).region,
        }),
      },
    };

    // Extract owner, criticality, and risk score from metadata or threat model
    const threatModel = (entity as any).threatModel;
    
    return {
      ...baseAsset,
      owner: entity.metadata?.owner || threatModel?.owner,
      businessCriticality: this.determineBusinessCriticality(entity),
      riskScore: threatModel?.riskScore,
    };
  }

  private extractName(entity: CanonicalEntity): string {
    // Try to get name from different entity types
    if ('name' in entity && entity.name) {
      return (entity as any).name;
    }
    if ('path' in entity && entity.path) {
      return (entity as any).path;
    }
    return entity.id;
  }

  private determineBusinessCriticality(entity: CanonicalEntity): 'critical' | 'high' | 'medium' | 'low' | undefined {
    const threatModel = (entity as any).threatModel;
    if (!threatModel) return undefined;

    // Determine criticality based on various factors
    if (threatModel.internetExposed || threatModel.dataClassification === 'restricted') {
      return 'critical';
    }
    if (threatModel.dataClassification === 'confidential' || (threatModel.riskScore && threatModel.riskScore > 70)) {
      return 'high';
    }
    if (threatModel.dataClassification === 'internal' || (threatModel.riskScore && threatModel.riskScore > 40)) {
      return 'medium';
    }
    return 'low';
  }

  private mapEntityToAssetDetail(entity: CanonicalEntity): AssetDetail {
    const baseAsset = this.mapEntityToAsset(entity);
    const responsibility = (entity as any).responsibility;
    const threatModel = (entity as any).threatModel;
    const serviceDfd = (entity as any).serviceDfd as ServiceDfd | undefined;
    const serviceThreatModel = (entity as any).serviceThreatModel as ServiceThreatModel | undefined;
    const link = this.generateEntityLink(entity);
    
    return {
      ...baseAsset,
      responsibility,
      threatModel,
      serviceDfd,
      serviceThreatModel,
      fullEntity: entity,
      link,
    };
  }

  private generateEntityLink(entity: CanonicalEntity): string | undefined {
    const e = entity as any;
    
    // For code repositories, use the URL directly
    if (entity.entityType === 'code_repository' && e.url) {
      return e.url;
    }
    
    // For cloud resources with resourceId, generate Azure portal link
    if (entity.entityType === 'cloud_resource' && e.resourceId) {
      return `https://portal.azure.com/#@/resource${e.resourceId}`;
    }

    // For Azure managed identities, link to Entra ID object page
    if (entity.entityType === 'azure_identity' && e.principalId) {
      return `https://portal.azure.com/#view/Microsoft_AAD_IAM/ObjectDetailsBlade/objectId/${e.principalId}`;
    }
    
    // For code entities with repository and code path, generate GitHub link
    if (e.repositoryId && e.codePath) {
      // We would need to look up the repository to get the URL
      // For now, we can check if it's in metadata
      return undefined; // Could be enhanced later
    }
    
    return undefined;
  }
}
