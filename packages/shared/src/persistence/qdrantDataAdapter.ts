/**
 * Qdrant Adapter
 * 
 * Stores entities and evidence as documents (with dummy vectors) and semantic documents 
 * with real embeddings for vector search.
 * Acts as both a document store (entities/evidence) and vector store (semantic documents).
 * 
 * Tenant Isolation:
 * - All operations require tenantId parameter
 * - All queries filter by tenantId in payload
 * - Uses scroll with tenant filter instead of direct retrieve
 * - Delete operations verify tenant ownership before deletion
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import {
  CanonicalEntity,
  Evidence,
  TenantId,
  SemanticDocument,
  SemanticDocumentType,
  CodeModule,
} from '../types/canonical.types';
import * as crypto from 'crypto';
import { IEmbeddingHandler } from '@ai-agent/core';
import { createQdrantConfig } from './qdrantUtils';

export interface QdrantConfig {
  url: string;
  apiKey?: string;
  collectionPrefix?: string;
}

export interface SearchQuery {
  tenantId: TenantId;
  query: string;
  name?: string;
  entityTypes?: string[];
  limit?: number;
  filters?: Record<string, any>;
}

export interface SearchResult {
  entity: CanonicalEntity;
  score: number;
}

/**
 * Qdrant adapter - stores entities and evidence as documents with embeddings
 */
export class QdrantAdapter {
  private client: QdrantClient;
  private embeddingService: IEmbeddingHandler;
  private entitiesCollection: string;
  private evidenceCollection: string;
  private semanticDocsCollection: string;
  private dimension: number;
  private readonly maxRetries = 3;
  private readonly baseRetryDelayMs = 1000;

  constructor(config: QdrantConfig, embeddingService: IEmbeddingHandler) {
    this.client = new QdrantClient(createQdrantConfig(config.url, config.apiKey));
    this.embeddingService = embeddingService;
    this.entitiesCollection = 'code_indexer_entities';
    this.evidenceCollection = 'code_indexer_evidence';
    this.semanticDocsCollection = 'code_indexer_semantic_docs';
    this.dimension = embeddingService.getDimension();
  }

  /**
   * Retry wrapper for Qdrant operations to handle socket errors
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string = 'operation'
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;
        
        if (attempt < this.maxRetries - 1) {
          const delay = this.baseRetryDelayMs * Math.pow(2, attempt);
          console.warn(
            `[Qdrant] ${operationName} failed (attempt ${attempt + 1}/${this.maxRetries}), retrying in ${delay}ms...`,
            error.message
          );
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    console.error(`[Qdrant] ${operationName} failed after ${this.maxRetries} attempts`);
    throw lastError;
  }

  /**
   * Initialize collections
   */
  async initialize(): Promise<void> {
    // Entities and evidence use dummy vectors (size 1) - just for document storage
    await this.createCollectionIfNotExists(this.entitiesCollection, 1);
    await this.createCollectionIfNotExists(this.evidenceCollection, 1);
    // Semantic docs use real embeddings for vector search
    await this.createCollectionIfNotExists(this.semanticDocsCollection, this.dimension);
    await this.createPayloadIndexes();
  }

  private async createCollectionIfNotExists(collectionName: string, vectorSize: number): Promise<void> {
    try {
      const collections = await this.withRetry(
        () => this.client.getCollections(),
        `get collections`
      );
      const exists = collections.collections.some((c: any) => c.name === collectionName);

      if (!exists) {
        await this.withRetry(
          () => this.client.createCollection(collectionName, {
            vectors: {
              size: vectorSize,
              distance: 'Cosine',
            },
            optimizers_config: {
              indexing_threshold: vectorSize === 1 ? 0 : 10000,
            },
          }),
          `create collection ${collectionName}`
        );
      }
    } catch (error) {
      throw new Error(`Failed to initialize Qdrant collection ${collectionName}: ${error}`);
    }
  }

