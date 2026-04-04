import { CorrelationTask } from '@ai-agent/core';
import type { CorrelationConfig } from '@ai-agent/core';
import type { ILLMApiHandler } from '@ai-agent/core';
import type {
  CloudResource,
  DeploymentArtifact,
  Relationship,
  RelationshipType,
  TenantId,
} from '@ai-agent/shared';
import { VALID_RELATIONSHIP_TYPES } from '../types';
import { makeRelationship, buildCloudResourceHints } from '../helpers/utils';
import { PersistenceHelper } from '../helpers/persistence';

/**
 * Step 4 – IaC → Cloud Resource (DEPLOYS / USES)
 *
 * Uses IaCAnalysis to correlate deployment artifacts to cloud resource entities.
 */
export async function correlateIaCToCloudResources(
  api: ILLMApiHandler,
  persistence: PersistenceHelper,
  tenantId: TenantId,
  repositoryPath: string,
  deploymentArtifacts: DeploymentArtifact[],
  cloudResources: CloudResource[],
): Promise<Relationship[]> {
  const allRelationships: Relationship[] = [];

  for (const artifact of deploymentArtifacts) {
    console.log(`   [SRE]   🔍 IaC→Cloud: ${artifact.name}`);
    const analysis = artifact.iacAnalysis;

    const config: CorrelationConfig<DeploymentArtifact | CloudResource> = {
      mainEntity: artifact,
      mainEntityType: 'Deployment Artifact (IaC)',
      allEntities: [...deploymentArtifacts, ...cloudResources],
      repositoryPath,
      validRelationshipTypes: VALID_RELATIONSHIP_TYPES,
      getEntityId: (e) => e.id,
      getEntityName: (e) => e.name,
      buildMainEntityContext: (e) => {
        const a = e as DeploymentArtifact;
        const lines = [
          `DEPLOYMENT ARTIFACT: ${a.name}`,
          `ID: ${a.id}`,
          `Type: ${a.deploymentType}`,
          `Path: ${a.codePath}`,
          ...(a.responsibility ? [`Responsibility: ${a.responsibility}`] : []),
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
        }

        return lines.join('\n');
      },
      buildTargetEntitiesContext: (entities) => {
        const resources = entities.filter((e) => 'cloudProvider' in e) as CloudResource[];
        if (!resources.length) return 'No cloud resources available.';
        return [
          'AVAILABLE CLOUD RESOURCES (match by name, type, or naming pattern):',
          ...resources.map((r) =>
            `  - ID: ${r.id}\n    Name: ${r.name}\n    Type: ${r.resourceType} (${r.cloudProvider})` +
            (r.responsibility ? `\n    Responsibility: ${r.responsibility}` : ''),
          ),
        ].join('\n');
      },
      buildAnalysisPrompt: (e) => {
        const a = e as DeploymentArtifact;
        const hints = analysis
          ? buildCloudResourceHints(
              analysis.deployedResources,
              analysis.usedResources,
              cloudResources,
            )
          : '';

        return `Match each resource from the Step 0 analysis above to the corresponding entity in AVAILABLE CLOUD RESOURCES.

${hints ? `MATCHING HINTS (use these to prioritise candidates):\n${hints}\n` : ''}RELATIONSHIP TYPES:
  - DEPLOYS → IaC creates/provisions the cloud resource
  - USES    → IaC only references/configures it (reads Key Vault, attaches to existing VNet, etc.)

RELATIONSHIP FORMAT:
{
  "type": "DEPLOYS" | "USES",
  "sourceId": "${a.id}",
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
      },
      taskInstructions:
        'Match IaC-analysed resources to cloud resource entities using Step 0 findings.',
    };

    const task = new CorrelationTask(api, config);
    const result = await task.execute();

    if (result.relationships.length > 0) {
      console.log(`   [SRE]     ✅ ${artifact.name}: ${result.relationships.length} relationship(s)`);
      const rels = result.relationships.map((r) =>
        makeRelationship(tenantId, r.type as RelationshipType, r.sourceId, r.targetId, {
          reason: r.reason,
          evidence: r.evidence,
          iacPath: artifact.codePath,
          iacName: artifact.name,
        }),
      );
      allRelationships.push(...rels);
      await persistence.persistRelationships(rels);
    } else {
      console.log(`   [SRE]     ℹ️  ${artifact.name}: no cloud resource relationships found`);
    }
  }

  return allRelationships;
}
