/**
 * Step 6 (renumbered from Step 5) – Service → Cloud Resource (DEPLOYED_TO / USES)
 *
 * Uses resource-group affinity from Step 4 (IaC→Cloud) to scope candidate
 * cloud resources for each service before passing them to the LLM.
 *
 * Two paths:
 *   Primary   — service has IaC (from Step 5); use the resource-group affinity
 *               map built during Step 4 to restrict candidates to the correct RG.
 *   Fallback  — service has NO IaC; query by externalDep resource types so at
 *               least something useful is in scope. These services were previously
 *               silently skipped.
 *
 * Security:
 *   - allEntities passed to the correlation agent is bounded (scoped candidates only).
 *   - Relationship metadata is sanitized by makeRelationship() before storage.
 */
import type {
  CloudResource,
  CodeService,
  DeploymentArtifact,
  EntityId,
  ExternalDep,
  Relationship,
  RelationshipType,
  TenantId,
} from '@batta/shared';
import { VALID_RELATIONSHIP_TYPES } from '../types';
import { makeRelationship, aggregateIaCAnalysisForService } from '../helpers/utils';
import { PersistenceHelper } from '../helpers/persistence';
import type { DataIndexerAgentRegistry } from '../../../agents/registry';
import { createCorrelationAgentDefinition, ENTITY_CORRELATION_INSTRUCTIONS } from '../../../agents/definitions/correlationAgent';
import type { CorrelationResult } from '../../../agents/tools/correlationTaskCompletionTool';
import type { CloudResourceRepository } from '../../../cloud/repository/cloud-resource-repository';
import type { ServiceResourceGroupAffinity } from './iac-to-cloud';
import type { DeploymentScope } from '../helpers/scope-resolver';
import { resolveResourceCandidates } from '../helpers/scope-resolver';

/** Maximum number of candidates passed to the LLM per service. */
const MAX_CANDIDATES_PER_SERVICE = 40;

function mapExternalDepToResourceType(
  depType: ExternalDep['type'],
): CloudResource['resourceType'] | undefined {
  switch (depType) {
    case 'database': return 'database';
    case 'cache':    return 'cache';
    case 'queue':    return 'queue';
    case 'storage':  return 'storage';
    case 'identity': return 'identity';
    default:         return undefined;
  }
}

