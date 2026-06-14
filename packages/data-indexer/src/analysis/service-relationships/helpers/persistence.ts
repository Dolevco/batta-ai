import type {
  CodeService,
  BuildArtifact,
  DeploymentArtifact,
  Relationship,
  TenantId,
  EntityId,
  CloudResource,
} from '@batta/shared';
import { PostgresGraphAdapter, PostgresDataAdapter } from '@batta/shared';
import { buildServiceSemanticDoc } from '../../semantic-indexer';
import { CLOUD_REL_TYPES } from '../types';

export class PersistenceHelper {
  constructor(
    private readonly graphAdapter?: PostgresGraphAdapter,
    private readonly dataAdapter?: PostgresDataAdapter,
  ) {}

  /**
   * Persist updated buildArtifactAnalysis + responsibility onto the build artifact.
   * Writes to data store (full entity) and graph store (property update via storeEntity).
   *
   * Security: buildArtifactAnalysis has already been sanitized by the completion
   * tool and the sanitizeMetadata call in analyzeBuildArtifactFile before reaching here.
   */
  async persistBuildArtifact(artifact: BuildArtifact): Promise<void> {
    const now = new Date().toISOString();
    const updated: BuildArtifact = { ...artifact, updatedAt: now, lastIndexedAt: now };

    if (this.dataAdapter) {
      try {
        await this.dataAdapter.storeEntity(updated);
      } catch (err) {
        console.error(
          `   [SRE] ⚠️  DataAdapter: failed to persist buildArtifactAnalysis for "${artifact.name}":`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    if (this.graphAdapter) {
      try {
        await this.graphAdapter.storeEntity(updated);
      } catch (err) {
        console.error(
          `   [SRE] ⚠️  GraphAdapter: failed to persist buildArtifactAnalysis for "${artifact.name}":`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  /**
   * Persist updated iacAnalysis + responsibility onto the deployment artifact.
   * Writes to data store (full entity) and graph store (property update via storeEntity).
   *
   * Security: iacAnalysis has already been sanitized by the completion tool
   * and the sanitizeMetadata call in analyzeIaCFile before reaching here.
   */
  async persistDeploymentArtifact(artifact: DeploymentArtifact): Promise<void> {
    const now = new Date().toISOString();
    const updated: DeploymentArtifact = { ...artifact, updatedAt: now, lastIndexedAt: now };

    if (this.dataAdapter) {
      try {
        await this.dataAdapter.storeEntity(updated);
      } catch (err) {
        console.error(
          `   [SRE] ⚠️  DataAdapter: failed to persist iacAnalysis for "${artifact.name}":`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    if (this.graphAdapter) {
      try {
        await this.graphAdapter.storeEntity(updated);
      } catch (err) {
        console.error(
          `   [SRE] ⚠️  GraphAdapter: failed to persist iacAnalysis for "${artifact.name}":`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  /**
   * Persist updated externalDeps onto the service entity.
   * Writes to data store (full entity) and graph store (property update via storeEntity).
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
   * service entity. Writes to data store (full entity) and graph store (property update).
   * Also indexes the service responsibility as a semantic document for chat search.
   *
   * Security: serviceAnalysis has already been sanitized by the completion tool
   * and the sanitizeMetadata call in ServiceAnalyzer.analyzeService before reaching here.
   */
  async persistServiceAnalysis(service: CodeService): Promise<void> {
    const now = new Date().toISOString();
    const updated: CodeService = { ...service, updatedAt: now, lastIndexedAt: now };

    if (this.dataAdapter) {
      try {
        await this.dataAdapter.storeEntity(updated);
      } catch (err) {
        console.error(
          `   [SRE] ⚠️  DataAdapter: failed to persist serviceAnalysis for "${service.name}":`,
          err instanceof Error ? err.message : String(err),
        );
      }

      // Index service responsibility as a semantic document for vector search.
      const semanticDoc = buildServiceSemanticDoc(service.tenantId, updated);
      if (semanticDoc) {
        try {
          await this.dataAdapter.storeSemanticDocuments([semanticDoc]);
        } catch (err) {
          console.error(
            `   [SRE] ⚠️  DataAdapter: failed to index service semantic doc for "${service.name}":`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }

    if (this.graphAdapter) {
      try {
        await this.graphAdapter.storeEntity(updated);
      } catch (err) {
        console.error(
          `   [SRE] ⚠️  GraphAdapter: failed to persist serviceAnalysis for "${service.name}":`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  /**
   * Persist a CloudResource node to graph store (and data store for searchability).
   * Used by Steps 2.5 to ensure inferred CloudResource nodes exist before
   * the graph edges that reference them are written.
   *
   * Security: CloudResource entities contain only structural metadata (INTERNAL).
   * No secret values may appear — this is enforced upstream by the relationship emitter.
   */
  async persistCloudResource(resource: CloudResource): Promise<void> {
    const now = new Date().toISOString();
    const updated: CloudResource = { ...resource, updatedAt: now, lastIndexedAt: now };

    if (this.graphAdapter) {
      try {
        await this.graphAdapter.storeEntity(updated);
      } catch (err) {
        console.error(
          `   [SRE] ⚠️  GraphAdapter: failed to persist CloudResource "${resource.name}":`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    if (this.dataAdapter) {
      try {
        await this.dataAdapter.storeEntity(updated);
      } catch (err) {
        console.error(
          `   [SRE] ⚠️  DataAdapter: failed to persist CloudResource "${resource.name}":`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  /**
   * Persist relationships immediately to graph store.
   */
  async persistRelationships(relationships: Relationship[]): Promise<void> {
    if (!this.graphAdapter || relationships.length === 0) return;
    try {
      await this.graphAdapter.storeRelationships(relationships);
    } catch (err) {
      console.error(
        `   [SRE] ⚠️  GraphAdapter: failed to store relationships:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async persistServiceThreatModel(service: CodeService): Promise<void> {
    if (!this.dataAdapter) return;
    try {
      const now = new Date().toISOString();
      await this.dataAdapter.storeEntity({ ...service, updatedAt: now, lastIndexedAt: now });
    } catch (err) {
      console.error(
        `   [SRE] ⚠️  DataAdapter: failed to persist threat model for "${service.name}":`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * Persist exploitability analysis results onto the service entity.
   * Writes to data store only (exploitability data is not graph-structural).
   *
   * Security: exploitabilityAnalysis has already been sanitized field-by-field
   * in ExploitabilityAnalyzer.parseNarrativeResponse before reaching here.
   */
  async persistServiceExploitability(service: CodeService): Promise<void> {
    if (!this.dataAdapter) return;
    try {
      const now = new Date().toISOString();
      await this.dataAdapter.storeEntity({ ...service, updatedAt: now, lastIndexedAt: now });
    } catch (err) {
      console.error(
        `   [SRE] ⚠️  DataAdapter: failed to persist exploitability for "${service.name}":`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * Fetch cloud-relevant relationships for a service from graph store.
   * Returns all outgoing and incoming relationships whose type is in
   * CLOUD_REL_TYPES — i.e. how the service is deployed to and interacts
   * with cloud infrastructure at runtime.
   */
  async getCloudRelationshipsForService(
    tenantId: TenantId,
    serviceId: EntityId,
  ): Promise<Relationship[]> {
    if (!this.graphAdapter) return [];
    const [outgoing, incoming] = await Promise.all([
      this.graphAdapter.getRelationshipsBySource(tenantId, serviceId),
      this.graphAdapter.getRelationshipsByTarget(tenantId, serviceId),
    ]);
    return [...outgoing, ...incoming].filter(r => CLOUD_REL_TYPES.has(r.type));
  }

  /**
   * Fetch services that a given service directly depends on (DEPENDS_ON edges)
   * and return them with their full entity payloads from data store.
   */
  async getDependentServices(
    tenantId: TenantId,
    serviceId: EntityId,
  ): Promise<CodeService[]> {
    if (!this.graphAdapter || !this.dataAdapter) return [];
    const depRels = await this.graphAdapter.getRelationshipsBySource(tenantId, serviceId, 'DEPENDS_ON');
    const entities = await Promise.all(
      depRels.map(r => this.dataAdapter!.getEntity(tenantId, r.targetId)),
    );
    return entities.filter((e): e is CodeService => e?.entityType === 'code_service');
  }
}