  private async createPayloadIndexes(): Promise<void> {
    const indexes = [
      { collection: this.entitiesCollection, field: 'tenantId', type: 'keyword' as const },
      { collection: this.entitiesCollection, field: 'entityType', type: 'keyword' as const },
      { collection: this.evidenceCollection, field: 'tenantId', type: 'keyword' as const },
      { collection: this.evidenceCollection, field: 'relationship', type: 'keyword' as const },
      { collection: this.semanticDocsCollection, field: 'tenantId', type: 'keyword' as const },
      { collection: this.semanticDocsCollection, field: 'artifactId', type: 'keyword' as const },
      { collection: this.semanticDocsCollection, field: 'documentType', type: 'keyword' as const },
    ];

    for (const index of indexes) {
      try {
        await this.withRetry(
          () => this.client.createPayloadIndex(index.collection, {
            field_name: index.field,
            field_schema: index.type,
          }),
          `create index for ${index.field}`
        );
      } catch (error) {
        // Index might already exist, continue
        console.warn(`Could not create index for ${index.field}:`, error);
      }
    }
  }

  /**
   * Convert any string ID to a valid Qdrant point ID (UUID v5 based on the string)
   * Qdrant requires point IDs to be either unsigned integers or UUIDs.
   * We use UUID v5 to generate deterministic UUIDs from string IDs.
   */
  private toQdrantId(id: string): string {
    // If it's already a valid UUID, return it
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(id)) {
      return id;
    }

    // Generate deterministic UUID v5 from the string ID
    // Using DNS namespace UUID for our application
    const namespace = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    
    // Convert namespace UUID to bytes
    const namespaceBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
    
    // Create SHA-1 hash of namespace + ID
    const hash = crypto.createHash('sha1')
      .update(namespaceBytes)
      .update(id)
      .digest();
    
    // Format as UUID v5 (RFC 4122)
    // Set version (5) in the high nibble of byte 6
    hash[6] = (hash[6] & 0x0f) | 0x50;
    // Set variant (RFC 4122) in the high 2 bits of byte 8
    hash[8] = (hash[8] & 0x3f) | 0x80;
    
    // Format as UUID string
    const uuid = [
      hash.slice(0, 4).toString('hex'),
      hash.slice(4, 6).toString('hex'),
      hash.slice(6, 8).toString('hex'),
      hash.slice(8, 10).toString('hex'),
      hash.slice(10, 16).toString('hex')
    ].join('-');
    
