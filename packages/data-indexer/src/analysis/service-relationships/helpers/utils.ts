import type {
  Relationship,
  RelationshipType,
  TenantId,
  EntityId,
  DeploymentArtifact,
  CloudResource,
  IaCResourceRef,
} from '@batta/shared';
import * as crypto from 'crypto';
import { sanitizeMetadata } from '../../../utils/secret-sanitizer';

/**
 * Build a Relationship object.
 *
 * The relationship ID is a deterministic SHA-256 hash of
 * `tenantId:type:sourceId:targetId`.  This guarantees that re-indexing the
 * same relationship never creates a duplicate graph store edge (idempotent upsert).
 *
 * Security:
 * - No secret material is included in the hash input.
 * - metadata is sanitized with sanitizeMetadata to strip any accidentally
 *   included secrets before the relationship is used or stored.
 */
export function makeRelationship(
  tenantId: TenantId,
  type: RelationshipType,
  sourceId: EntityId,
  targetId: EntityId,
  metadata: Record<string, unknown>,
): Relationship {
  const sanitized = sanitizeMetadata(metadata);
  // Deterministic ID: same edge always maps to the same graph store record
  const idInput = `${tenantId}:${type}:${sourceId}:${targetId}`;
  const id = crypto.createHash('sha256').update(idInput).digest('hex');
  return {
    id,
    tenantId,
    type,
    sourceId,
    targetId,
    validFrom: new Date().toISOString(),
    confidence: 'heuristic',
    metadata: sanitized,
  };
}

/**
 * Merge IaCAnalysis data from multiple artifacts (de-duplicated by resource name).
 */
export function aggregateIaCAnalysisForService(artifacts: DeploymentArtifact[]): {
  deployedResources: IaCResourceRef[];
  usedResources: IaCResourceRef[];
  namingConventions: string[];
} {
  const deployedByName = new Map<string, IaCResourceRef>();
  const usedByName = new Map<string, IaCResourceRef>();
  const conventions = new Set<string>();

  for (const a of artifacts) {
    if (!a.iacAnalysis) continue;
    a.iacAnalysis.deployedResources.forEach(r => {
      if (!deployedByName.has(r.name)) deployedByName.set(r.name, r);
    });
    a.iacAnalysis.usedResources.forEach(r => {
      if (!usedByName.has(r.name)) usedByName.set(r.name, r);
    });
    a.iacAnalysis.namingConventions.forEach(nc => conventions.add(nc));
  }

  return {
    deployedResources: [...deployedByName.values()],
    usedResources: [...usedByName.values()],
    namingConventions: [...conventions],
  };
}

/**
 * Build textual matching hints — pairs each IaC resource ref with
 * candidate cloud resource entities that share the same type or a name substring.
 */
export function buildCloudResourceHints(
  deployedRefs: IaCResourceRef[],
  usedRefs: IaCResourceRef[],
  cloudResources: CloudResource[],
): string {
  const lines: string[] = [];

  const addHints = (refs: IaCResourceRef[], label: string) => {
    refs.forEach(ref => {
      const refNameLower = ref.name.toLowerCase();
      const candidates = cloudResources.filter(cr => {
        const crNameLower = cr.name.toLowerCase();
        return (
          cr.resourceType === ref.resourceType ||
          crNameLower.includes(refNameLower.split('-')[0]) ||
          refNameLower.includes(crNameLower.split('-')[0])
        );
      });
      if (candidates.length > 0) {
        lines.push(
          `  [${label}] "${ref.name}" (${ref.resourceType}) → candidates: ` +
          candidates.map(c => `"${c.name}" (${c.id})`).join(', '),
        );
      } else {
        lines.push(
          `  [${label}] "${ref.name}" (${ref.resourceType}) → no obvious candidate by name; match by type`,
        );
      }
    });
  };

  addHints(deployedRefs, 'CREATES');
  addHints(usedRefs, 'REFERENCES');

  return lines.join('\n');
}
