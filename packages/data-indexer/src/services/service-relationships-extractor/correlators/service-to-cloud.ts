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
 * Core change vs old implementation:
 *   - Accepts CloudResourceRepository + ServiceResourceGroupAffinity instead of
 *     a flat CloudResource[] — the LLM receives 5–30 bounded candidates, not 800.
 *   - deploymentScopes map is used when affinity is empty (secondary fallback).
 *   - Services with no IaC AND no externalDeps are still skipped.
 *
 * Security:
 *   - allEntities passed to CorrelationTask is bounded (scoped candidates only).
 *   - Relationship metadata is sanitized by makeRelationship() before storage.
 */
import { CorrelationTask } from '@ai-agent/core';
import type { CorrelationConfig } from '@ai-agent/core';
import type { ILLMApiHandler } from '@ai-agent/core';
import type {
  CloudResource,
  CodeService,
  DeploymentArtifact,
  EntityId,
  ExternalDep,
  Relationship,
  RelationshipType,
  TenantId,
} from '@ai-agent/shared';
import { VALID_RELATIONSHIP_TYPES } from '../types';
import { makeRelationship, aggregateIaCAnalysisForService } from '../helpers/utils';
import { PersistenceHelper } from '../helpers/persistence';
import type { CloudResourceRepository } from '../../cloud-resource-repository';
import type { ServiceResourceGroupAffinity } from './iac-to-cloud';
import type { DeploymentScope } from '../helpers/scope-resolver';
import { resolveResourceCandidates } from '../helpers/scope-resolver';

// ── Internal helpers ─────────────────────────────────────────────────────────

/** Maximum number of candidates passed to the LLM per service. */
const MAX_CANDIDATES_PER_SERVICE = 40;

/**
 * Map ExternalDep type → CloudResource.resourceType for fallback candidate selection.
 */
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

