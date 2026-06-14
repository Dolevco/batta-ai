/**
 * Step 3 (renumbered from Step 4) – IaC → Cloud Resource (DEPLOYS / USES)
 *
 * Uses IaCAnalysis + scope resolution to correlate deployment artifacts to
 * cloud resource entities.
 *
 * Core change vs old implementation:
 *   - Accepts CloudResourceRepository + DeploymentScope map instead of flat array
 *   - Each artifact only sees the 5–30 resources in its resolved scope
 *   - As a side effect, builds the ServiceResourceGroupAffinity map used by Step 5
 *
 * Security:
 *   - allEntities passed to the correlation agent is bounded (scoped candidates only)
 *   - Relationship metadata is sanitized by makeRelationship() before storage
 */
import type {
  CloudResource,
  DeploymentArtifact,
  Relationship,
  RelationshipType,
  TenantId,
} from '@batta/shared';
import { VALID_RELATIONSHIP_TYPES } from '../types';
import { makeRelationship, buildCloudResourceHints } from '../helpers/utils';
import { PersistenceHelper } from '../helpers/persistence';
import type { DataIndexerAgentRegistry } from '../../../agents/registry';
import { createCorrelationAgentDefinition, ENTITY_CORRELATION_INSTRUCTIONS } from '../../../agents/definitions/correlationAgent';
import type { CorrelationResult } from '../../../agents/tools/correlationTaskCompletionTool';
import type { CloudResourceRepository } from '../../../cloud/repository/cloud-resource-repository';
import type { DeploymentScope } from '../helpers/scope-resolver';
import { resolveResourceCandidates } from '../helpers/scope-resolver';

/** artifactId → Set of resource group names confirmed by Step 3 DEPLOYS relationships */
export type ArtifactResourceGroupAffinity = Map<string, Set<string>>;
/** serviceId → Set of resource group names (derived after Step 5 provides artifact→service mapping) */
export type ServiceResourceGroupAffinity = Map<string, Set<string>>;

/**
 * Step 3 – IaC → Cloud Resource (DEPLOYS / USES) — scoped
 *
 * @returns relationships and the artifact-level affinity map (orchestrator converts to service-level)
 */