    return uuid;
  }

  /**
   * Store an entity
   */
  async storeEntity(entity: CanonicalEntity): Promise<void> {
    // Use dummy vector for document storage (not for semantic search)
    await this.withRetry(
      () => this.client.upsert(this.entitiesCollection, {
        wait: true,
        points: [
          {
            id: this.toQdrantId(entity.id),
            vector: [0],
            payload: entity as any,
          },
        ],
      }),
      `store entity ${entity.id}`
    );
  }

  /**
   * Store multiple entities
   * Merges with existing entities to preserve enriched fields
   */
  async storeEntities(entities: CanonicalEntity[]): Promise<void> {
    if (entities.length === 0) return;

    console.log(`[Qdrant] Storing ${entities.length} entities...`);

    // Fetch existing entities to merge with
    const existingEntitiesMap = new Map<string, CanonicalEntity>();
    const qdrantIds = entities.map(e => this.toQdrantId(e.id));
    
    try {
      const existingPoints = await this.withRetry(
        () => this.client.retrieve(this.entitiesCollection, {
          ids: qdrantIds,
          with_payload: true,
        }),
        'retrieve existing entities'
      );
      
      for (const point of existingPoints) {
        const entity = point.payload as unknown as CanonicalEntity;
        existingEntitiesMap.set(entity.id, entity);
      }
    } catch (error) {
      console.warn(`[Qdrant] Could not fetch existing entities for merge:`, error);
    }

    // Merge new entities with existing ones (new fields override, missing fields are preserved)
    const mergedEntities = entities.map(entity => {
      const existing = existingEntitiesMap.get(entity.id);
      if (existing) {
        return { ...existing, ...entity };
      }
      return entity;
    });

    // Convert entity IDs to UUIDs for Qdrant compatibility (stores original ID in payload)
    const points = mergedEntities.map(entity => ({
      id: this.toQdrantId(entity.id),
      vector: [0],
      payload: entity as any,
    }));

    // Batch upsert in smaller chunks (retry is handled by withRetry)
    const chunkSize = 10;
    
    for (let i = 0; i < points.length; i += chunkSize) {
      const chunk = points.slice(i, i + chunkSize);
      
      await this.withRetry(
        () => this.client.upsert(this.entitiesCollection, {
          wait: true,
          points: chunk,
        }),
        `store entities chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(points.length / chunkSize)}`
      );
      
      console.log(`[Qdrant] Stored chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(points.length / chunkSize)} (${chunk.length} entities)`);
      
      // Add small delay between chunks to prevent overwhelming the connection
      if (i + chunkSize < points.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log(`[Qdrant] Successfully stored all ${entities.length} entities`);
  }

  /**
   * Store evidence
   */
  async storeEvidence(evidence: Evidence): Promise<void> {
    // Use dummy vector for document storage (not for semantic search)
    await this.withRetry(
      () => this.client.upsert(this.evidenceCollection, {
        wait: true,
        points: [
          {
            id: this.toQdrantId(evidence.id),
            vector: [0],
            payload: evidence as any,
          },
        ],
      }),
      `store evidence ${evidence.id}`
    );
  }

  /**
   * Store multiple evidence records
   */
  async storeEvidenceRecords(evidenceRecords: Evidence[]): Promise<void> {
    if (evidenceRecords.length === 0) return;

    console.log(`[Qdrant] Storing ${evidenceRecords.length} evidence records...`);

    // All evidence use dummy vector [0] for document storage
    const points = evidenceRecords.map(evidence => ({
      id: this.toQdrantId(evidence.id),
      vector: [0],
      payload: evidence as any,
    }));

    // Batch upsert in smaller chunks (retry is handled by withRetry)
    const chunkSize = 10;
    
    for (let i = 0; i < points.length; i += chunkSize) {
      const chunk = points.slice(i, i + chunkSize);
      
      await this.withRetry(
        () => this.client.upsert(this.evidenceCollection, {
          wait: true,
          points: chunk,
        }),
        `store evidence chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(points.length / chunkSize)}`
      );
      
      console.log(`[Qdrant] Stored evidence chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(points.length / chunkSize)}`);
      
      // Add small delay between chunks
      if (i + chunkSize < points.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log(`[Qdrant] Successfully stored all ${evidenceRecords.length} evidence records`);
  }

  /**
   * Store semantic document
   */
  async storeSemanticDocument(doc: SemanticDocument): Promise<void> {
    const textForEmbedding = this.extractTextFromSemanticDocument(doc);
    const embeddingResponse = await this.embeddingService.createEmbedding(textForEmbedding);

    await this.withRetry(
      () => this.client.upsert(this.semanticDocsCollection, {
        wait: true,
        points: [
          {
            id: this.toQdrantId(doc.id),
            vector: embeddingResponse.embedding,
            payload: doc as any,
          },
        ],
      }),
      `store semantic document ${doc.id}`
    );
  }

  /**
   * Store multiple semantic documents
   */
  async storeSemanticDocuments(docs: SemanticDocument[]): Promise<void> {
    if (docs.length === 0) return;

    console.log(`[Qdrant] Storing ${docs.length} semantic documents with embeddings...`);

    const texts = docs.map(doc => this.extractTextFromSemanticDocument(doc));
    const embeddings = await this.embeddingService.embedBatch(texts);

    const points = docs.map((doc, index) => ({
      id: this.toQdrantId(doc.id),
      vector: embeddings[index],
      payload: doc as any,
    }));

    // Batch upsert in smaller chunks (retry is handled by withRetry)
    const chunkSize = 10;
    
    for (let i = 0; i < points.length; i += chunkSize) {
      const chunk = points.slice(i, i + chunkSize);
      
      await this.withRetry(
        () => this.client.upsert(this.semanticDocsCollection, {
          wait: true,
          points: chunk,
        }),
        `store semantic docs chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(points.length / chunkSize)}`
      );
      
      console.log(`[Qdrant] Stored semantic docs chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(points.length / chunkSize)}`);
      
      // Add small delay between chunks
      if (i + chunkSize < points.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log(`[Qdrant] Successfully stored all ${docs.length} semantic documents`);
  }

  /**
   * Get entity by ID
   */
  async getEntity(tenantId: TenantId, entityId: string): Promise<CanonicalEntity | null> {
    try {
      // Use scroll with tenant filter for proper tenant isolation
      const results = await this.withRetry(
        () => this.client.scroll(this.entitiesCollection, {
          filter: {
            must: [
              { key: 'id', match: { value: entityId } },
              { key: 'tenantId', match: { value: tenantId } },
            ],
          },
          limit: 1,
          with_payload: true,
          with_vector: false,
        }),
        `get entity ${entityId}`
      );

      if (results.points.length === 0) return null;

      return results.points[0].payload as unknown as CanonicalEntity;
    } catch (error) {
      console.error('Failed to get entity:', error);
      return null;
    }
  }

  /**
   * Get semantic document by ID (with tenant isolation)
   */
  async getSemanticDocument(tenantId: TenantId, docId: string): Promise<SemanticDocument | null> {
    try {
      const results = await this.withRetry(
        () => this.client.scroll(this.semanticDocsCollection, {
          filter: {
            must: [
              { key: 'id', match: { value: docId } },
              { key: 'tenantId', match: { value: tenantId } },
            ],
          },
          limit: 1,
          with_payload: true,
          with_vector: false,
        }),
        `get semantic document ${docId}`
      );

      if (results.points.length === 0) return null;

      return results.points[0].payload as unknown as SemanticDocument;
    } catch (error) {
      console.error('Failed to get semantic document:', error);
      return null;
    }
  }

  /**
   * Get evidence by ID (with tenant isolation)
   */
  async getEvidence(tenantId: TenantId, evidenceId: string): Promise<Evidence | null> {
    try {
      const results = await this.withRetry(
        () => this.client.scroll(this.evidenceCollection, {
          filter: {
            must: [
              { key: 'id', match: { value: evidenceId } },
              { key: 'tenantId', match: { value: tenantId } },
            ],
          },
          limit: 1,
          with_payload: true,
          with_vector: false,
        }),
        `get evidence ${evidenceId}`
      );

      if (results.points.length === 0) return null;

      return results.points[0].payload as unknown as Evidence;
    } catch (error) {
      console.error('Failed to get evidence:', error);
      return null;
    }
  }

  /**
   * Search semantic documents with embeddings
   */
  async searchSemanticDocuments(
    tenantId: TenantId,
    query: string,
    limit: number = 10
  ): Promise<Array<{ document: SemanticDocument; score: number }>> {
    const embeddingResponse = await this.embeddingService.createEmbedding(query);

    const filter = {
      must: [
        {
          key: 'tenantId',
          match: { value: tenantId },
        },
      ],
    };

    const results = await this.withRetry(
      () => this.client.search(this.semanticDocsCollection, {
        vector: embeddingResponse.embedding,
        filter,
        limit,
        with_payload: true,
      }),
      `search semantic documents`
    );

    return results.map((result: any) => ({
      document: result.payload as SemanticDocument,
      score: result.score,
    }));
  }

  /**
   * Search semantic documents filtered by documentType.
   * Restricts vector search to a specific document kind (service | feature | code_module)
   * so chat tools do not surface irrelevant documents.
   *
   * Security: tenantId and documentType filters are applied server-side in Qdrant —
   * the LLM never sees records belonging to other tenants or wrong document kinds.
   */
  async searchSemanticDocumentsByType(
    tenantId: TenantId,
    query: string,
    documentType: SemanticDocumentType,
    limit: number = 10
  ): Promise<Array<{ document: SemanticDocument; score: number }>> {
    const embeddingResponse = await this.embeddingService.createEmbedding(query);

    const filter = {
      must: [
        { key: 'tenantId', match: { value: tenantId } },
        { key: 'documentType', match: { value: documentType } },
      ],
    };

    const results = await this.withRetry(
      () => this.client.search(this.semanticDocsCollection, {
        vector: embeddingResponse.embedding,
        filter,
        limit,
        with_payload: true,
      }),
      `search semantic documents by type (${documentType})`
    );

    return results.map((result: any) => ({
      document: result.payload as SemanticDocument,
      score: result.score,
    }));
  }
  async searchEntities(query: SearchQuery): Promise<SearchResult[]> {
    // Note: Since entities use dummy vectors [0], this search won't return meaningful results
    // This is kept for backward compatibility but should use listEntities instead
    console.warn('searchEntities: Entities use dummy vectors. Use listEntities for filtering.');
    
    const filter: any = {
      must: [
        {
          key: 'tenantId',
          match: { value: query.tenantId },
        },
      ],
    };

    // Add entity type filter
    if (query.entityTypes && query.entityTypes.length > 0) {
      filter.must.push({
        key: 'entityType',
        match: { any: query.entityTypes },
      });
    }

     // Add entity name filter
    if (query.name && query.name.length > 0) {
      filter.must.push({
        key: 'name',
        match: { value: query.name },
      });
    }

    // Add custom filters
    if (query.filters) {
      // Support an explicit OR-style filter: { _or: [{ field: 'name', value: 'foo' }, ...] }
      if (Array.isArray((query.filters as any)._or)) {
        filter.should = [];
        for (const f of (query.filters as any)._or) {
          if (f && f.field) {
            const matchClause: any = { key: f.field };
            // If caller provided an array of values use 'any', otherwise use single value
            if (Array.isArray(f.value)) {
              matchClause.match = { any: f.value };
            } else {
              matchClause.match = { value: f.value };
            }
            filter.should.push(matchClause);
          }
        }
      } else {
        for (const [key, value] of Object.entries(query.filters)) {
          // Skip the _or key if present but not an array
          if (key === '_or') continue;
          filter.must.push({
            key: key,
            match: Array.isArray(value) ? { any: value } : { value },
          });
        }
      }
    }

    // Use scroll instead of search for entities with dummy vectors
    const results = await this.withRetry(
      () => this.client.scroll(this.entitiesCollection, {
        filter,
        limit: query.limit || 10,
        with_payload: true,
        with_vector: false,
      }),
      `search entities`
    );

    return results.points.map((point: any) => ({
      entity: point.payload as CanonicalEntity,
      score: 1.0, // No meaningful score for dummy vectors
    }));
  }

  /**
   * List entities by filter
   */
  async listEntities(
    tenantId: TenantId,
    entityType?: string,
    limit: number = 100
  ): Promise<CanonicalEntity[]> {
    const filter: any = {
      must: [
        {
          key: 'tenantId',
          match: { value: tenantId },
        },
      ],
    };

    if (entityType) {
      filter.must.push({
        key: 'entityType',
        match: { value: entityType },
      });
    }

    const results = await this.withRetry(
      () => this.client.scroll(this.entitiesCollection, {
        filter,
        limit,
        with_payload: true,
      }),
      `list entities`
    );

    return results.points.map((point: any) => point.payload as CanonicalEntity);
  }

  /**
   * Find dependencies by name and version with direct filtering (optimized)
   */
  async findDependenciesByName(
    tenantId: TenantId,
    packageName: string,
    version?: string,
    limit: number = 100
  ): Promise<CanonicalEntity[]> {
    const filter: any = {
      must: [
        {
          key: 'tenantId',
          match: { value: tenantId },
        },
        {
          key: 'entityType',
          match: { value: 'dependency' },
        },
        {
          key: 'name',
          match: { value: packageName },
        },
      ],
    };

    if (version) {
      filter.must.push({
        key: 'version',
        match: { value: version },
      });
    }

    const results = await this.withRetry(
      () => this.client.scroll(this.entitiesCollection, {
        filter,
        limit,
        with_payload: true,
        with_vector: false,
      }),
      `find dependencies by name`
    );

    return results.points.map((point: any) => point.payload as CanonicalEntity);
  }

  /**
   * Fetch entities of a given type whose `name` field exactly matches one of
   * the provided values.  Uses Qdrant's `match.any` filter so the filtering
   * happens in the DB rather than in application memory.
   *
   * Security: names and repositoryId are never interpolated into query strings —
   * they are passed as structured values to the Qdrant client library which
   * serialises them safely.
   */
  async listEntitiesByNames(
    tenantId: TenantId,
    entityType: string,
    names: string[],
    limit: number = 100,
    repositoryId?: string,
  ): Promise<CanonicalEntity[]> {
    if (names.length === 0) return [];

    const must: any[] = [
      { key: 'tenantId',   match: { value: tenantId } },
      { key: 'entityType', match: { value: entityType } },
      { key: 'name',       match: { any: names } },
    ];

    if (repositoryId) {
      must.push({ key: 'repositoryId', match: { value: repositoryId } });
    }

    const results = await this.withRetry(
      () => this.client.scroll(this.entitiesCollection, {
        filter: { must },
        limit,
        with_payload: true,
        with_vector: false,
      }),
      `list ${entityType} entities by names`,
    );

    return results.points.map((point: any) => point.payload as CanonicalEntity);
  }

  /**
   * List semantic documents by filter (with tenant isolation)
   */
  async listSemanticDocuments(
    tenantId: TenantId,
    artifactId?: string,
    limit: number = 100
  ): Promise<SemanticDocument[]> {
    const filter: any = {
      must: [
        {
          key: 'tenantId',
          match: { value: tenantId },
        },
      ],
    };

    if (artifactId) {
      filter.must.push({
        key: 'artifactId',
        match: { value: artifactId },
      });
    }

    const results = await this.withRetry(
      () => this.client.scroll(this.semanticDocsCollection, {
        filter,
        limit,
        with_payload: true,
        with_vector: false,
      }),
      `list semantic documents`
    );

    return results.points.map((point: any) => point.payload as SemanticDocument);
  }

  /**
   * Find code modules that have a specific dependency
   */
  async findModulesByDependency(
    tenantId: TenantId,
    dependencyName: string,
    limit: number = 1000
  ): Promise<CodeModule[]> {
    const filter: any = {
      must: [
        {
          key: 'tenantId',
          match: { value: tenantId },
        },
        {
          key: 'entityType',
          match: { value: 'code_module' },
        },
        {
          key: 'dependencies',
          match: { any: [dependencyName] },
        },
      ],
    };

    const results = await this.withRetry(
      () => this.client.scroll(this.entitiesCollection, {
        filter,
        limit,
        with_payload: true,
      }),
      `find modules by dependency`
    );

    return results.points.map((point: any) => point.payload as CodeModule);
  }

  /**
   * Delete entity (with tenant isolation)
   */
  async deleteEntity(tenantId: TenantId, entityId: string): Promise<void> {
    // First verify the entity exists and belongs to the tenant
    const entity = await this.getEntity(tenantId, entityId);
    if (!entity) {
      throw new Error(`Entity not found or does not belong to tenant: ${entityId}`);
    }

    // Convert entity ID to Qdrant point ID for deletion
    await this.withRetry(
      () => this.client.delete(this.entitiesCollection, {
        wait: true,
        points: [this.toQdrantId(entityId)],
      }),
      `delete entity ${entityId}`
    );
  }

  /**
   * Delete all data for a tenant
   */
  async deleteTenant(tenantId: TenantId): Promise<void> {
    const filter = {
      must: [
        {
          key: 'tenantId',
          match: { value: tenantId },
        },
      ],
    };

    // Delete from all collections
    await this.withRetry(
      () => this.client.delete(this.entitiesCollection, {
        wait: true,
        filter,
      }),
      `delete tenant entities`
    );

    await this.withRetry(
      () => this.client.delete(this.evidenceCollection, {
        wait: true,
        filter,
      }),
      `delete tenant evidence`
    );

    await this.withRetry(
      () => this.client.delete(this.semanticDocsCollection, {
        wait: true,
        filter,
      }),
      `delete tenant semantic docs`
    );
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.withRetry(
        () => this.client.getCollections(),
        `health check`
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Extract text from semantic document for embedding.
   * Feature documents include richer content (businessValue, userStories, dataFlow)
   * so the embedding captures the full business context.
   */
  private extractTextFromSemanticDocument(doc: SemanticDocument): string {
    const parts: string[] = [];

    // Add responsibility (main semantic content)
    if (doc.responsibility) {
      parts.push(`description: ${doc.responsibility}`);
    }

    // Feature documents carry extra business-context fields in metadata
    if (doc.documentType === 'feature' && doc.metadata) {
      const m = doc.metadata;
      if (m['businessValue']) parts.push(`business value: ${m['businessValue']}`);
      if (Array.isArray(m['userStories']) && m['userStories'].length) {
        parts.push(`user stories: ${(m['userStories'] as string[]).join(' | ')}`);
      }
      if (m['dataFlowSummary']) parts.push(`data flow: ${m['dataFlowSummary']}`);
      if (Array.isArray(m['complianceConsiderations']) && m['complianceConsiderations'].length) {
        parts.push(`compliance: ${(m['complianceConsiderations'] as string[]).join(', ')}`);
      }
      if (m['dataClassificationSummary']) parts.push(`data classification: ${m['dataClassificationSummary']}`);
    }

    // Service documents — include service name for better recall
    if (doc.documentType === 'service' && doc.metadata?.['serviceName']) {
      parts.push(`service: ${doc.metadata['serviceName']}`);
    }

    // Add file path (for code_module documents)
    if (doc.documentType !== 'feature') {
      parts.push(`file path: ${doc.filePath}`);
    }

    return parts.filter(Boolean).join(' ');
  }
}