/** De-duplicate an array of CloudResource objects by ID. */
function deduplicateById(resources: CloudResource[]): CloudResource[] {
  const seen = new Set<string>();
  return resources.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

// ── Correlator ───────────────────────────────────────────────────────────────

/**
 * Step 6 – Service → Cloud Resource (DEPLOYED_TO / USES) — scoped
 */
export async function correlateServicesToCloudResources(
  api: ILLMApiHandler,
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

  // Build: cloudResourceId → IaC relationships that touch it (from Steps 4/5)
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

    // Gather IaC artifacts that deploy THIS service (from Step 5)
    const iacForService = priorRelationships.filter(
      (r) => r.type === 'DEPLOYS' && r.targetId === service.id && artifactById.has(r.sourceId),
    );

    // ── Candidate selection ─────────────────────────────────────────────
    let candidates: CloudResource[];
    let selectionMethod: string;

    if (iacForService.length > 0) {
      // Primary path: service has IaC — use resource-group affinity from Step 4
      const rgSet = serviceRGAffinity?.get(service.id);

      if (rgSet && rgSet.size > 0) {
        candidates = cloudRepository.query(
          { resourceGroups: [...rgSet] },
          MAX_CANDIDATES_PER_SERVICE,
        );
        selectionMethod = `RG affinity [${[...rgSet].join(', ')}]`;
      } else {
        // Secondary fallback: derive scope from the IaC artifact scope map
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
      // Fallback path: service has NO IaC — query by externalDep resource types
      const depTypes = (service.externalDeps ?? [])
        .map(d => mapExternalDepToResourceType(d.type))
        .filter((t): t is CloudResource['resourceType'] => t !== undefined);

      if (depTypes.length === 0) {
        console.log(`   [SRE]     ℹ️  ${service.name}: no IaC and no typed externalDeps — skipping`);
        continue;
      }

      const byType = depTypes.flatMap(t =>
        cloudRepository.query({ resourceType: t }, 20),
      );
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

    // Collect externalDeps from this service and all services it DEPENDS_ON
    const dependentServiceIds = priorRelationships
      .filter((r) => r.type === 'DEPENDS_ON' && r.sourceId === service.id)
      .map((r) => r.targetId);
    const relevantServices = [service, ...services.filter((s) => dependentServiceIds.includes(s.id))];
    const allExternalDeps: ExternalDep[] = relevantServices.flatMap((s) => s.externalDeps ?? []);

    const relevantArtifacts = iacForService
      .map(r => artifactById.get(r.sourceId)!)
      .filter(Boolean);
    const aggregatedIaC = aggregateIaCAnalysisForService(relevantArtifacts);

    const config: CorrelationConfig<CodeService | CloudResource> = {
      mainEntity: service,
      mainEntityType: 'Service',
      allEntities: [...services, ...candidates],
      repositoryPath,
      validRelationshipTypes: VALID_RELATIONSHIP_TYPES,
      getEntityId: (e) => e.id,
      getEntityName: (e) => e.name,
      buildMainEntityContext: (e) => {
        const svc = e as CodeService;
        const lines = [
          `SERVICE: ${svc.name}`,
          `ID: ${svc.id}`,
          `Path: ${svc.codePath}`,
          `Tech Stack: ${svc.techStack?.join(', ') || 'N/A'}`,
          ...(svc.responsibility ? [`Responsibility: ${svc.responsibility}`] : []),
        ];

        if (allExternalDeps.length > 0) {
          lines.push('', 'EXTERNAL DEPS (from Step 1 analysis):');
          allExternalDeps.forEach((d) => {
            lines.push(`  - ${d.name} (${d.type}, ${d.dataFlow})`);
            lines.push(`    Purpose: ${d.purpose}`);
            if (d.evidence) lines.push(`    Evidence: ${d.evidence}`);
          });
        }

        if (iacForService.length > 0) {
          lines.push('', 'IaC FILES DEPLOYING THIS SERVICE:');
          iacForService.forEach((r) => {
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
      },
      buildTargetEntitiesContext: (entities) => {
        const resources = entities.filter((e) => 'cloudProvider' in e) as CloudResource[];
        if (!resources.length) return 'No cloud resources available.';
        const lines = [`CLOUD RESOURCES (${resources.length} in scope — scoped to this service's deployment environment):`];
        resources.forEach((r) => {
          lines.push(
            `  - ID: ${r.id}\n    Name: ${r.name}\n    Type: ${r.resourceType} (${r.cloudProvider})` +
            (r.resourceGroup ? `\n    ResourceGroup: ${r.resourceGroup}` : '') +
            (r.responsibility ? `\n    Responsibility: ${r.responsibility}` : ''),
          );
          const iacRels = cloudToIaCRels.get(r.id);
          if (iacRels?.length) {
            lines.push(`    IaC relationships (from Steps 4/5):`);
            iacRels.forEach((rel) => {
              const a = artifactById.get(rel.sourceId);
              lines.push(`      * ${rel.type} from ${a?.name ?? rel.sourceId}`);
              if (rel.metadata?.reason) lines.push(`        Reason: ${rel.metadata.reason}`);
              if (rel.metadata?.evidence) lines.push(`        Evidence: ${rel.metadata.evidence}`);
            });
          }
          lines.push('');
        });
        return lines.join('\n');
      },
      buildAnalysisPrompt: (e) => {
        const svc = e as CodeService;
        const iacPaths = iacForService
          .map((r) => artifactById.get(r.sourceId)?.codePath)
          .filter(Boolean);

        const iacResourceNames = [
          ...aggregatedIaC.deployedResources,
          ...aggregatedIaC.usedResources,
        ].map(r => `"${r.name}" (${r.resourceType})`).join(', ');

        return `Determine the cloud resource relationships for service "${svc.name}" (ID: ${svc.id}).

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
${iacPaths.length ? iacPaths.map((p) => `  - ${p}`).join('\n') : '  (none)'}

RELATIONSHIP TYPES:
  - DEPLOYED_TO → service IS deployed ON the resource (Container App, App Service, ECS task, etc.)
  - USES        → service accesses the resource at runtime (DB, queue, cache, storage, identity provider)

RELATIONSHIP FORMAT:
{
  "type": "DEPLOYED_TO" | "USES",
  "sourceId": "${svc.id}",
  "targetId": "<exact cloud resource entity ID>",
  "reason": "…",
  "evidence": "IaC resource name, config key, or externalDep evidence (NO secret values)"
}

EVIDENCE RULES — a relationship requires at least one of:
  A. The cloud resource name (or a substring of it) appears verbatim in an IaC file, config file, env var, or source file in the repository.
  B. An externalDep has an evidence field that quotes a specific file + key/value that matches the cloud resource name.

DO NOT correlate based solely on type similarity, naming patterns, or inferred convention.
You MUST find the actual resource name (or a clear identifier) somewhere in the repository files.
If you cannot find such evidence, SKIP the relationship entirely.

CANDIDATE RESOURCES are pre-filtered to this service's deployment environment — all IDs shown here are valid targets.`;
      },
      taskInstructions:
        'Correlate this service to cloud resources using IaC Step 0 analysis and externalDeps evidence.',
    };

    const task = new CorrelationTask(api, config);
    const result = await task.execute();

    if (result.relationships.length > 0) {
      console.log(`   [SRE]     ✅ ${service.name}: ${result.relationships.length} relationship(s)`);
      const rels = result.relationships.map((r) =>
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
