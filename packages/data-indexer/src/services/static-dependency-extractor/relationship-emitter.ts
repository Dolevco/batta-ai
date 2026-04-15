/**
 * ExternalDep Relationship Emitter
 *
 * Converts the LLM-sourced ExternalDep[] from a service's ServiceExternalSurface
 * (Pass 2) into typed Neo4j relationships and, where necessary, infers the
 * CloudResource nodes those relationships point to.
 *
 * Relationship mapping:
 *   operations contains "read"      → READS_FROM
 *   operations contains "write"     → WRITES_TO
 *   operations contains "subscribe" → SUBSCRIBES_TO
 *   operations contains "publish"   → PUBLISHES_TO
 *   operations contains "search"    → READS_FROM
 *   operations contains "upsert"    → WRITES_TO
 *   operations contains "delete"    → WRITES_TO
 *   storage dep read                → READS_STORAGE
 *   storage dep write               → WRITES_STORAGE
 *
 * Skips:
 *   type === 'api'      — handled by ServiceCallCorrelator with endpoint-level precision.
 *   type === 'identity' — handled by the identity/IAM boundary, not the storage graph.
 *
 * Design:
 *   - Uses dep.resourceName as the Neo4j node name when available; falls back to dep.name.
 *   - If no existing CloudResource matches by name, a new synthetic node is inferred and
 *     returned in `inferredResources` so the caller can persist it before the edges.
 *   - All metadata is classified INTERNAL — no secret values.
 *
 * Security:
 *   - Metadata passed to makeRelationship() is sanitized by sanitizeMetadata() inside it.
 *   - CloudResource IDs are deterministic SHA-256 hashes of non-secret structural data.
 *   - Classification: INTERNAL — only resource names, dep names, and operation strings.
 */

import * as crypto from 'crypto';
import type {
  CloudResource,
  CodeService,
  ExternalDep,
  Relationship,
  RelationshipType,
  TenantId,
} from '@ai-agent/shared';
import { makeRelationship } from '../service-relationships-extractor/helpers/utils';

// ── Public interface ──────────────────────────────────────────────────────────