export async function correlateIaCToCloudResources(
  registry: DataIndexerAgentRegistry,
  persistence: PersistenceHelper,
  tenantId: TenantId,
  repositoryPath: string,
  deploymentArtifacts: DeploymentArtifact[],
  cloudRepository: CloudResourceRepository,
  deploymentScopes?: Map<string, DeploymentScope>,
): Promise<{ relationships: Relationship[]; affinityByArtifact: ArtifactResourceGroupAffinity }> {
  const allRelationships: Relationship[] = [];
  const affinityByArtifact: ArtifactResourceGroupAffinity = new Map();

  for (const artifact of deploymentArtifacts) {
    console.log(`   [SRE]   🔍 IaC→Cloud: ${artifact.name}`);
    const analysis = artifact.iacAnalysis;

    // ── Scope-aware candidate selection ────────────────────────────────────
    const scope = deploymentScopes?.get(artifact.id);
    let candidates: CloudResource[];

    if (scope && scope.resourceGroups.length > 0) {
      candidates = resolveResourceCandidates([scope], cloudRepository, 50);
      console.log(
        `   [SRE]     📍 Scoped to RG(s): ${scope.resourceGroups.join(', ')} ` +
        `(${candidates.length} candidate(s), method: ${scope.resolutionMethod})`,
      );
    } else {
      candidates = cloudRepository.query({}, 50);
      console.log(
        `   [SRE]     ⚠️  No scope for ${artifact.name} — using ${candidates.length} unscoped candidate(s) (of ${cloudRepository.totalCount} total)`,
      );
    }

    if (candidates.length === 0) {
      console.log(`   [SRE]     ℹ️  ${artifact.name}: no candidate cloud resources — skipping`);
      continue;
    }

    const allEntities = [...deploymentArtifacts, ...candidates];
    const validEntityIds = new Set(allEntities.map(e => e.id));
    const entityIdToName = new Map(allEntities.map(e => [e.id, e.name]));

    const mainEntityContext = (() => {
      const lines = [
        `DEPLOYMENT ARTIFACT: ${artifact.name}`,
        `ID: ${artifact.id}`,
        `Type: ${artifact.deploymentType}`,
        `Path: ${artifact.codePath}`,
        ...(artifact.responsibility ? [`Responsibility: ${artifact.responsibility}`] : []),
      ];
      if (analysis) {
        if (analysis.deployedResources.length > 0) {
          lines.push('', 'RESOURCES THIS IaC CREATES (from Step 0 analysis):');
          analysis.deployedResources.forEach(r =>
            lines.push(
              `  - ${r.name} (${r.resourceType}${r.cloudProvider ? `, ${r.cloudProvider}` : ''})` +
              (r.namingPattern ? ` pattern: "${r.namingPattern}"` : '') +
              (r.evidence ? ` — ${r.evidence}` : ''),
            ),
          );
        }
        if (analysis.usedResources.length > 0) {
          lines.push('', 'RESOURCES THIS IaC REFERENCES (from Step 0 analysis):');
          analysis.usedResources.forEach(r =>
            lines.push(
              `  - ${r.name} (${r.resourceType}${r.cloudProvider ? `, ${r.cloudProvider}` : ''})` +
              (r.namingPattern ? ` pattern: "${r.namingPattern}"` : '') +
              (r.evidence ? ` — ${r.evidence}` : ''),
            ),
          );
        }
        if (analysis.namingConventions.length > 0) {
          lines.push('', 'NAMING CONVENTIONS:');
          analysis.namingConventions.forEach(nc => lines.push(`  - ${nc}`));
        }
        if (analysis.deploymentTargets?.resourceGroups?.length) {
          lines.push('', `DEPLOYMENT TARGET RG(s): ${analysis.deploymentTargets.resourceGroups.join(', ')}`);
        }
      }
      return lines.join('\n');
    })();

    const targetEntitiesContext = (() => {
      if (!candidates.length) return 'No cloud resources available.';
      return [
        `AVAILABLE CLOUD RESOURCES (${candidates.length} in scope — match by name, type, or naming pattern):`,
        ...candidates.map(r =>
          `  - ID: ${r.id}\n    Name: ${r.name}\n    Type: ${r.resourceType} (${r.cloudProvider})` +
          (r.resourceGroup ? `\n    ResourceGroup: ${r.resourceGroup}` : '') +
          (r.responsibility ? `\n    Responsibility: ${r.responsibility}` : ''),
        ),
      ].join('\n');
    })();

    const hints = analysis
      ? buildCloudResourceHints(analysis.deployedResources, analysis.usedResources, candidates)
      : '';

    const customInstructions = `${ENTITY_CORRELATION_INSTRUCTIONS}

Match each resource from the Step 0 analysis above to the corresponding entity in AVAILABLE CLOUD RESOURCES.

${hints ? `MATCHING HINTS (use these to prioritise candidates):\n${hints}\n` : ''}RELATIONSHIP TYPES:
  - DEPLOYS → IaC creates/provisions the cloud resource
  - USES    → IaC only references/configures it (reads Key Vault, attaches to existing VNet, etc.)

RELATIONSHIP FORMAT:
{
  "type": "DEPLOYS" | "USES",
  "sourceId": "${artifact.id}",
  "targetId": "<exact cloud resource entity ID from the list above>",
  "reason": "…",
  "evidence": "Specific config key or resource name from the file (NO secret values)"
}

RULES:
- Use ONLY entity IDs from AVAILABLE CLOUD RESOURCES — do NOT invent IDs.
- A match requires the cloud resource name (or a clear substring) to appear verbatim in the IaC
  file (or a referenced config/variable file).  Type similarity alone is NOT sufficient evidence.
- If multiple cloud resources share the same type, you MUST find the specific name in the files;
  do not pick one based on naming-convention guesses.
- Skip resources with no name-level match in the repository — do NOT guess.
- If the file was already read in Step 0, you do NOT need to re-read it unless you need additional detail.`;

    const context = [
      '=== MAIN ENTITY TO ANALYZE ===',
      mainEntityContext,
      '',
      '=== AVAILABLE TARGET ENTITIES ===',
      targetEntitiesContext,
      '',
      'TASK: Match IaC-analysed resources to cloud resource entities using Step 0 findings.',
      '',
      'IMPORTANT:',
      `- Every relationship MUST have "${artifact.id}" as sourceId or targetId`,
      '- Use the exact entity IDs listed above (not names)',
      '- Only create relationships if you find concrete evidence',
    ].join('\n');

    const def = createCorrelationAgentDefinition(
      { mainEntityId: artifact.id, mainEntityName: artifact.name, mainEntityType: 'Deployment Artifact (IaC)', validEntityIds, entityIdToName, validRelationshipTypes: VALID_RELATIONSHIP_TYPES },
      customInstructions,
    );
    const task = registry.withDefinition(def).createTask('entity-correlator', { workspace: repositoryPath });
    const result = await task.execute<CorrelationResult>(context);

    const relationships = (result.requiredOutput as CorrelationResult | undefined)?.relationships ?? [];
    if (relationships.length > 0) {
      console.log(`   [SRE]     ✅ ${artifact.name}: ${relationships.length} relationship(s)`);
      const rels = relationships.map(r =>
        makeRelationship(tenantId, r.type as RelationshipType, r.sourceId, r.targetId, {
          reason: r.reason,
          evidence: r.evidence,
          iacPath: artifact.codePath,
          iacName: artifact.name,
        }),
      );
      allRelationships.push(...rels);

      // ── Build affinity map: collect RGs of DEPLOYS targets ───────────────
      for (const rel of relationships) {
        if (rel.type === 'DEPLOYS') {
          const targetResource = candidates.find(c => c.id === rel.targetId);
          if (targetResource?.resourceGroup) {
            if (!affinityByArtifact.has(artifact.id)) {
              affinityByArtifact.set(artifact.id, new Set());
            }
            affinityByArtifact.get(artifact.id)!.add(targetResource.resourceGroup);
          }
        }
      }

      await persistence.persistRelationships(rels);
    } else {
      console.log(`   [SRE]     ℹ️  ${artifact.name}: no cloud resource relationships found`);
    }
  }

  return { relationships: allRelationships, affinityByArtifact };
}
