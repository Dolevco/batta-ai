import { Pool } from 'pg';
import {
  CanonicalEntity,
  Evidence,
  TenantId,
  SemanticDocument,
  SemanticDocumentType,
  CodeModule,
} from '../types/canonical.types';
import { IEmbeddingHandler } from '@batta/core';
import { SCHEMA_SQL, MIGRATIONS_SQL } from './schema';

export interface PostgresConfig {
  connectionString?: string;
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

export class PostgresDataAdapter {
  constructor(
    private readonly pool: Pool,
    private readonly embeddingService: IEmbeddingHandler
  ) {}

  async initialize(): Promise<void> {
    const client = await this.pool.connect();
    try {
      // Run column migrations before the main schema so CREATE INDEX statements
      // that reference new columns don't fail on existing tables missing those columns.
      await client.query(MIGRATIONS_SQL);
      await client.query(SCHEMA_SQL);
    } finally {
      client.release();
    }
  }

  async storeEntity(entity: CanonicalEntity): Promise<void> {
    await this.pool.query(
      `INSERT INTO entities (id, tenant_id, entity_type, payload, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (tenant_id, id) DO UPDATE
         SET entity_type = EXCLUDED.entity_type,
             payload     = entities.payload || EXCLUDED.payload,
             updated_at  = now()`,
      [entity.id, entity.tenantId, entity.entityType, JSON.stringify(entity)]
    );
  }

