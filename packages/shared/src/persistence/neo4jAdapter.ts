/**
 * Neo4j Adapter
 * 
 * Stores and queries relationships between entities as a graph.
 * Implements multi-tenancy by storing all tenants in the same database,
 * isolated by tenant_id property on every node and relationship.
 */

import neo4j, { Driver, Session } from 'neo4j-driver';
import {
  Relationship,
  TenantId,
  EntityId,
  RelationshipType,
  CanonicalEntity,
} from '../types/canonical.types';
import { CloudGraph, AnyGraphNode, GraphRelationship } from '../types/cloud-graph.types';

export interface Neo4jConfig {
  uri: string;
  username: string;
  password: string;
  database?: string;
}

/**
 * Neo4j adapter - stores entities as nodes and relationships as graph edges
 */
export class Neo4jAdapter {
  private driver: Driver;
  private database: string;

  constructor(config: Neo4jConfig) {
    this.driver = neo4j.driver(
      config.uri,
      neo4j.auth.basic(config.username, config.password)
    );
    this.database = config.database || 'neo4j';
  }

  /**
   * Initialize indexes and constraints for multi-tenancy
   */
  async initialize(): Promise<void> {
    // First verify connectivity and ensure database exists
    await this.driver.verifyConnectivity();
    
    // Create database if it doesn't exist (Neo4j 5.x requires explicit database creation)
    if (this.database !== 'neo4j' && this.database !== 'system') {
      const systemSession = this.driver.session({ database: 'system' });
      try {
        // Check if database exists
        const result = await systemSession.run(
          'SHOW DATABASES YIELD name WHERE name = $dbName RETURN name',
          { dbName: this.database }
        );
        
        if (result.records.length === 0) {
          // Database doesn't exist, create it
          await systemSession.run(`CREATE DATABASE ${this.database} IF NOT EXISTS`);
          console.log(`Created Neo4j database: ${this.database}`);
        }
      } catch (error) {
        console.warn(`Could not create database ${this.database}:`, error);
        // Continue anyway - might not have permissions or database might exist
      } finally {
        await systemSession.close();
      }
    }

    const session = this.driver.session({ database: this.database });
    try {
      // Tenant node constraint
      await session.run(`
        CREATE CONSTRAINT tenant_unique IF NOT EXISTS
        FOR (t:Tenant)
        REQUIRE t.id IS UNIQUE
      `);

      // Entity type constraints - use single property uniqueness for Community Edition
      // Note: NODE KEY constraints require Enterprise Edition
      const entityTypes = [
        'CodeRepository', 'CodeService', 'CodeModule', 'BuildArtifact',
        'DeploymentArtifact', 'CloudResource', 'AzureIdentity', 'IamRoleAssignment',
        'Identity', 'Dependency', 'Commit'
      ];
      
      for (const entityType of entityTypes) {
        // Create index on tenant_id for filtering
        await session.run(`
          CREATE INDEX ${entityType.toLowerCase()}_tenant_idx IF NOT EXISTS
          FOR (n:${entityType})
          ON (n.tenant_id)
        `);
        
        // Create index on (tenant_id, id) for uniqueness queries
        await session.run(`
          CREATE INDEX ${entityType.toLowerCase()}_tenant_id_idx IF NOT EXISTS
          FOR (n:${entityType})
          ON (n.tenant_id, n.id)
        `);
      }

      // Note: Generic indexes without labels are not supported in Neo4j 5.x+
      // We rely on label-specific constraints above for uniqueness
      // and create label-specific indexes for common patterns

      // Additional indexes for common query patterns per entity type
      for (const entityType of entityTypes) {
        await session.run(`
          CREATE INDEX ${entityType.toLowerCase()}_type_lookup IF NOT EXISTS
          FOR (n:${entityType})
          ON (n.tenant_id, n.entityType)
        `);
      }

      // Extra index: look up AzureIdentity by principalId (for IAM graph traversal)
      await session.run(`
        CREATE INDEX azureidentity_principalid_idx IF NOT EXISTS
        FOR (n:AzureIdentity)
        ON (n.tenant_id, n.principalId)
      `);

      // Extra index: look up IamRoleAssignment by principalId
      await session.run(`
        CREATE INDEX iamroleassignment_principalid_idx IF NOT EXISTS
        FOR (n:IamRoleAssignment)
        ON (n.tenant_id, n.principalId)
      `);

      // Index to support incremental-indexing queries on CodeRepository
      await session.run(`
        CREATE INDEX coderepository_lastindexedcommit_idx IF NOT EXISTS
        FOR (n:CodeRepository)
        ON (n.tenant_id, n.lastIndexedCommit)
      `);
    } finally {
      await session.close();
    }
  }

