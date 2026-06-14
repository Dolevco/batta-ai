import { Pool } from 'pg';
import {
  Relationship,
  TenantId,
  EntityId,
  RelationshipType,
  CanonicalEntity,
} from '../types/canonical.types';
import { CloudGraph } from '../types/cloud-graph.types';

export interface PostgresGraphConfig {
  connectionString?: string;
}

export class PostgresGraphAdapter {
  constructor(private readonly pool: Pool) {}

  async initialize(): Promise<void> {
    // Schema is initialised by PostgresDataAdapter.initialize() via schema.sql
    // which creates graph_nodes, graph_edges, cloud_nodes, cloud_edges.
    // Calling SELECT 1 to verify connectivity.
    await this.pool.query('SELECT 1');
  }

  async ensureTenant(_tenantId: TenantId): Promise<void> {
    // No separate tenant table needed — multi-tenancy is enforced via tenant_id columns.
  }

  async storeEntity(entity: CanonicalEntity): Promise<void> {
    await this.pool.query(
      `INSERT INTO graph_nodes (id, tenant_id, entity_type, payload, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (tenant_id, id) DO UPDATE
         SET entity_type = EXCLUDED.entity_type,
             payload     = EXCLUDED.payload,
             updated_at  = now()`,
      [entity.id, entity.tenantId, entity.entityType, JSON.stringify(entity)]
    );
  }