export interface EmitResult {
  relationships: Relationship[];
  /** Inferred CloudResource nodes that must be persisted before the edges. */
  inferredResources: CloudResource[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Map ExternalDep.type → CloudResource.resourceType for synthetic node creation.
 * Classification: INTERNAL — type labels only.
 */
const DEP_TYPE_TO_RESOURCE_TYPE: Partial<
  Record<ExternalDep['type'], CloudResource['resourceType']>
> = {
  database: 'database',
  cache:    'cache',
  queue:    'queue',
  storage:  'storage',
  cloud:    'other',
  other:    'other',
};

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Convert a service's ExternalDep[] (LLM-sourced, Pass 2) into typed graph edges.
 *
 * Runs after all services have completed Pass 2 so cross-service deduplication
 * of CloudResource names can be applied against the full allCloudResources list.
 *
 * @param tenantId         Tenant the service belongs to.
 * @param service          The source CodeService.
 * @param allCloudResources All known cloud resources (from cloud-discovery stage).
 *
 * Classification: INTERNAL — no secret values in any output.
 */
export function emitExternalDepRelationships(
  tenantId: TenantId,
  service: CodeService,
  allCloudResources: CloudResource[],
): EmitResult {
  const relationships: Relationship[] = [];
  const inferredResources: CloudResource[] = [];

  const surface = service.serviceExternalSurface;
  if (!surface?.externalDeps?.length) return { relationships, inferredResources };

  // Track inferred resources by name so we don't create duplicates within this call.
  const inferredByName = new Map<string, CloudResource>();

  for (const dep of surface.externalDeps) {
    // api and identity are handled elsewhere — skip.
    if (dep.type === 'api' || dep.type === 'identity') continue;

    const resourceType = DEP_TYPE_TO_RESOURCE_TYPE[dep.type] ?? 'other';

    // Use resourceName (concrete identifier) as the node name when available;
    // fall back to dep.name for human-readable fallback.
    const nodeName = dep.resourceName?.trim() || dep.name.trim();

    const cloudNode = findOrInferCloudResource(
      tenantId,
      nodeName,
      resourceType,
      dep.evidence ?? '',
      allCloudResources,
      inferredByName,
      inferredResources,
    );

    // Resolve which operations to emit.
    const ops = resolveOperations(dep);

    // Shared metadata carried on every edge from this dep.
    const meta = {
      depName: dep.name,
      resourceName: dep.resourceName,
      purpose: dep.purpose,
      evidence: dep.evidence,
      dataClassification: dep.dataClassification,  // INTERNAL classification tag
      extractedBy: 'ServiceSurfaceExtractor',
    };

    // Emit typed edges based on dep type + operations.
    if (dep.type === 'storage') {
      // Storage deps use READS_STORAGE / WRITES_STORAGE rather than the generic READS_FROM / WRITES_TO.
      if (ops.includes('read')) {
        relationships.push(makeRelationship(tenantId, 'READS_STORAGE', service.id, cloudNode.id, meta));
      }
      if (ops.includes('write') || ops.includes('upsert') || ops.includes('delete')) {
        relationships.push(makeRelationship(tenantId, 'WRITES_STORAGE', service.id, cloudNode.id, meta));
      }
    } else if (dep.type === 'queue') {
      // Queue deps use SUBSCRIBES_TO / PUBLISHES_TO.
      if (ops.includes('subscribe')) {
        relationships.push(makeRelationship(tenantId, 'SUBSCRIBES_TO', service.id, cloudNode.id, meta));
      }
      if (ops.includes('publish')) {
        relationships.push(makeRelationship(tenantId, 'PUBLISHES_TO', service.id, cloudNode.id, meta));
      }
      // If neither subscribe nor publish was set, fall back to the generic dataFlow mapping.
      if (!ops.includes('subscribe') && !ops.includes('publish')) {
        const fallbackOps = inferOperationsFromDataFlow(dep.dataFlow);
        if (fallbackOps.includes('read')) {
          relationships.push(makeRelationship(tenantId, 'SUBSCRIBES_TO', service.id, cloudNode.id, meta));
        }
        if (fallbackOps.includes('write')) {
          relationships.push(makeRelationship(tenantId, 'PUBLISHES_TO', service.id, cloudNode.id, meta));
        }
      }
    } else {
      // database, cache, cloud, other → READS_FROM / WRITES_TO.
      if (ops.includes('read') || ops.includes('search')) {
        relationships.push(makeRelationship(tenantId, 'READS_FROM', service.id, cloudNode.id, meta));
      }
      if (ops.includes('write') || ops.includes('upsert') || ops.includes('delete')) {
        relationships.push(makeRelationship(tenantId, 'WRITES_TO', service.id, cloudNode.id, meta));
      }
    }
  }

  return { relationships, inferredResources };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Resolve which operations to apply for a dep.
 * Prefers dep.operations[] when populated; falls back to inferring from dataFlow.
 */
function resolveOperations(dep: ExternalDep): string[] {
  if (dep.operations && dep.operations.length > 0) {
    return dep.operations;
  }
  return inferOperationsFromDataFlow(dep.dataFlow);
}

/**
 * Infer operations from the coarser dataFlow field when operations[] is absent.
 *   inbound      → ['read']   (service is a consumer of inbound data)
 *   outbound     → ['write']  (service produces / sends data)
 *   bidirectional → ['read', 'write']
 */
function inferOperationsFromDataFlow(dataFlow: ExternalDep['dataFlow']): string[] {
  if (dataFlow === 'inbound')  return ['read'];
  if (dataFlow === 'outbound') return ['write'];
  return ['read', 'write'];
}

/**
 * Find an existing CloudResource by name (case-insensitive substring match on `name`),
 * or create a synthetic one and register it for persistence.
 *
 * Lookup priority:
 *   1. Exact name match (case-insensitive) in allCloudResources.
 *   2. Partial name match (case-insensitive) in allCloudResources.
 *   3. Already-inferred resource with the same name in this call.
 *   4. Create a new synthetic CloudResource.
 *
 * Security: all inputs are structural metadata (INTERNAL). The generated entity ID
 * is a deterministic SHA-256 hash — no secret material is included.
 */
function findOrInferCloudResource(
  tenantId: TenantId,
  nodeName: string,
  resourceType: CloudResource['resourceType'],
  evidence: string,
  allCloudResources: CloudResource[],
  inferredByName: Map<string, CloudResource>,
  inferredResources: CloudResource[],
): CloudResource {
  const nameLower = nodeName.toLowerCase();

  // 1. Exact match in known cloud resources.
  const exact = allCloudResources.find(r => r.name.toLowerCase() === nameLower);
  if (exact) return exact;

  // 2. Partial match in known cloud resources.
  const partial = allCloudResources.find(
    r => r.name.toLowerCase().includes(nameLower) || nameLower.includes(r.name.toLowerCase()),
  );
  if (partial) return partial;

  // 3. Already inferred in this call.
  if (inferredByName.has(nameLower)) return inferredByName.get(nameLower)!;

  // 4. Infer a new synthetic node.
  // ID is deterministic so repeated indexing produces the same Neo4j node.
  const idInput = `${tenantId}:cloud_resource:${nodeName}:${resourceType}`;
  const id = `cloud_resource:${crypto.createHash('sha256').update(idInput).digest('hex')}`;
  const now = new Date().toISOString();

  const inferred: CloudResource = {
    id,
    tenantId,
    entityType: 'cloud_resource',
    resourceType,
    cloudProvider: 'other',
    name: nodeName,
    responsibility: evidence || undefined,
    confidence: 'heuristic',
    metadata: {
      inferredFrom: 'ServiceSurfaceExtractor',
      // Classification: INTERNAL — only key names / resource names.
      dataClassification: 'internal',
    },
    createdAt: now,
    updatedAt: now,
  };

  inferredByName.set(nameLower, inferred);
  inferredResources.push(inferred);
  return inferred;
}

// ── Re-export RelationshipType helper for correlators ─────────────────────────

/** All relationship types emitted by this module (for VALID_RELATIONSHIP_TYPES registration). */
export const EXTERNAL_DEP_RELATIONSHIP_TYPES: RelationshipType[] = [
  'READS_FROM',
  'WRITES_TO',
  'SUBSCRIBES_TO',
  'PUBLISHES_TO',
  'READS_STORAGE',
  'WRITES_STORAGE',
];
