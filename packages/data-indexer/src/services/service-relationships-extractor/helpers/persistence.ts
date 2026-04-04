import type {
  CodeService,
  BuildArtifact,
  DeploymentArtifact,
  Relationship,
  TenantId,
  EntityId,
} from '@ai-agent/shared';
import { Neo4jAdapter, QdrantAdapter } from '@ai-agent/shared';
import { buildServiceSemanticDoc } from '../../semantic-indexer';
import { CLOUD_REL_TYPES } from '../types';

export class PersistenceHelper {
  constructor(
    private readonly neo4j?: Neo4jAdapter,
    private readonly qdrant?: QdrantAdapter,
  ) {}

  /**
   * Persist updated buildArtifactAnalysis + responsibility onto the build artifact.
   * Writes to Qdrant (full entity) and Neo4j (property update via storeEntity).
   *
   * Security: buildArtifactAnalysis has already been sanitized by the completion
   * tool and the sanitizeMetadata call in analyzeBuildArtifactFile before reaching here.
   */
  async persistBuildArtifact(artifact: BuildArtifact): Promise<void> {
    const now = new Date().toISOString();
    const updated: BuildArtifact = { ...artifact, updatedAt: now, lastIndexedAt: now };

    if (this.qdrant) {
      try {
        await this.qdrant.storeEntity(updated);
      } catch (err) {
        console.error(
          `   [SRE] ⚠️  Qdrant: failed to persist buildArtifactAnalysis for "${artifact.name}":`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    if (this.neo4j) {
      try {
        await this.neo4j.storeEntity(updated);
      } catch (err) {
        console.error(
          `   [SRE] ⚠️  Neo4j: failed to persist buildArtifactAnalysis for "${artifact.name}":`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  /**
   * Persist updated iacAnalysis + responsibility onto the deployment artifact.
   * Writes to Qdrant (full entity) and Neo4j (property update via storeEntity).
   *
   * Security: iacAnalysis has already been sanitized by the completion tool
   * and the sanitizeMetadata call in analyzeIaCFile before reaching here.
   */
  async persistDeploymentArtifact(artifact: DeploymentArtifact): Promise<void> {
    const now = new Date().toISOString();
    const updated: DeploymentArtifact = { ...artifact, updatedAt: now, lastIndexedAt: now };

    if (this.qdrant) {
      try {
        await this.qdrant.storeEntity(updated);
      } catch (err) {
        console.error(
          `   [SRE] ⚠️  Qdrant: failed to persist iacAnalysis for "${artifact.name}":`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    if (this.neo4j) {
      try {
        await this.neo4j.storeEntity(updated);
      } catch (err) {
        console.error(
          `   [SRE] ⚠️  Neo4j: failed to persist iacAnalysis for "${artifact.name}":`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  /**
   * Persist updated externalDeps onto the service entity.
   * Writes to Qdrant (full entity) and Neo4j (property update via storeEntity).
   * Also indexes the service responsibility as a semantic document for chat search.
   *
   * Security: externalDeps have already been sanitized by the completion tool
   * and the sanitizeMetadata call in extractExternalDeps before reaching here.
   */
  async persistServiceExternalDeps(service: CodeService): Promise<void> {
    return this.persistServiceAnalysis(service);
  }

  /**
   * Persist updated serviceAnalysis + externalDeps + responsibility onto the
   * service entity. Writes to Qdrant (full entity) and Neo4j (property update).
   * Also indexes the service responsibility as a semantic document for chat search.
   *
   * Security: serviceAnalysis has already been sanitized by the completion tool
   * and the sanitizeMetadata call in ServiceAnalyzer.analyzeService before reaching here.
   */
  async persistServiceAnalysis(service: CodeService): Promise<void> {
    const now = new Date().toISOString();
    const updated: CodeService = { ...service, updatedAt: now, lastIndexedAt: now };

    if (this.qdrant) {
      try {
        await this.qdrant.storeEntity(updated);
      } catch (err) {
        console.error(
          `   [SRE] ⚠️  Qdrant: failed to persist serviceAnalysis for "${service.name}":`,
          err instanceof Error ? err.message : String(err),
        );
      }

      // Index service responsibility as a semantic document for vector search.
      const semanticDoc = buildServiceSemanticDoc(service.tenantId, updated);
      if (semanticDoc) {
        try {
          await this.qdrant.storeSemanticDocuments([semanticDoc]);
        } catch (err) {
          console.error(
            `   [SRE] ⚠️  Qdrant: failed to index service semantic doc for "${service.name}":`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }

    if (this.neo4j) {
      try {
        await this.neo4j.storeEntity(updated);
      } catch (err) {
        console.error(
          `   [SRE] ⚠️  Neo4j: failed to persist serviceAnalysis for "${service.name}":`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  /**
   * Persist relationships immediately to Neo4j.
   */
  async persistRelationships(relationships: Relationship[]): Promise<void> {
    if (!this.neo4j || relationships.length === 0) return;
    try {
      await this.neo4j.storeRelationships(relationships);
    } catch (err) {
      console.error(
        `   [SRE] ⚠️  Neo4j: failed to store relationships:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async persistServiceThreatModel(service: CodeService): Promise<void> {
    if (!this.qdrant) return;
    try {
      const now = new Date().toISOString();
      await this.qdrant.storeEntity({ ...service, updatedAt: now, lastIndexedAt: now });
    } catch (err) {
      console.error(
        `   [SRE] ⚠️  Qdrant: failed to persist threat model for "${service.name}":`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * Persist exploitability analysis results onto the service entity.
   * Writes to Qdrant only (exploitability data is not graph-structural).
   *
   * Security: exploitabilityAnalysis has already been sanitized field-by-field
   * in ExploitabilityAnalyzer.parseNarrativeResponse before reaching here.
   */
  async persistServiceExploitability(service: CodeService): Promise<void> {
    if (!this.qdrant) return;
    try {
      const now = new Date().toISOString();
      await this.qdrant.storeEntity({ ...service, updatedAt: now, lastIndexedAt: now });
    } catch (err) {
      console.error(
        `   [SRE] ⚠️  Qdrant: failed to persist exploitability for "${service.name}":`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * Fetch cloud-relevant relationships for a service from Neo4j.
   * Returns all outgoing and incoming relationships whose type is in
   * CLOUD_REL_TYPES — i.e. how the service is deployed to and interacts
   * with cloud infrastructure at runtime.
   */
  async getCloudRelationshipsForService(
    tenantId: TenantId,
    serviceId: EntityId,
  ): Promise<Relationship[]> {
    if (!this.neo4j) return [];
    const [outgoing, incoming] = await Promise.all([
      this.neo4j.getRelationshipsBySource(tenantId, serviceId),
      this.neo4j.getRelationshipsByTarget(tenantId, serviceId),
    ]);
    return [...outgoing, ...incoming].filter(r => CLOUD_REL_TYPES.has(r.type));
  }

  /**
   * Fetch services that a given service directly depends on (DEPENDS_ON edges)
   * and return them with their full entity payloads from Qdrant.
   */
  async getDependentServices(
    tenantId: TenantId,
    serviceId: EntityId,
  ): Promise<CodeService[]> {
    if (!this.neo4j || !this.qdrant) return [];
    const depRels = await this.neo4j.getRelationshipsBySource(tenantId, serviceId, 'DEPENDS_ON');
    const entities = await Promise.all(
      depRels.map(r => this.qdrant!.getEntity(tenantId, r.targetId)),
    );
    return entities.filter((e): e is CodeService => e?.entityType === 'code_service');
  }
}