  async storeEntities(entities: CanonicalEntity[]): Promise<void> {
    if (entities.length === 0) return;

    // Fetch existing to merge (preserve enriched fields)
    const ids = entities.map(e => e.id);
    const existing = await this.getEntitiesByIds(entities[0].tenantId, ids);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const entity of entities) {
        const prev = existing.get(entity.id);
        const merged = prev ? { ...prev, ...entity } : entity;
        await client.query(
          `INSERT INTO entities (id, tenant_id, entity_type, payload, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (tenant_id, id) DO UPDATE
             SET entity_type = EXCLUDED.entity_type,
                 payload     = EXCLUDED.payload,
                 updated_at  = now()`,
          [merged.id, merged.tenantId, merged.entityType, JSON.stringify(merged)]
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

  async storeEvidence(evidence: Evidence): Promise<void> {
    const subjectId = (evidence as any).subjectId ?? (evidence as any).entityId ?? '';
    const evidenceType = (evidence as any).evidenceType ?? (evidence as any).relationship ?? '';
    await this.pool.query(
      `INSERT INTO evidence (id, tenant_id, evidence_type, subject_id, payload)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, id) DO UPDATE
         SET evidence_type = EXCLUDED.evidence_type,
             subject_id    = EXCLUDED.subject_id,
             payload       = EXCLUDED.payload`,
      [evidence.id, evidence.tenantId, evidenceType, subjectId, JSON.stringify(evidence)]
    );
  }

  async storeEvidenceRecords(evidenceRecords: Evidence[]): Promise<void> {
    if (evidenceRecords.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const ev of evidenceRecords) {
        await this.storeEvidence(ev);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async storeSemanticDocument(doc: SemanticDocument): Promise<void> {
    const text = this.extractTextFromSemanticDocument(doc);
    const { embedding } = await this.embeddingService.createEmbedding(text);
    await this.pool.query(
      `INSERT INTO semantic_documents
         (id, tenant_id, artifact_id, document_type, input_hash, responsibility, payload, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id, id) DO UPDATE
         SET artifact_id   = EXCLUDED.artifact_id,
             document_type = EXCLUDED.document_type,
             input_hash    = EXCLUDED.input_hash,
             responsibility= EXCLUDED.responsibility,
             payload       = EXCLUDED.payload,
             embedding     = EXCLUDED.embedding`,
      [
        doc.id,
        doc.tenantId,
        doc.artifactId ?? '',
        doc.documentType ?? null,
        (doc as any).inputHash ?? '',
        doc.responsibility ?? null,
        JSON.stringify(doc),
        `[${embedding.join(',')}]`,
      ]
    );
  }

  async storeSemanticDocuments(docs: SemanticDocument[]): Promise<void> {
    if (docs.length === 0) return;
    const texts = docs.map(d => this.extractTextFromSemanticDocument(d));
    const embeddings = await this.embeddingService.embedBatch(texts);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < docs.length; i++) {
        const doc = docs[i];
        await client.query(
          `INSERT INTO semantic_documents
             (id, tenant_id, artifact_id, document_type, input_hash, responsibility, payload, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (tenant_id, id) DO UPDATE
             SET artifact_id   = EXCLUDED.artifact_id,
                 document_type = EXCLUDED.document_type,
                 input_hash    = EXCLUDED.input_hash,
                 responsibility= EXCLUDED.responsibility,
                 payload       = EXCLUDED.payload,
                 embedding     = EXCLUDED.embedding`,
          [
            doc.id,
            doc.tenantId,
            doc.artifactId ?? '',
            doc.documentType ?? null,
            (doc as any).inputHash ?? '',
            doc.responsibility ?? null,
            JSON.stringify(doc),
            `[${embeddings[i].join(',')}]`,
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

  async getEntity(tenantId: TenantId, entityId: string): Promise<CanonicalEntity | null> {
    const res = await this.pool.query(
      'SELECT payload FROM entities WHERE tenant_id = $1 AND id = $2',
      [tenantId, entityId]
    );
    return res.rows[0]?.payload ?? null;
  }

  async getEntitiesByIds(tenantId: TenantId, entityIds: string[]): Promise<Map<string, CanonicalEntity>> {
    const result = new Map<string, CanonicalEntity>();
    if (entityIds.length === 0) return result;
    const res = await this.pool.query(
      'SELECT payload FROM entities WHERE tenant_id = $1 AND id = ANY($2)',
      [tenantId, entityIds]
    );
    for (const row of res.rows) {
      const e = row.payload as CanonicalEntity;
      result.set(e.id, e);
    }
    return result;
  }

  async getSemanticDocument(tenantId: TenantId, docId: string): Promise<SemanticDocument | null> {
    const res = await this.pool.query(
      'SELECT payload FROM semantic_documents WHERE tenant_id = $1 AND id = $2',
      [tenantId, docId]
    );
    return res.rows[0]?.payload ?? null;
  }

  async getEvidence(tenantId: TenantId, evidenceId: string): Promise<Evidence | null> {
    const res = await this.pool.query(
      'SELECT payload FROM evidence WHERE tenant_id = $1 AND id = $2',
      [tenantId, evidenceId]
    );
    return res.rows[0]?.payload ?? null;
  }

  async searchSemanticDocuments(
    tenantId: TenantId,
    query: string,
    limit: number = 10
  ): Promise<Array<{ document: SemanticDocument; score: number }>> {
    const { embedding } = await this.embeddingService.createEmbedding(query);
    const vec = `[${embedding.join(',')}]`;
    const res = await this.pool.query(
      `SELECT payload, 1 - (embedding <=> $3::vector) AS score
       FROM semantic_documents
       WHERE tenant_id = $1 AND embedding IS NOT NULL
       ORDER BY embedding <=> $3::vector
       LIMIT $2`,
      [tenantId, limit, vec]
    );
    return res.rows.map(r => ({ document: r.payload as SemanticDocument, score: r.score }));
  }

  async searchSemanticDocumentsByType(
    tenantId: TenantId,
    query: string,
    documentType: SemanticDocumentType,
    limit: number = 10
  ): Promise<Array<{ document: SemanticDocument; score: number }>> {
    const { embedding } = await this.embeddingService.createEmbedding(query);
    const vec = `[${embedding.join(',')}]`;
    const res = await this.pool.query(
      `SELECT payload, 1 - (embedding <=> $4::vector) AS score
       FROM semantic_documents
       WHERE tenant_id = $1 AND document_type = $2 AND embedding IS NOT NULL
       ORDER BY embedding <=> $4::vector
       LIMIT $3`,
      [tenantId, documentType, limit, vec]
    );
    return res.rows.map(r => ({ document: r.payload as SemanticDocument, score: r.score }));
  }

  async searchEntities(query: SearchQuery): Promise<SearchResult[]> {
    const conditions: string[] = ['e.tenant_id = $1'];
    const params: any[] = [query.tenantId];
    let idx = 2;

    if (query.entityTypes && query.entityTypes.length > 0) {
      conditions.push(`e.entity_type = ANY($${idx})`);
      params.push(query.entityTypes);
      idx++;
    }

    if (query.name) {
      conditions.push(`e.payload->>'name' = $${idx}`);
      params.push(query.name);
      idx++;
    }

    if (query.filters) {
      const orFilters = (query.filters as any)._or;
      if (Array.isArray(orFilters)) {
        const orClauses: string[] = [];
        for (const f of orFilters) {
          if (f?.field) {
            if (Array.isArray(f.value)) {
              orClauses.push(`e.payload->>'${f.field}' = ANY($${idx})`);
              params.push(f.value);
              idx++;
            } else {
              orClauses.push(`e.payload->>'${f.field}' = $${idx}`);
              params.push(f.value);
              idx++;
            }
          }
        }
        if (orClauses.length > 0) {
          conditions.push(`(${orClauses.join(' OR ')})`);
        }
      } else {
        for (const [key, value] of Object.entries(query.filters)) {
          if (key === '_or') continue;
          if (Array.isArray(value)) {
            conditions.push(`e.payload->>'${key}' = ANY($${idx})`);
          } else {
            conditions.push(`e.payload->>'${key}' = $${idx}`);
          }
          params.push(value);
          idx++;
        }
      }
    }

    const sql = `SELECT payload FROM entities e WHERE ${conditions.join(' AND ')} LIMIT $${idx}`;
    params.push(query.limit ?? 10);
    const res = await this.pool.query(sql, params);
    return res.rows.map(r => ({ entity: r.payload as CanonicalEntity, score: 1.0 }));
  }

  async listEntities(
    tenantId: TenantId,
    entityType?: string,
    limit: number = 100
  ): Promise<CanonicalEntity[]> {
    if (entityType) {
      const res = await this.pool.query(
        'SELECT payload FROM entities WHERE tenant_id = $1 AND entity_type = $2 LIMIT $3',
        [tenantId, entityType, limit]
      );
      return res.rows.map(r => r.payload as CanonicalEntity);
    }
    const res = await this.pool.query(
      'SELECT payload FROM entities WHERE tenant_id = $1 LIMIT $2',
      [tenantId, limit]
    );
    return res.rows.map(r => r.payload as CanonicalEntity);
  }

  async listEntitiesByNames(
    tenantId: TenantId,
    entityType: string,
    names: string[],
    limit: number = 100,
    repositoryId?: string
  ): Promise<CanonicalEntity[]> {
    if (names.length === 0) return [];
    const params: any[] = [tenantId, entityType, names, limit];
    let sql = `SELECT payload FROM entities
               WHERE tenant_id = $1 AND entity_type = $2
                 AND payload->>'name' = ANY($3)`;
    if (repositoryId) {
      sql += ` AND payload->>'repositoryId' = $5`;
      params.push(repositoryId);
    }
    sql += ' LIMIT $4';
    const res = await this.pool.query(sql, params);
    return res.rows.map(r => r.payload as CanonicalEntity);
  }

  async listSemanticDocuments(
    tenantId: TenantId,
    artifactId?: string,
    limit: number = 100
  ): Promise<SemanticDocument[]> {
    if (artifactId) {
      const res = await this.pool.query(
        'SELECT payload FROM semantic_documents WHERE tenant_id = $1 AND artifact_id = $2 LIMIT $3',
        [tenantId, artifactId, limit]
      );
      return res.rows.map(r => r.payload as SemanticDocument);
    }
    const res = await this.pool.query(
      'SELECT payload FROM semantic_documents WHERE tenant_id = $1 LIMIT $2',
      [tenantId, limit]
    );
    return res.rows.map(r => r.payload as SemanticDocument);
  }

  async findDependenciesByName(
    tenantId: TenantId,
    packageName: string,
    version?: string,
    limit: number = 100
  ): Promise<CanonicalEntity[]> {
    const params: any[] = [tenantId, packageName, limit];
    let sql = `SELECT payload FROM entities
               WHERE tenant_id = $1 AND entity_type = 'dependency'
                 AND payload->>'name' = $2`;
    if (version) {
      sql += ` AND payload->>'version' = $4`;
      params.push(version);
    }
    sql += ' LIMIT $3';
    const res = await this.pool.query(sql, params);
    return res.rows.map(r => r.payload as CanonicalEntity);
  }

  async findModulesByDependency(
    tenantId: TenantId,
    dependencyName: string,
    limit: number = 1000
  ): Promise<CodeModule[]> {
    const res = await this.pool.query(
      `SELECT payload FROM entities
       WHERE tenant_id = $1 AND entity_type = 'code_module'
         AND payload->'dependencies' ? $2
       LIMIT $3`,
      [tenantId, dependencyName, limit]
    );
    return res.rows.map(r => r.payload as CodeModule);
  }

  async deleteEntity(tenantId: TenantId, entityId: string): Promise<void> {
    const res = await this.pool.query(
      'DELETE FROM entities WHERE tenant_id = $1 AND id = $2',
      [tenantId, entityId]
    );
    if (res.rowCount === 0) {
      throw new Error(`Entity not found or does not belong to tenant: ${entityId}`);
    }
  }

  async deleteEntitiesByType(tenantId: TenantId, entityType: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM entities WHERE tenant_id = $1 AND entity_type = $2',
      [tenantId, entityType]
    );
  }

  async deleteTenant(tenantId: TenantId): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM entities WHERE tenant_id = $1', [tenantId]);
      await client.query('DELETE FROM evidence WHERE tenant_id = $1', [tenantId]);
      await client.query('DELETE FROM semantic_documents WHERE tenant_id = $1', [tenantId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async listEvidenceForSubjects(
    tenantId: TenantId,
    subjectIds: string[],
    limitPerSubject = 5,
  ): Promise<Evidence[]> {
    const clamped = subjectIds.slice(0, 100);
    if (clamped.length === 0) return [];
    const res = await this.pool.query(
      `SELECT DISTINCT ON (subject_id) payload
       FROM evidence
       WHERE tenant_id = $1 AND subject_id = ANY($2)
       LIMIT $3`,
      [tenantId, clamped, clamped.length * limitPerSubject],
    );
    return res.rows.map(r => r.payload as Evidence);
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  private extractTextFromSemanticDocument(doc: SemanticDocument): string {
    const parts: string[] = [];
    if (doc.responsibility) parts.push(`description: ${doc.responsibility}`);
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
    if (doc.documentType === 'service' && doc.metadata?.['serviceName']) {
      parts.push(`service: ${doc.metadata['serviceName']}`);
    }
    if (doc.documentType !== 'feature') {
      parts.push(`file path: ${doc.filePath}`);
    }
    return parts.filter(Boolean).join(' ');
  }
}
