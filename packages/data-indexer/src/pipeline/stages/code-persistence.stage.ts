/**
 * Stage 5: Persistence
 * 
 * Projects entities to downstream stores (relational, graph, vector)
 */

import {
  PersistenceStage,
  PersistenceOutput,
  TransformationOutput,
  SemanticAnalysisOutput,
  ExtractionError,
} from '../pipeline.types';
import { TenantId } from '@batta/shared';
import { PostgresDataAdapter } from '@batta/shared';
import { PostgresGraphAdapter } from '@batta/shared';

/**
 * Code Persistence Stage
 *
 * Supports incremental persistence - can persist entities, relationships, evidence, and semantic documents separately
 */
export class CodePersistenceStage implements PersistenceStage {
  constructor(
    private dataAdapter: PostgresDataAdapter,
    private graphAdapter: PostgresGraphAdapter
  ) {}

  /**
   * Persist entities and evidence (after extraction/transformation)
   */
  async persistEntities(
    _tenantId: TenantId,
    entities: any[],
    evidence: any[]
  ): Promise<{ entitiesWritten: number; evidenceWritten: number; errors: ExtractionError[] }> {
    const errors: ExtractionError[] = [];
    let entitiesWritten = 0;
    let evidenceWritten = 0;

    // Store entities to PostgreSQL
    if (entities.length > 0) {
      try {
        await this.dataAdapter.storeEntities(entities);
        entitiesWritten = entities.length;
      } catch (error) {
        errors.push({
          stage: 'transformation',
          message: `Failed to store entities to PostgreSQL: ${error}`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Store entities to PostgreSQL
    if (entities.length > 0) {
      try {
        await this.graphAdapter.storeEntities(entities);
      } catch (error) {
        errors.push({
          stage: 'transformation',
          message: `Failed to store entities to PostgreSQL: ${error}`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Store evidence to PostgreSQL
    if (evidence.length > 0) {
      try {
        await this.dataAdapter.storeEvidenceRecords(evidence);
        evidenceWritten = evidence.length;
      } catch (error) {
        errors.push({
          stage: 'transformation',
          message: `Failed to store evidence to PostgreSQL: ${error}`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return { entitiesWritten, evidenceWritten, errors };
  }

  /**
   * Persist relationships (after LLM correlation)
   */
  async persistRelationships(
    _tenantId: TenantId,
    relationships: any[]
  ): Promise<{ relationshipsWritten: number; errors: ExtractionError[] }> {
    const errors: ExtractionError[] = [];
    let relationshipsWritten = 0;

    if (relationships.length > 0) {
      try {
        await this.graphAdapter.storeRelationships(relationships);
        relationshipsWritten = relationships.length;
      } catch (error) {
        errors.push({
          stage: 'transformation',
          message: `Failed to store relationships to PostgreSQL: ${error}`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return { relationshipsWritten, errors };
  }

  /**
   * Persist semantic documents (after semantic analysis)
   */
  async persistSemanticDocuments(
    _tenantId: TenantId,
    documents: any[]
  ): Promise<{ documentsIndexed: number; errors: ExtractionError[] }> {
    const errors: ExtractionError[] = [];
    let documentsIndexed = 0;

    if (documents.length > 0) {
      try {
        await this.dataAdapter.storeSemanticDocuments(documents);
        documentsIndexed = documents.length;
      } catch (error) {
        errors.push({
          stage: 'semantic',
          message: `Failed to store semantic documents to PostgreSQL: ${error}`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return { documentsIndexed, errors };
  }

  // Legacy method for backward compatibility
  async persist(
    _tenantId: TenantId,
    transformation: TransformationOutput,
    semantic: SemanticAnalysisOutput
  ): Promise<PersistenceOutput> {
    const errors: ExtractionError[] = [];
    let entitiesWritten = 0;
    let relationshipsWritten = 0;
    let evidenceWritten = 0;
    let nodesWritten = 0;
    let edgesWritten = 0;
    let documentsIndexed = 0;
    let embeddingsCreated = 0;

    // 1. Store entities to PostgreSQL (document store with embeddings)
    if (transformation.entities.length > 0) {
      try {
        await this.dataAdapter.storeEntities(transformation.entities);
        entitiesWritten = transformation.entities.length;
      } catch (error) {
        errors.push({
          stage: 'transformation',
          message: `Failed to store entities to PostgreSQL: ${error}`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // 2. Store evidence to PostgreSQL
    if (transformation.evidence.length > 0) {
      try {
        await this.dataAdapter.storeEvidenceRecords(transformation.evidence);
        evidenceWritten = transformation.evidence.length;
      } catch (error) {
        errors.push({
          stage: 'transformation',
          message: `Failed to store evidence to PostgreSQL: ${error}`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // 3. Store semantic documents to PostgreSQL (vector store with embeddings)
    if (semantic.documents.length > 0) {
      try {
        await this.dataAdapter.storeSemanticDocuments(semantic.documents);
        documentsIndexed = semantic.documents.length;
        embeddingsCreated = semantic.documents.length;
      } catch (error) {
        errors.push({
          stage: 'semantic',
          message: `Failed to store semantic documents to PostgreSQL: ${error}`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // 4. Store entities as nodes in graph store
    if (transformation.entities.length > 0) {
      try {
        await this.graphAdapter.storeEntities(transformation.entities);
        nodesWritten = transformation.entities.length;
      } catch (error) {
        errors.push({
          stage: 'transformation',
          message: `Failed to store entities to PostgreSQL: ${error}`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // 5. Store relationships as edges in graph store
    if (transformation.relationships.length > 0) {
      try {
        await this.graphAdapter.storeRelationships(transformation.relationships);
        edgesWritten = transformation.relationships.length;
        relationshipsWritten = transformation.relationships.length;
      } catch (error) {
        errors.push({
          stage: 'transformation',
          message: `Failed to store relationships to PostgreSQL: ${error}`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return {
      relational: {
        entitiesWritten,
        relationshipsWritten,
        evidenceWritten,
      },
      graph: {
        nodesWritten,
        edgesWritten,
      },
      vector: {
        documentsIndexed,
        embeddingsCreated,
      },
      errors,
    };
  }
}