  async storeEntities(entities: CanonicalEntity[]): Promise<void> {
    if (entities.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const entity of entities) {
        await client.query(
          `INSERT INTO graph_nodes (id, tenant_id, entity_type, payload, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (tenant_id, id) DO UPDATE
             SET entity_type = EXCLUDED.entity_type,
                 payload     = EXCLUDED.payload,
                 updated_at  = now()`,
          [entity.id, entity.tenantId, entity.entityType, JSON.stringify(entity)]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async storeRelationship(relationship: Relationship): Promise<void> {
    await this.pool.query(
      `INSERT INTO graph_edges
         (id, tenant_id, source_id, target_id, rel_type, valid_from, valid_to, confidence, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (tenant_id, id) DO UPDATE
         SET source_id  = EXCLUDED.source_id,
             target_id  = EXCLUDED.target_id,
             rel_type   = EXCLUDED.rel_type,
             valid_from = EXCLUDED.valid_from,
             valid_to   = EXCLUDED.valid_to,
             confidence = EXCLUDED.confidence,
             metadata   = EXCLUDED.metadata`,
      [
        relationship.id,
        relationship.tenantId,
        relationship.sourceId,
        relationship.targetId,
        relationship.type,
        relationship.validFrom ?? new Date().toISOString(),
        relationship.validTo ?? null,
        relationship.confidence ?? null,
        JSON.stringify(relationship.metadata ?? {}),
      ]
    );
  }

  async storeRelationships(relationships: Relationship[]): Promise<void> {
    if (relationships.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const rel of relationships) {
        await client.query(
          `INSERT INTO graph_edges
             (id, tenant_id, source_id, target_id, rel_type, valid_from, valid_to, confidence, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (tenant_id, id) DO UPDATE
             SET source_id  = EXCLUDED.source_id,
                 target_id  = EXCLUDED.target_id,
                 rel_type   = EXCLUDED.rel_type,
                 valid_from = EXCLUDED.valid_from,
                 valid_to   = EXCLUDED.valid_to,
                 confidence = EXCLUDED.confidence,
                 metadata   = EXCLUDED.metadata`,
          [
            rel.id,
            rel.tenantId,
            rel.sourceId,
            rel.targetId,
            rel.type,
            rel.validFrom ?? new Date().toISOString(),
            rel.validTo ?? null,
            rel.confidence ?? null,
            JSON.stringify(rel.metadata ?? {}),
          ]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async storeCloudGraph(graph: CloudGraph): Promise<void> {
    if (graph.nodes.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const node of graph.nodes) {
        await client.query(
          `INSERT INTO cloud_nodes
             (id, tenant_id, node_type, cloud_provider, provider_resource_id,
              display_name, region, internet_exposed, data_classification, tags, properties, indexed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (tenant_id, id) DO UPDATE
             SET node_type            = EXCLUDED.node_type,
                 cloud_provider       = EXCLUDED.cloud_provider,
                 provider_resource_id = EXCLUDED.provider_resource_id,
                 display_name         = EXCLUDED.display_name,
                 region               = EXCLUDED.region,
                 internet_exposed     = EXCLUDED.internet_exposed,
                 data_classification  = EXCLUDED.data_classification,
                 tags                 = EXCLUDED.tags,
                 properties           = EXCLUDED.properties,
                 indexed_at           = EXCLUDED.indexed_at`,
          [
            node.id,
            node.tenantId,
            node.nodeType,
            node.cloudProvider ?? null,
            node.providerResourceId ?? null,
            node.displayName ?? null,
            node.region ?? null,
            node.internetExposed ?? null,
            node.dataClassification ?? null,
            JSON.stringify(node.tags ?? {}),
            JSON.stringify(node),
            node.indexedAt ?? null,
          ]
        );
      }

      for (const rel of graph.relationships) {
        await client.query(
          `INSERT INTO cloud_edges (id, tenant_id, source_id, target_id, rel_type, metadata)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (tenant_id, id) DO UPDATE
             SET source_id = EXCLUDED.source_id,
                 target_id = EXCLUDED.target_id,
                 rel_type  = EXCLUDED.rel_type,
                 metadata  = EXCLUDED.metadata`,
          [
            rel.id,
            rel.tenantId,
            rel.sourceId,
            rel.targetId,
            rel.type,
            JSON.stringify(rel.metadata ?? {}),
          ]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getSubgraph(
    tenantId: TenantId,
    startId: EntityId,
    depth: number = 1,
    excludeNodeTypes: string[] = []
  ): Promise<{
    relationships: Array<{
      sourceId: string;
      targetId: string;
      type: string;
      properties: Record<string, any>;
    }>;
    nodeIds: string[];
  }> {
    // Recursive CTE for BFS up to `depth` hops.
    // Unions graph_edges (canonical entities) and cloud_edges (cloud topology, e.g. AFD chain)
    // so the full Internet → FrontDoor* → compute path is visible in the asset graph.
    const sql = `
      WITH RECURSIVE all_edges AS (
        SELECT source_id, target_id, rel_type, metadata
        FROM graph_edges
        WHERE tenant_id = $1
          AND (valid_to IS NULL OR valid_to > now())
        UNION ALL
        SELECT source_id, target_id, rel_type, metadata
        FROM cloud_edges
        WHERE tenant_id = $1
      ),
      subgraph AS (
        SELECT source_id, target_id, rel_type, metadata, 1 AS depth
        FROM all_edges
        WHERE source_id = $2 OR target_id = $2
        UNION ALL
        SELECT e.source_id, e.target_id, e.rel_type, e.metadata, s.depth + 1
        FROM all_edges e
        JOIN subgraph s
          ON (e.source_id = s.target_id OR e.target_id = s.source_id)
        WHERE s.depth < $3
      )
      SELECT DISTINCT source_id, target_id, rel_type, metadata FROM subgraph
    `;

    const res = await this.pool.query(sql, [tenantId, startId, Math.min(depth, 10)]);

    const relationships: Array<{ sourceId: string; targetId: string; type: string; properties: Record<string, any> }> = [];
    const nodeIdSet = new Set<string>();

    for (const row of res.rows) {
      const sourceId: string = row.source_id;
      const targetId: string = row.target_id;

      // Filter out excluded node types by checking graph_nodes
      if (excludeNodeTypes.length > 0) {
        const check = await this.pool.query(
          `SELECT entity_type FROM graph_nodes
           WHERE tenant_id = $1 AND (id = $2 OR id = $3)`,
          [tenantId, sourceId, targetId]
        );
        const types = new Set(check.rows.map((r: any) => r.entity_type));
        if ([...types].some(t => excludeNodeTypes.includes(t))) continue;
      }

      relationships.push({
        sourceId,
        targetId,
        type: row.rel_type,
        properties: row.metadata ?? {},
      });
      nodeIdSet.add(sourceId);
      nodeIdSet.add(targetId);
    }

    return { relationships, nodeIds: Array.from(nodeIdSet) };
  }

  async getRelationshipsBySource(
    tenantId: TenantId,
    sourceId: EntityId,
    type?: RelationshipType
  ): Promise<Relationship[]> {
    const params: any[] = [tenantId, sourceId];
    let sql = `SELECT * FROM graph_edges
               WHERE tenant_id = $1 AND source_id = $2
                 AND (valid_to IS NULL OR valid_to > now())`;
    if (type) {
      sql += ' AND rel_type = $3';
      params.push(type);
    }
    const res = await this.pool.query(sql, params);
    return res.rows.map(r => this.rowToRelationship(r));
  }

  async getRelationshipsByTarget(
    tenantId: TenantId,
    targetId: EntityId,
    type?: RelationshipType
  ): Promise<Relationship[]> {
    const params: any[] = [tenantId, targetId];
    let sql = `SELECT * FROM graph_edges
               WHERE tenant_id = $1 AND target_id = $2
                 AND (valid_to IS NULL OR valid_to > now())`;
    if (type) {
      sql += ' AND rel_type = $3';
      params.push(type);
    }
    const res = await this.pool.query(sql, params);
    return res.rows.map(r => this.rowToRelationship(r));
  }

  async getRelationships(
    tenantId: TenantId,
    type?: RelationshipType,
    limit?: number
  ): Promise<Relationship[]> {
    const params: any[] = [tenantId];
    let sql = `SELECT * FROM graph_edges
               WHERE tenant_id = $1
                 AND (valid_to IS NULL OR valid_to > now())`;
    if (type) {
      sql += ' AND rel_type = $2';
      params.push(type);
    }
    if (limit) {
      sql += ` LIMIT $${params.length + 1}`;
      params.push(limit);
    }
    const res = await this.pool.query(sql, params);
    return res.rows.map(r => this.rowToRelationship(r));
  }

  async getRelationship(tenantId: TenantId, relationshipId: EntityId): Promise<Relationship | null> {
    const res = await this.pool.query(
      'SELECT * FROM graph_edges WHERE tenant_id = $1 AND id = $2',
      [tenantId, relationshipId]
    );
    if (res.rows.length === 0) return null;
    return this.rowToRelationship(res.rows[0]);
  }

  async deleteRelationship(tenantId: TenantId, relationshipId: EntityId): Promise<void> {
    await this.pool.query(
      'DELETE FROM graph_edges WHERE tenant_id = $1 AND id = $2',
      [tenantId, relationshipId]
    );
  }

  async deleteTenant(tenantId: TenantId): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM graph_edges WHERE tenant_id = $1', [tenantId]);
      await client.query('DELETE FROM graph_nodes WHERE tenant_id = $1', [tenantId]);
      await client.query('DELETE FROM cloud_edges WHERE tenant_id = $1', [tenantId]);
      await client.query('DELETE FROM cloud_nodes WHERE tenant_id = $1', [tenantId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteEntitiesByType(tenantId: TenantId, entityType: string): Promise<number> {
    const res = await this.pool.query(
      'DELETE FROM graph_nodes WHERE tenant_id = $1 AND entity_type = $2',
      [tenantId, entityType]
    );
    return res.rowCount ?? 0;
  }

  async getNodeById(tenantId: TenantId, nodeId: EntityId): Promise<CanonicalEntity | null> {
    // Check graph_nodes first
    const res = await this.pool.query(
      'SELECT payload FROM graph_nodes WHERE tenant_id = $1 AND id = $2',
      [tenantId, nodeId]
    );
    if (res.rows.length > 0) {
      return res.rows[0].payload as CanonicalEntity;
    }

    // Fall back to cloud_nodes — reconstruct as CloudResource-compatible entity
    const cloudRes = await this.pool.query(
      `SELECT id, node_type, cloud_provider, provider_resource_id,
              display_name, region, data_classification, internet_exposed, tags, properties, indexed_at
       FROM cloud_nodes WHERE tenant_id = $1 AND id = $2`,
      [tenantId, nodeId]
    );
    if (cloudRes.rows.length === 0) return null;

    const row = cloudRes.rows[0];
    const properties = row.properties ?? {};
    const now = row.indexed_at ?? new Date().toISOString();

    return {
      id: row.id,
      tenantId,
      entityType: 'cloud_resource',
      resourceType: 'network',
      cloudProvider: row.cloud_provider === 'synthetic' ? 'azure' : (row.cloud_provider ?? 'azure'),
      name: row.display_name ?? row.id,
      resourceId: row.provider_resource_id,
      region: row.region,
      createdAt: now,
      updatedAt: now,
      lastIndexedAt: now,
      confidence: 'deterministic',
      metadata: {
        nodeType: row.node_type,
        dataClassification: row.data_classification,
        internetExposed: row.internet_exposed,
        tags: row.tags ?? {},
        ...Object.fromEntries(
          Object.entries(properties).filter(([k]) =>
            !['id', 'tenantId', 'cloudProvider', 'nodeType', 'providerResourceId',
              'displayName', 'region', 'indexedAt', 'dataClassification',
              'internetExposed', 'tags'].includes(k)
          )
        ),
      },
    } as CanonicalEntity;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  private rowToRelationship(row: any): Relationship {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      type: row.rel_type as RelationshipType,
      sourceId: row.source_id,
      targetId: row.target_id,
      validFrom: row.valid_from,
      validTo: row.valid_to ?? undefined,
      confidence: row.confidence,
      metadata: row.metadata ?? {},
    };
  }
}