  /**
   * Ensure tenant node exists
   */
  async ensureTenant(tenantId: TenantId, name?: string): Promise<void> {
    const session = this.driver.session({ database: this.database });
    try {
      await session.run(
        `
        MERGE (t:Tenant {id: $tenantId})
        ON CREATE SET t.name = $name, t.createdAt = datetime()
        `,
        { tenantId, name: name || tenantId }
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Store entity as a node
   */
  async storeEntity(entity: CanonicalEntity): Promise<void> {
    const session = this.driver.session({ database: this.database });
    try {
      // Ensure tenant exists
      await this.ensureTenant(entity.tenantId);

      // Determine node label based on entity type
      const label = this.getNodeLabel(entity.entityType);
      
      // Store entity node with tenant_id property
      await session.run(
        `
        MERGE (n:${label} {tenant_id: $tenant_id, id: $id})
        SET n += $properties
        WITH n
        MATCH (t:Tenant {id: $tenant_id})
        MERGE (t)-[:OWNS]->(n)
        `,
        {
          tenant_id: entity.tenantId,
          id: entity.id,
          properties: this.serializeEntityProperties(entity),
        }
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Store multiple entities in batch
   */
  async storeEntities(entities: CanonicalEntity[]): Promise<void> {
    if (entities.length === 0) return;

    const session = this.driver.session({ database: this.database });
    try {
      // Ensure tenant exists for all unique tenants
      const tenantIds = [...new Set(entities.map(e => e.tenantId))];
      for (const tenantId of tenantIds) {
        await this.ensureTenant(tenantId);
      }

      // Process in chunks to avoid large transactions
      const chunkSize = 100;
      for (let i = 0; i < entities.length; i += chunkSize) {
        const chunk = entities.slice(i, i + chunkSize);
        
        await session.executeWrite(async (tx) => {
          for (const entity of chunk) {
            const label = this.getNodeLabel(entity.entityType);
            await tx.run(
              `
              MERGE (n:${label} {tenant_id: $tenant_id, id: $id})
              SET n += $properties
              WITH n
              MATCH (t:Tenant {id: $tenant_id})
              MERGE (t)-[:OWNS]->(n)
              `,
              {
                tenant_id: entity.tenantId,
                id: entity.id,
                properties: this.serializeEntityProperties(entity),
              }
            );
          }
        });
      }
    } finally {
      await session.close();
    }
  }

  /**
   * Store a single relationship as a Neo4j relationship (edge)
   */
  async storeRelationship(relationship: Relationship): Promise<void> {
    const session = this.driver.session({ database: this.database });
    try {
      // Create relationship between nodes using proper Neo4j edges
      // APOC or dynamic relationship types would be ideal, but we'll use a workaround
      await session.run(
        `
        MATCH (source {tenant_id: $tenant_id, id: $sourceId})
        MATCH (target {tenant_id: $tenant_id, id: $targetId})
        WHERE source.tenant_id = $tenant_id AND target.tenant_id = $tenant_id
        MERGE (source)-[r:${this.sanitizeRelType(relationship.type)} {
          tenant_id: $tenant_id,
          id: $id
        }]->(target)
        SET r.validFrom = $validFrom,
            r.validTo = $validTo,
            r.confidence = $confidence,
            r.metadata = $metadata
        `,
        {
          tenant_id: relationship.tenantId,
          id: relationship.id,
          sourceId: relationship.sourceId,
          targetId: relationship.targetId,
          validFrom: relationship.validFrom,
          validTo: relationship.validTo || null,
          confidence: relationship.confidence,
          metadata: JSON.stringify(relationship.metadata),
        }
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Store multiple relationships in batch
   */
  async storeRelationships(relationships: Relationship[]): Promise<void> {
    if (relationships.length === 0) return;

    const session = this.driver.session({ database: this.database });
    try {
      // Process in chunks to avoid large transactions
      const chunkSize = 100;
      for (let i = 0; i < relationships.length; i += chunkSize) {
        const chunk = relationships.slice(i, i + chunkSize);
        
        await session.executeWrite(async (tx) => {
          for (const relationship of chunk) {
            await tx.run(
              `
              MATCH (source {tenant_id: $tenant_id, id: $sourceId})
              MATCH (target {tenant_id: $tenant_id, id: $targetId})
              WHERE source.tenant_id = $tenant_id AND target.tenant_id = $tenant_id
              MERGE (source)-[r:${this.sanitizeRelType(relationship.type)} {
                tenant_id: $tenant_id,
                id: $id
              }]->(target)
              SET r.validFrom = $validFrom,
                  r.validTo = $validTo,
                  r.confidence = $confidence,
                  r.metadata = $metadata
              `,
              {
                tenant_id: relationship.tenantId,
                id: relationship.id,
                sourceId: relationship.sourceId,
                targetId: relationship.targetId,
                validFrom: relationship.validFrom,
                validTo: relationship.validTo || null,
                confidence: relationship.confidence,
                metadata: JSON.stringify(relationship.metadata),
              }
            );
          }
        });
      }
    } finally {
      await session.close();
    }
  }

  /**
   * Store a CloudGraph (GraphNode nodes + GraphRelationship edges) produced by
   * CloudGraphBuilder.  Nodes are stored with their nodeType as the Neo4j label
   * so that Front Door, VNet, NSG, etc. appear as first-class graph citizens.
   *
   * Idempotent: MERGE on (tenant_id, id) so re-runs don't duplicate data.
   */
  async storeCloudGraph(graph: CloudGraph): Promise<void> {
    if (graph.nodes.length === 0) return;

    const session = this.driver.session({ database: this.database });
    try {
      // Ensure tenant node exists for every unique tenant in the graph
      const tenantIds = [...new Set(graph.nodes.map(n => n.tenantId))];
      for (const tenantId of tenantIds) {
        await this.ensureTenant(tenantId);
      }

      const chunkSize = 100;

      // ── Nodes ──────────────────────────────────────────────────────────────
      for (let i = 0; i < graph.nodes.length; i += chunkSize) {
        const chunk = graph.nodes.slice(i, i + chunkSize);
        await session.executeWrite(async tx => {
          for (const node of chunk) {
            const label = node.nodeType; // e.g. 'FrontDoorProfile', 'FrontDoorEndpoint', …
            const props: Record<string, any> = {
              tenant_id: node.tenantId,
              id: node.id,
              nodeType: node.nodeType,
              cloudProvider: node.cloudProvider,
              providerResourceId: node.providerResourceId,
              displayName: node.displayName,
              region: node.region,
              indexedAt: node.indexedAt,
              dataClassification: node.dataClassification,
              internetExposed: node.internetExposed,
              tags: JSON.stringify(node.tags),
              // Flatten all extra fields as JSON so nothing is lost
              properties: JSON.stringify(node),
            };
            await tx.run(
              `MERGE (n:${label} {tenant_id: $tenant_id, id: $id})
               SET n += $props
               WITH n
               MATCH (t:Tenant {id: $tenant_id})
               MERGE (t)-[:OWNS]->(n)`,
              { tenant_id: node.tenantId, id: node.id, props },
            );
          }
        });
      }

      // ── Relationships ──────────────────────────────────────────────────────
      for (let i = 0; i < graph.relationships.length; i += chunkSize) {
        const chunk = graph.relationships.slice(i, i + chunkSize);
        await session.executeWrite(async tx => {
          for (const rel of chunk) {
            const relType = this.sanitizeRelType(rel.type);
            await tx.run(
              `MATCH (source {tenant_id: $tenant_id, id: $sourceId})
               MATCH (target {tenant_id: $tenant_id, id: $targetId})
               MERGE (source)-[r:${relType} {tenant_id: $tenant_id, id: $id}]->(target)
               SET r.confidence = $confidence,
                   r.metadata   = $metadata`,
              {
                tenant_id: rel.tenantId,
                id: rel.id,
                sourceId: rel.sourceId,
                targetId: rel.targetId,
                confidence: rel.confidence,
                metadata: JSON.stringify(rel.metadata ?? {}),
              },
            );
          }
        });
      }
    } finally {
      await session.close();
    }
  }

  /**
   * Get relationships by source entity ID
   */
  async getRelationshipsBySource(
    tenantId: TenantId,
    sourceId: EntityId,
    type?: RelationshipType
  ): Promise<Relationship[]> {
    const session = this.driver.session({ database: this.database });
    try {
      const relTypeClause = type ? `[r:${this.sanitizeRelType(type)}]` : '[r]';
      const query = `
        MATCH (t:Tenant {id: $tenantId})-[:OWNS*]->(source {tenant_id: $tenantId, id: $sourceId})
        MATCH (source)-${relTypeClause}->(target)
        WHERE r.tenant_id = $tenantId
          AND (r.validTo IS NULL OR r.validTo > datetime())
        RETURN r, source.id AS sourceId, target.id AS targetId, type(r) AS relType
      `;

      const result = await session.run(query, { tenantId, sourceId });
      return result.records.map(record => this.recordToRelationship(
        record.get('r'),
        record.get('sourceId'),
        record.get('targetId'),
        record.get('relType')
      ));
    } finally {
      await session.close();
    }
  }

  /**
   * Get relationships by target entity ID
   */
  async getRelationshipsByTarget(
    tenantId: TenantId,
    targetId: EntityId,
    type?: RelationshipType
  ): Promise<Relationship[]> {
    const session = this.driver.session({ database: this.database });
    try {
      const relTypeClause = type ? `[r:${this.sanitizeRelType(type)}]` : '[r]';
      const query = `
        MATCH (t:Tenant {id: $tenantId})-[:OWNS*]->(target {tenant_id: $tenantId, id: $targetId})
        MATCH (source)-${relTypeClause}->(target)
        WHERE r.tenant_id = $tenantId
          AND (r.validTo IS NULL OR r.validTo > datetime())
        RETURN r, source.id AS sourceId, target.id AS targetId, type(r) AS relType
      `;

      const result = await session.run(query, { tenantId, targetId });
      return result.records.map(record => this.recordToRelationship(
        record.get('r'),
        record.get('sourceId'),
        record.get('targetId'),
        record.get('relType')
      ));
    } finally {
      await session.close();
    }
  }

  /**
   * Get all relationships for a tenant
   */
  async getRelationships(
    tenantId: TenantId,
    type?: RelationshipType,
    limit?: number
  ): Promise<Relationship[]> {
    const session = this.driver.session({ database: this.database });
    try {
      const relTypeClause = type ? `[r:${this.sanitizeRelType(type)}]` : '[r]';
      const limitClause = limit ? `LIMIT ${limit}` : '';
      const query = `
        MATCH (t:Tenant {id: $tenantId})-[:OWNS*]->(source)
        MATCH (source)-${relTypeClause}->(target)
        WHERE r.tenant_id = $tenantId
          AND (r.validTo IS NULL OR r.validTo > datetime())
        RETURN r, source.id AS sourceId, target.id AS targetId, type(r) AS relType
        ${limitClause}
      `;

      const result = await session.run(query, { tenantId });
      return result.records.map(record => this.recordToRelationship(
        record.get('r'),
        record.get('sourceId'),
        record.get('targetId'),
        record.get('relType')
      ));
    } finally {
      await session.close();
    }
  }

  /**
   * Get a specific relationship by ID
   */
  async getRelationship(tenantId: TenantId, relationshipId: EntityId): Promise<Relationship | null> {
    const session = this.driver.session({ database: this.database });
    try {
      const result = await session.run(
        `
        MATCH (source)-[r]->(target)
        WHERE r.id = $relationshipId AND r.tenant_id = $tenantId
        RETURN r, source.id AS sourceId, target.id AS targetId, type(r) AS relType
        `,
        { relationshipId, tenantId }
      );

      if (result.records.length === 0) return null;
      const record = result.records[0];
      return this.recordToRelationship(
        record.get('r'),
        record.get('sourceId'),
        record.get('targetId'),
        record.get('relType')
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Delete a relationship
   */
  async deleteRelationship(tenantId: TenantId, relationshipId: EntityId): Promise<void> {
    const session = this.driver.session({ database: this.database });
    try {
      await session.run(
        `
        MATCH ()-[r]->()
        WHERE r.id = $relationshipId AND r.tenant_id = $tenantId
        DELETE r
        `,
        { relationshipId, tenantId }
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Delete all relationships and entities for a tenant
   */
  async deleteTenant(tenantId: TenantId): Promise<void> {
    const session = this.driver.session({ database: this.database });
    try {
      // Delete all relationships with tenant_id
      await session.run(
        `
        MATCH ()-[r]->()
        WHERE r.tenant_id = $tenantId
        DELETE r
        `,
        { tenantId }
      );

      // Delete all nodes with tenant_id
      await session.run(
        `
        MATCH (n)
        WHERE n.tenant_id = $tenantId
        DETACH DELETE n
        `,
        { tenantId }
      );

      // Delete tenant node
      await session.run(
        `
        MATCH (t:Tenant {id: $tenantId})
        DELETE t
        `,
        { tenantId }
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    const session = this.driver.session({ database: this.database });
    try {
      await session.run('RETURN 1');
      return true;
    } catch (error) {
      console.error('Neo4j health check failed:', error);
      return false;
    } finally {
      await session.close();
    }
  }

  /**
   * Close the driver connection
   */
  async close(): Promise<void> {
    await this.driver.close();
  }

  /**
   * Get node label from entity type
   */
  private getNodeLabel(entityType: string): string {
    // Map entity types to Neo4j labels
    const labelMap: Record<string, string> = {
      'code_repository': 'CodeRepository',
      'code_service': 'CodeService',
      'code_module': 'CodeModule',
      'build_artifact': 'BuildArtifact',
      'deployment_artifact': 'DeploymentArtifact',
      'cloud_resource': 'CloudResource',
      'azure_identity': 'AzureIdentity',
      'iam_role_assignment': 'IamRoleAssignment',
      'identity': 'Identity',
      'dependency': 'Dependency',
      'commit': 'Commit',
      'code_artifact': 'CodeArtifact',
      'code_component': 'CodeComponent',
    };
    return labelMap[entityType] || 'Entity';
  }

  /**
   * Serialize entity properties for Neo4j storage
   * Neo4j only accepts primitives and arrays of primitives, so we need to serialize complex objects
   */
  private serializeEntityProperties(entity: CanonicalEntity): Record<string, any> {
    const properties: Record<string, any> = {
      tenant_id: entity.tenantId,
      id: entity.id,
      entityType: entity.entityType,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      confidence: entity.confidence,
    };

    // Pass through incremental-indexing tracking fields if present
    const baseEntity = entity as any;
    if (baseEntity.lastIndexedAt) properties.lastIndexedAt = baseEntity.lastIndexedAt;
    if (baseEntity.lastIndexedCommit) properties.lastIndexedCommit = baseEntity.lastIndexedCommit;

    // Serialize metadata as JSON string
    if (entity.metadata && Object.keys(entity.metadata).length > 0) {
      properties.metadata = JSON.stringify(entity.metadata);
    }

    // Add type-specific properties based on entity type
    switch (entity.entityType) {
      case 'code_repository': {
        const repo = entity as any;
        properties.name = repo.name;
        properties.url = repo.url;
        properties.defaultBranch = repo.defaultBranch;
        if (repo.lastCommitSha) properties.lastCommitSha = repo.lastCommitSha;
        if (repo.responsibility) properties.responsibility = repo.responsibility;
        break;
      }
      case 'code_service': {
        const service = entity as any;
        properties.serviceType = service.serviceType;
        properties.name = service.name;
        properties.codePath = service.codePath;
        properties.repositoryId = service.repositoryId;
        properties.language = service.language;
        if (service.techStack) properties.techStack = service.techStack;
        if (service.dependencies) properties.dependencies = service.dependencies;
        if (service.responsibility) properties.responsibility = service.responsibility;
        break;
      }
      case 'code_module': {
        const module = entity as any;
        properties.name = module.name;
        properties.codePath = module.codePath;
        properties.serviceId = module.serviceId;
        properties.language = module.language;
        if (module.dependencies) properties.dependencies = module.dependencies;
        if (module.responsibility) properties.responsibility = module.responsibility;
        properties.isEntryPoint = module.isEntryPoint;
        if (module.entryType) properties.entryType = module.entryType;
        break;
      }
      case 'build_artifact': {
        const build = entity as any;
        properties.buildType = build.buildType;
        properties.name = build.name;
        properties.codePath = build.codePath;
        properties.serviceIds = build.serviceIds;
        properties.technology = build.technology;
        if (build.responsibility) properties.responsibility = build.responsibility;
        break;
      }
      case 'deployment_artifact': {
        const deploy = entity as any;
        properties.deploymentType = deploy.deploymentType;
        properties.name = deploy.name;
        properties.codePath = deploy.codePath;
        properties.technology = deploy.technology;
        properties.serviceIds = deploy.serviceIds;
        if (deploy.responsibility) properties.responsibility = deploy.responsibility;
        break;
      }
      case 'cloud_resource': {
        const cloud = entity as any;
        properties.resourceType = cloud.resourceType;
        properties.cloudProvider = cloud.cloudProvider;
        properties.name = cloud.name;
        if (cloud.resourceId) properties.resourceId = cloud.resourceId;
        if (cloud.region) properties.region = cloud.region;
        if (cloud.responsibility) properties.responsibility = cloud.responsibility;
        break;
      }
      case 'azure_identity': {
        const identity = entity as any;
        properties.identityKind = identity.identityKind;
        properties.name = identity.name;
        properties.cloudProvider = identity.cloudProvider;
        if (identity.principalId) properties.principalId = identity.principalId;
        if (identity.clientId) properties.clientId = identity.clientId;
        if (identity.resourceId) properties.resourceId = identity.resourceId;
        if (identity.region) properties.region = identity.region;
        break;
      }
      case 'iam_role_assignment': {
        const ra = entity as any;
        properties.roleAssignmentId = ra.roleAssignmentId;
        properties.roleName = ra.roleName;
        properties.scope = ra.scope;
        properties.principalId = ra.principalId;
        if (ra.roleDefinitionId) properties.roleDefinitionId = ra.roleDefinitionId;
        if (ra.principalType) properties.principalType = ra.principalType;
        break;
      }
      case 'dependency': {
        const dep = entity as any;
        properties.name = dep.name;
        properties.version = dep.version;
        if (dep.versionConstraint) properties.versionConstraint = dep.versionConstraint;
        properties.packageManager = dep.packageManager;
        properties.isDev = dep.isDev;
        properties.isTransitive = dep.isTransitive;
        break;
      }
      case 'commit': {
        const commit = entity as any;
        properties.sha = commit.sha;
        properties.repository = commit.repository;
        properties.branch = commit.branch;
        properties.author = commit.author;
        properties.authorEmail = commit.authorEmail;
        properties.message = commit.message;
        properties.timestamp = commit.timestamp;
        properties.filesChanged = commit.filesChanged;
        properties.linesAdded = commit.linesAdded;
        properties.linesDeleted = commit.linesDeleted;
        break;
      }
      case 'code_artifact': {
        const artifact = entity as any;
        properties.artifactType = artifact.artifactType;
        properties.name = artifact.name;
        properties.path = artifact.path;
        properties.repository = artifact.repository;
        properties.branch = artifact.branch;
        if (artifact.commitSha) properties.commitSha = artifact.commitSha;
        if (artifact.language) properties.language = artifact.language;
        if (artifact.contentHash) properties.contentHash = artifact.contentHash;
        break;
      }
      case 'code_component': {
        const component = entity as any;
        properties.componentType = component.componentType;
        properties.name = component.name;
        if (component.version) properties.version = component.version;
        properties.language = component.language;
        if (component.framework) properties.framework = component.framework;
        properties.entryPoints = component.entryPoints;
        properties.repositoryId = component.repositoryId;
        break;
      }
      default:
        // For unknown entity types, try to copy all primitive properties
        for (const [key, value] of Object.entries(entity)) {
          if (key === 'metadata') continue; // Already handled
          if (value !== null && value !== undefined) {
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
              properties[key] = value;
            } else if (Array.isArray(value) && value.every(v => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
              properties[key] = value;
            } else if (typeof value === 'object') {
              properties[key] = JSON.stringify(value);
            }
          }
        }
    }

    return properties;
  }

  /**
   * Sanitize relationship type for Cypher (Neo4j requires uppercase, no hyphens)
   */
  private sanitizeRelType(type: string): string {
    return type.toUpperCase().replace(/-/g, '_');
  }

  /**
   * Convert Neo4j relationship record to Relationship
   */
  private recordToRelationship(
    record: any,
    sourceId: string,
    targetId: string,
    relType: string
  ): Relationship {
    const props = record.properties;
    return {
      id: props.id,
      tenantId: props.tenant_id,
      type: relType as RelationshipType,
      sourceId,
      targetId,
      validFrom: props.validFrom,
      validTo: props.validTo || undefined,
      confidence: props.confidence,
      metadata: typeof props.metadata === 'string' ? JSON.parse(props.metadata) : props.metadata,
    };
  }

  /**
   * Get a node by ID directly from Neo4j.
   *
   * Used as a Qdrant fallback in the BFS: cloud graph nodes (FrontDoorProfile,
   * FrontDoorEndpoint, etc.) are stored in Neo4j with a `properties` JSON column
   * that carries the full AnyGraphNode payload.  When Qdrant doesn't have a node
   * (e.g. before the next re-index run), this method reconstructs a
   * CloudResource-compatible CanonicalEntity from that blob so the BFS can
   * continue traversing.
   *
   * Returns null if the node doesn't exist or has no parseable properties blob.
   */
  async getNodeById(tenantId: TenantId, nodeId: EntityId): Promise<CanonicalEntity | null> {
    const session = this.driver.session({ database: this.database });
    try {
      const result = await session.run(
        `MATCH (n {id: $nodeId})
         WHERE n.tenant_id = $tenantId OR n.tenantId = $tenantId
         RETURN n.id AS id, n.nodeType AS nodeType, n.displayName AS displayName,
                n.region AS region, n.properties AS propertiesJson,
                n.providerResourceId AS providerResourceId,
                n.cloudProvider AS cloudProvider,
                n.dataClassification AS dataClassification
         LIMIT 1`,
        { nodeId, tenantId },
      );
      if (result.records.length === 0) return null;

      const rec = result.records[0];
      const propertiesJson: string | null = rec.get('propertiesJson');

      // Prefer the full properties blob stored by storeCloudGraph
      if (propertiesJson) {
        try {
          const raw = JSON.parse(propertiesJson);
          const now = raw.indexedAt ?? new Date().toISOString();
          return {
            id: raw.id ?? rec.get('id'),
            tenantId,
            entityType: 'cloud_resource',
            resourceType: 'network',
            cloudProvider: raw.cloudProvider === 'synthetic' ? 'azure' : (raw.cloudProvider ?? 'azure'),
            name: raw.displayName ?? rec.get('displayName') ?? raw.id,
            resourceId: raw.providerResourceId,
            region: raw.region,
            createdAt: now,
            updatedAt: now,
            lastIndexedAt: now,
            confidence: 'deterministic',
            metadata: {
              nodeType: raw.nodeType,
              dataClassification: raw.dataClassification,
              internetExposed: raw.internetExposed,
              tags: raw.tags ?? {},
              // Include all node-type-specific fields (sku, patterns, etc.)
              ...Object.fromEntries(
                Object.entries(raw).filter(([k]) =>
                  !['id','tenantId','cloudProvider','nodeType','providerResourceId',
                    'displayName','region','indexedAt','dataClassification',
                    'internetExposed','tags'].includes(k)
                )
              ),
            },
          } as CanonicalEntity;
        } catch {
          // fall through to minimal reconstruction below
        }
      }

      // Minimal reconstruction without properties blob
      const nodeType: string = rec.get('nodeType') ?? 'unknown';
      const now = new Date().toISOString();
      return {
        id: rec.get('id'),
        tenantId,
        entityType: 'cloud_resource',
        resourceType: 'network',
        cloudProvider: (rec.get('cloudProvider') as any) ?? 'azure',
        name: rec.get('displayName') ?? rec.get('id'),
        resourceId: rec.get('providerResourceId'),
        region: rec.get('region'),
        createdAt: now,
        updatedAt: now,
        lastIndexedAt: now,
        confidence: 'deterministic',
        metadata: { nodeType },
      } as CanonicalEntity;
    } finally {
      await session.close();
    }
  }
}
