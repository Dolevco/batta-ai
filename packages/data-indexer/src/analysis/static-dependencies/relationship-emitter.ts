/**
 * ExternalDep Relationship Emitter
 *
 * Converts the LLM-sourced ExternalDep[] from a service's ServiceExternalSurface
 * (Pass 2) into typed graph relationships — but only when the dep resolves to a
 * real cloud resource already known from cloud discovery.
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
 *   unmatched deps      — deps with no matching real cloud resource are stored on the
 *                         service's externalDeps array for correlation, but are NOT
 *                         emitted as graph nodes or edges.
 *
 * Design:
 *   - Uses dep.resourceName as the graph node name when available; falls back to dep.name.
 *   - If no existing CloudResource matches by name, the dep is skipped for graph emission.
 *     The data remains on service.externalDeps for LLM correlation and threat-modelling.
 *   - All metadata is classified INTERNAL — no secret values.
 *
 * Security:
 *   - Metadata passed to makeRelationship() is sanitized by sanitizeMetadata() inside it.
 *   - No synthetic CloudResource nodes are created; only real discovered resources are referenced.
 *   - Classification: INTERNAL — only resource names, dep names, and operation strings.
 */

import type {
  CloudResource,
  CodeService,
  ExternalDep,
  Relationship,
  TenantId,
} from '@batta/shared';
import { makeRelationship } from '../service-relationships/helpers/utils';

// ── Public interface ──────────────────────────────────────────────────────────

export interface EmitResult {
  relationships: Relationship[];
  /** Always empty — synthetic CloudResource nodes are no longer created for unmatched deps. */
  inferredResources: CloudResource[];
}

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
  const inferredResources: CloudResource[] = []; // always empty — kept for interface compat

  const surface = service.serviceExternalSurface;
  if (!surface?.externalDeps?.length) return { relationships, inferredResources };

  const LOCALHOST_PATTERN = /\blocalhost\b|127\.0\.0\.1|::1/i;

  for (const dep of surface.externalDeps) {
    // api and identity are handled elsewhere — skip.
    if (dep.type === 'api' || dep.type === 'identity') continue;

    // Skip deps whose evidence resolves to localhost — they are local-only and
    // cannot correspond to any discovered cloud resource.
    if (dep.evidence && LOCALHOST_PATTERN.test(dep.evidence)) {
      console.log(
        `   [StaticDepEmitter] ${service.name}: dep "${dep.name}" skipped — localhost evidence`,
      );
      continue;
    }

    // Use resourceName (concrete identifier) as the node name when available;
    // fall back to dep.name for human-readable fallback.
    const nodeName = dep.resourceName?.trim() || dep.name.trim();

    // Only emit a graph edge when the dep resolves to a real, discovered cloud resource.
    // If no match is found, the dep data remains on service.externalDeps for LLM
    // correlation and threat-modelling — but nothing is written to the graph.
    const cloudNode = findCloudResource(nodeName, allCloudResources);
    if (!cloudNode) {
      console.log(
        `   [StaticDepEmitter] ${service.name}: dep "${dep.name}" (${dep.type}) — ` +
        `no real cloud match, stored on service only`,
      );
      continue;
    }

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
 * Find an existing CloudResource by name (case-insensitive match on `name`).
 * Returns null when the dep cannot be correlated to a real discovered resource.
 *
 * Lookup priority:
 *   1. Exact name match (case-insensitive) in allCloudResources.
 *   2. Partial name match (case-insensitive) in allCloudResources.
 *
 * Synthetic node creation has been intentionally removed: unmatched deps are
 * stored on service.externalDeps only and are never written to the graph.
 * Classification: INTERNAL — only structural resource names are compared.
 */
function findCloudResource(
  nodeName: string,
  allCloudResources: CloudResource[],
): CloudResource | null {
  const nameLower = nodeName.toLowerCase();

  // 1. Exact match (case-insensitive).
  const exact = allCloudResources.find(r => r.name.toLowerCase() === nameLower);
  if (exact) return exact;

  // 2. Partial match — only allowed when the search term is specific enough
  // (≥ 6 chars) to avoid short generic names (e.g. "app", "redis") matching
  // unrelated resources that happen to contain the substring.
  if (nameLower.length >= 6) {
    const partial = allCloudResources.find(
      r => r.name.toLowerCase().includes(nameLower) || nameLower.includes(r.name.toLowerCase()),
    );
    if (partial) return partial;
  }

  return null;
}
