/**
 * Deterministic ID Generation
 * 
 * Generates stable, deterministic IDs for entities based on their natural keys.
 * This ensures idempotent indexing - re-indexing produces the same IDs.
 */

import * as crypto from 'crypto';
import { EntityIdGenerator } from '../types/pipeline.types';
import { TenantId } from '@ai-agent/shared';

export class DeterministicIdGenerator implements EntityIdGenerator {
  /**
   * Generate a deterministic entity ID
   * Format: <entityType>:<hash>
   */
  generateEntityId(
    tenantId: TenantId,
    entityType: string,
    naturalKey: Record<string, any>
  ): string {
    const keyString = this.normalizeKey({ tenantId, entityType, ...naturalKey });
    const hash = this.hash(keyString);
    return `${entityType}:${hash}`;
  }

  /**
   * Generate a deterministic relationship ID
   * Format: rel:<hash>
   *
   * NOTE: validFrom is intentionally excluded from the key so that re-indexing
   * the same logical relationship (same tenant/type/source/target) produces the
   * same ID and the Neo4j MERGE upserts instead of creating a duplicate edge.
   */
  generateRelationshipId(
    tenantId: TenantId,
    type: string,
    sourceId: string,
    targetId: string,
    _validFrom?: string
  ): string {
    const keyString = this.normalizeKey({
      tenantId,
      type,
      sourceId,
      targetId,
    });
    const hash = this.hash(keyString);
    return `rel:${hash}`;
  }

  /**
   * Generate content hash (for deduplication)
   */
  generateContentHash(content: string): string {
    return this.hash(content);
  }

  /**
   * Normalize a key object into a deterministic string
   */
  private normalizeKey(key: Record<string, any>): string {
    // Sort keys alphabetically for determinism
    const sortedKeys = Object.keys(key).sort();
    
    // Build canonical string representation
    const parts = sortedKeys.map(k => {
      const value = key[k];
      if (value === null || value === undefined) {
        return `${k}=null`;
      }
      if (typeof value === 'object') {
        return `${k}=${JSON.stringify(value)}`;
      }
      return `${k}=${value}`;
    });
    
    return parts.join('|');
  }

  /**
   * Generate SHA-256 hash (truncated to 16 chars for readability)
   */
  private hash(input: string): string {
    return crypto
      .createHash('sha256')
      .update(input)
      .digest('hex')
      .substring(0, 16);
  }
}

/**
 * Utility functions for generating specific entity IDs
 */
export class EntityIdUtils {
  private generator: EntityIdGenerator;

  constructor(generator: EntityIdGenerator = new DeterministicIdGenerator()) {
    this.generator = generator;
  }

  codeArtifactId(
    tenantId: TenantId,
    artifactType: string,
    repository: string,
    path: string,
    branch: string
  ): string {
    return this.generator.generateEntityId(tenantId, 'code_artifact', {
      artifactType,
      repository,
      path,
      branch,
    });
  }

  codeComponentId(
    tenantId: TenantId,
    name: string,
    repository: string,
    version?: string
  ): string {
    return this.generator.generateEntityId(tenantId, 'code_component', {
      name,
      repository,
      version: version || 'latest',
    });
  }

  dependencyId(
    tenantId: TenantId,
    name: string,
    version: string,
    packageManager: string
  ): string {
    return this.generator.generateEntityId(tenantId, 'dependency', {
      name,
      version,
      packageManager,
    });
  }

  commitId(tenantId: TenantId, repository: string, sha: string): string {
    return this.generator.generateEntityId(tenantId, 'commit', {
      repository,
      sha,
    });
  }

  semanticDocumentId(inputHash: string): string {
    // Semantic documents are globally unique by input hash
    return `semantic:${inputHash}`;
  }

  relationshipId(
    tenantId: TenantId,
    type: string,
    sourceId: string,
    targetId: string,
    _validFrom?: string
  ): string {
    return this.generator.generateRelationshipId(
      tenantId,
      type,
      sourceId,
      targetId,
    );
  }

  repositoryId(tenantId: TenantId, url: string): string {
    return this.generator.generateEntityId(tenantId, 'code_repository', { url });
  }

  serviceId(tenantId: TenantId, name: string, repository: string, codePath: string): string {
    return this.generator.generateEntityId(tenantId, 'code_service', {
      name,
      repository,
      codePath,
    });
  }

  moduleId(tenantId: TenantId, name: string, repository: string, codePath: string): string {
    return this.generator.generateEntityId(tenantId, 'code_module', {
      name,
      repository,
      codePath,
    });
  }

  buildArtifactId(tenantId: TenantId, name: string, repository: string, codePath: string): string {
    return this.generator.generateEntityId(tenantId, 'build_artifact', {
      name,
      repository,
      codePath,
    });
  }

  deploymentArtifactId(tenantId: TenantId, name: string, repository: string, codePath: string): string {
    return this.generator.generateEntityId(tenantId, 'deployment_artifact', {
      name,
      repository,
      codePath,
    });
  }

  /**
   * Generate a deterministic ID for a cloud resource.
   * Uses the cloud provider + raw resource ID (e.g. Azure ARM path) as the natural key
   * so the ID is stable across re-indexes but is a safe opaque hash, not a URL.
   */
  cloudResourceId(tenantId: TenantId, provider: string, resourceId: string): string {
    return this.generator.generateEntityId(tenantId, 'cloud_resource', {
      provider: provider.toLowerCase(),
      resourceId: resourceId.toLowerCase(),
    });
  }

  /**
   * Generate a deterministic ID for an Azure identity entity.
   * Uses principalId (AAD Object ID) as the natural key when available;
   * falls back to the ARM resource path so system-assigned identities
   * (which have no standalone ARM resource) still get stable IDs.
   */
  azureIdentityId(tenantId: TenantId, principalId: string): string {
    return this.generator.generateEntityId(tenantId, 'azure_identity', {
      principalId: principalId.toLowerCase(),
    });
  }

  /**
   * Generate a deterministic ID for an IAM role assignment entity.
   * Azure role assignment IDs are already GUIDs – we still hash them
   * for consistency and to keep the ID format uniform.
   */
  iamRoleAssignmentId(tenantId: TenantId, roleAssignmentId: string): string {
    return this.generator.generateEntityId(tenantId, 'iam_role_assignment', {
      roleAssignmentId: roleAssignmentId.toLowerCase(),
    });
  }

  evidenceId(): string {
    // Evidence uses UUID since it's append-only and not deduplicated
    return `evidence:${crypto.randomUUID()}`;
  }
}

/**
 * Input hash generator for semantic document caching
 */
export class InputHashGenerator {
  /**
   * Generate a hash of the inputs to semantic analysis
   * This allows us to cache LLM results
   */
  generateInputHash(
    filePath: string,
    content: string,
    language: string,
    context?: Record<string, any>
  ): string {
    const normalized = this.normalizeInput({
      filePath,
      content,
      language,
      context: context || {},
    });
    
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex');
  }

  private normalizeInput(input: Record<string, any>): Record<string, any> {
    // Sort keys and normalize whitespace in content
    const normalized: Record<string, any> = {};
    
    Object.keys(input).sort().forEach(key => {
      if (key === 'content' && typeof input[key] === 'string') {
        // Normalize whitespace in content
        normalized[key] = input[key].trim().replace(/\s+/g, ' ');
      } else {
        normalized[key] = input[key];
      }
    });
    
    return normalized;
  }
}