function deduplicateById(resources: CloudResource[]): CloudResource[] {
  const seen = new Set<string>();
  return resources.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

/**
 * Step 6 – Service → Cloud Resource (DEPLOYED_TO / USES) — scoped
 */
export async function correlateServicesToCloudResources(
  registry: DataIndexerAgentRegistry,
  persistence: PersistenceHelper,
  tenantId: TenantId,
  repositoryPath: string,
  services: CodeService[],
  cloudRepository: CloudResourceRepository,
  priorRelationships: Relationship[],
  deploymentArtifacts: DeploymentArtifact[],
  serviceRGAffinity?: ServiceResourceGroupAffinity,
  deploymentScopes?: Map<string, DeploymentScope>,
): Promise<Relationship[]> {
  const allRelationships: Relationship[] = [];

  const artifactById = new Map<EntityId, DeploymentArtifact>(
    deploymentArtifacts.map(a => [a.id, a]),
  );

  const cloudToIaCRels = new Map<EntityId, Relationship[]>();
  priorRelationships.forEach((r) => {
    const isCloudTarget = cloudRepository.getById(r.targetId) !== undefined;
    const isCloudSource = cloudRepository.getById(r.sourceId) !== undefined;
    if (isCloudTarget || isCloudSource) {
      const cloudId = isCloudTarget ? r.targetId : r.sourceId;
      if (!cloudToIaCRels.has(cloudId)) cloudToIaCRels.set(cloudId, []);
      cloudToIaCRels.get(cloudId)!.push(r);
    }
  });

  for (const service of services) {
    console.log(`   [SRE]   🔍 Service→Cloud: ${service.name}`);

    const iacForService = priorRelationships.filter(
      (r) => r.type === 'DEPLOYS' && r.targetId === service.id && artifactById.has(r.sourceId),
    );

    let candidates: CloudResource[];
    let selectionMethod: string;

    if (iacForService.length > 0) {
      const rgSet = serviceRGAffinity?.get(service.id);

      if (rgSet && rgSet.size > 0) {
        candidates = cloudRepository.query(
          { resourceGroups: [...rgSet] },
          MAX_CANDIDATES_PER_SERVICE,
        );
        selectionMethod = `RG affinity [${[...rgSet].join(', ')}]`;
      } else {
        const artifactScopes = iacForService
          .map(r => deploymentScopes?.get(r.sourceId))
          .filter((s): s is DeploymentScope => s !== undefined);

        if (artifactScopes.length > 0) {
          candidates = resolveResourceCandidates(artifactScopes, cloudRepository, MAX_CANDIDATES_PER_SERVICE);
          selectionMethod = `artifact scope (${artifactScopes.map(s => s.resolutionMethod).join(', ')})`;
        } else {
          candidates = cloudRepository.query({}, MAX_CANDIDATES_PER_SERVICE);
          selectionMethod = `unscoped fallback — ${candidates.length}/${cloudRepository.totalCount}`;
        }
      }
    } else {
      const LOCALHOST_PATTERN = /\blocalhost\b|127\.0\.0\.1|::1/i;
      const cloudResolvableDeps = (service.externalDeps ?? []).filter(
        d => !d.evidence || !LOCALHOST_PATTERN.test(d.evidence),
      );

      const depTypes = cloudResolvableDeps
        .map(d => mapExternalDepToResourceType(d.type))
        .filter((t): t is CloudResource['resourceType'] => t !== undefined);

      if (depTypes.length === 0) {
        const skippedCount = (service.externalDeps ?? []).length - cloudResolvableDeps.length;
        const reason = skippedCount > 0
          ? `no IaC and all externalDeps resolve to localhost — skipping cloud correlation`
          : `no IaC and no typed externalDeps — skipping`;
        console.log(`   [SRE]     ℹ️  ${service.name}: ${reason}`);
        continue;
      }

      const byType = depTypes.flatMap(t => cloudRepository.query({ resourceType: t }, 20));
      candidates = deduplicateById(byType).slice(0, MAX_CANDIDATES_PER_SERVICE);
      selectionMethod = `externalDep types [${[...new Set(depTypes)].join(', ')}]`;
    }

    if (candidates.length === 0) {
      console.log(`   [SRE]     ℹ️  ${service.name}: no candidate cloud resources — skipping`);
      continue;
    }

    console.log(
      `   [SRE]     📍 ${service.name}: ${candidates.length} candidate(s) via ${selectionMethod}`,
    );

    const dependentServiceIds = priorRelationships
      .filter((r) => r.type === 'DEPENDS_ON' && r.sourceId === service.id)
      .map((r) => r.targetId);
    const relevantServices = [service, ...services.filter((s) => dependentServiceIds.includes(s.id))];
    const allExternalDeps: ExternalDep[] = relevantServices.flatMap((s) => s.externalDeps ?? []);

    const relevantArtifacts = iacForService
      .map(r => artifactById.get(r.sourceId)!)
      .filter(Boolean);
    const aggregatedIaC = aggregateIaCAnalysisForService(relevantArtifacts);

    const allEntities = [...services, ...candidates];
    const validEntityIds = new Set(allEntities.map(e => e.id));
    const entityIdToName = new Map(allEntities.map(e => [e.id, e.name]));

    const mainEntityContext = (() => {
      const lines = [
        `SERVICE: ${service.name}`,
        `ID: ${service.id}`,
        `Path: ${service.codePath}`,
        `Tech Stack: ${service.techStack?.join(', ') || 'N/A'}`,
        ...(service.responsibility ? [`Responsibility: ${service.responsibility}`] : []),
      ];

      if (allExternalDeps.length > 0) {
        lines.push('', 'EXTERNAL DEPS (from Step 1 analysis):');
        allExternalDeps.forEach(d => {
          lines.push(`  - ${d.name} (${d.type}, ${d.dataFlow})`);
          lines.push(`    Purpose: ${d.purpose}`);
          if (d.evidence) lines.push(`    Evidence: ${d.evidence}`);
        });
      }

      if (iacForService.length > 0) {
        lines.push('', 'IaC FILES DEPLOYING THIS SERVICE:');
        iacForService.forEach(r => {
          const a = artifactById.get(r.sourceId);
          if (a) lines.push(`  - ${a.name}: ${a.codePath}`);
        });
      }

      const allIaCResources = [...aggregatedIaC.deployedResources, ...aggregatedIaC.usedResources];
      if (allIaCResources.length > 0) {
        lines.push('', 'CLOUD RESOURCES IN THE SAME IaC (strong correlation candidates):');
        allIaCResources.forEach(r => {
          lines.push(
            `  - ${r.name} (${r.resourceType}${r.cloudProvider ? `, ${r.cloudProvider}` : ''})` +
            (r.namingPattern ? ` pattern: "${r.namingPattern}"` : '') +
            (r.evidence ? ` — ${r.evidence}` : ''),
          );
        });
      }

      if (aggregatedIaC.namingConventions.length > 0) {
        lines.push('', 'NAMING CONVENTIONS (use to resolve fuzzy name matches):');
        aggregatedIaC.namingConventions.forEach(nc => lines.push(`  - ${nc}`));
      }

      return lines.join('\n');
    })();

    const targetEntitiesContext = (() => {
      if (!candidates.length) return 'No cloud resources available.';
      const lines = [`CLOUD RESOURCES (${candidates.length} in scope — scoped to this service's deployment environment):`];
      candidates.forEach(r => {
        lines.push(
          `  - ID: ${r.id}\n    Name: ${r.name}\n    Type: ${r.resourceType} (${r.cloudProvider})` +
          (r.resourceGroup ? `\n    ResourceGroup: ${r.resourceGroup}` : '') +
          (r.responsibility ? `\n    Responsibility: ${r.responsibility}` : ''),
        );
        const iacRels = cloudToIaCRels.get(r.id);
        if (iacRels?.length) {
          lines.push(`    IaC relationships (from Steps 4/5):`);
          iacRels.forEach(rel => {
            const a = artifactById.get(rel.sourceId);
            lines.push(`      * ${rel.type} from ${a?.name ?? rel.sourceId}`);
            if (rel.metadata?.reason) lines.push(`        Reason: ${rel.metadata.reason}`);
            if (rel.metadata?.evidence) lines.push(`        Evidence: ${rel.metadata.evidence}`);
          });
        }
        lines.push('');
      });
      return lines.join('\n');
    })();

    const iacPaths = iacForService
      .map(r => artifactById.get(r.sourceId)?.codePath)
      .filter(Boolean);

    const iacResourceNames = [
      ...aggregatedIaC.deployedResources,
      ...aggregatedIaC.usedResources,
    ].map(r => `"${r.name}" (${r.resourceType})`).join(', ');

    const customInstructions = `${ENTITY_CORRELATION_INSTRUCTIONS}

Determine the cloud resource relationships for service "${service.name}" (ID: ${service.id}).

STEP 1 — Use IaC evidence (highest confidence — prefer this):
  The IaC file(s) deploying this service reference these resources:
  ${iacResourceNames || '(none found in Step 0 analysis)'}
  For each, look for the cloud resource name (or a clear substring) in AVAILABLE CLOUD RESOURCES.
  Only create a relationship if the name from the IaC matches a specific cloud resource entity — not just the same type.

STEP 2 — Use external-deps evidence (complementary):
  For each externalDep that has concrete evidence (a file + key/value referencing a specific resource name),
  look for that exact name in AVAILABLE CLOUD RESOURCES.
  Do NOT match by type alone or purpose similarity — the name must appear in the evidence.

STEP 3 — Only if needed, read IaC files for additional detail:
${iacPaths.length ? iacPaths.map(p => `  - ${p}`).join('\n') : '  (none)'}

RELATIONSHIP TYPES:
  - DEPLOYED_TO → service IS deployed ON the resource (Container App, App Service, ECS task, etc.)
  - USES        → service accesses the resource at runtime (DB, queue, cache, storage, identity provider)

RELATIONSHIP FORMAT:
{
  "type": "DEPLOYED_TO" | "USES",
  "sourceId": "${service.id}",
  "targetId": "<exact cloud resource entity ID>",
  "reason": "…",
  "evidence": "IaC resource name, config key, or externalDep evidence (NO secret values)"
}

EVIDENCE RULES — a relationship requires at least one of:
  A. The cloud resource name (or a substring of it) appears verbatim in an IaC file, config file, env var, or source file in the repository.
  B. An externalDep has an evidence field that quotes a specific file + key/value that matches the cloud resource name.

DO NOT correlate based solely on type similarity, naming patterns, or inferred convention.
You MUST find the actual resource name (or a clear identifier) somewhere in the repository files.
If the evidence shows "localhost", "127.0.0.1", or any loopback address, the dependency is local-only — NEVER map it to a cloud resource regardless of type similarity.
If you cannot find such evidence, SKIP the relationship entirely.

CANDIDATE RESOURCES are pre-filtered to this service's deployment environment — all IDs shown here are valid targets.`;

    const context = [
      '=== MAIN ENTITY TO ANALYZE ===',
      mainEntityContext,
      '',
      '=== AVAILABLE TARGET ENTITIES ===',
      targetEntitiesContext,
      '',
      'TASK: Correlate this service to cloud resources using IaC Step 0 analysis and externalDeps evidence.',
      '',
      'IMPORTANT:',
      `- Every relationship MUST have "${service.id}" as sourceId or targetId`,
      '- Use the exact entity IDs listed above (not names)',
      '- Only create relationships if you find concrete evidence',
    ].join('\n');

    const def = createCorrelationAgentDefinition(
      { mainEntityId: service.id, mainEntityName: service.name, mainEntityType: 'Service', validEntityIds, entityIdToName, validRelationshipTypes: VALID_RELATIONSHIP_TYPES },
      customInstructions,
    );
    const task = registry.withDefinition(def).createTask('entity-correlator', { workspace: repositoryPath });
    const result = await task.execute<CorrelationResult>(context);

    const relationships = (result.requiredOutput as CorrelationResult | undefined)?.relationships ?? [];
    if (relationships.length > 0) {
      console.log(`   [SRE]     ✅ ${service.name}: ${relationships.length} relationship(s)`);
      const rels = relationships.map(r =>
        makeRelationship(tenantId, r.type as RelationshipType, r.sourceId, r.targetId, {
          reason: r.reason,
          evidence: r.evidence,
        }),
      );
      allRelationships.push(...rels);
      await persistence.persistRelationships(rels);
    } else {
      console.log(`   [SRE]     ℹ️  ${service.name}: no cloud resource relationships found`);
    }
  }

  return allRelationships;
}
