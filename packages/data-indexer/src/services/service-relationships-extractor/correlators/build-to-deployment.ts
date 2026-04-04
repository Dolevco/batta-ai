import { CorrelationTask } from '@ai-agent/core';
import type { CorrelationConfig } from '@ai-agent/core';
import type { ILLMApiHandler } from '@ai-agent/core';
import type {
  BuildArtifact,
  DeploymentArtifact,
  Relationship,
  RelationshipType,
  TenantId,
} from '@ai-agent/shared';
import { VALID_RELATIONSHIP_TYPES } from '../types';
import { makeRelationship } from '../helpers/utils';
import { PersistenceHelper } from '../helpers/persistence';

/**
 * Step 3 – Build → Deployment (DEPENDS_ON)
 *
 * Correlate deployment artifacts to the build artifacts they depend on.
 * Runs after Step 0.5 so build artifacts have buildArtifactAnalysis context.
 */
export async function correlateBuildToDeployment(
  api: ILLMApiHandler,
  persistence: PersistenceHelper,
  tenantId: TenantId,
  repositoryPath: string,
  buildArtifacts: BuildArtifact[],
  deploymentArtifacts: DeploymentArtifact[],
): Promise<Relationship[]> {
  const allRelationships: Relationship[] = [];

  for (const artifact of buildArtifacts) {
    console.log(`   [SRE]   🔍 Build→Deployment: ${artifact.name}`);
    const analysis = artifact.buildArtifactAnalysis;

    const config: CorrelationConfig<BuildArtifact | DeploymentArtifact> = {
      mainEntity: artifact,
      mainEntityType: 'Build Artifact',
      allEntities: [...buildArtifacts, ...deploymentArtifacts],
      repositoryPath,
      validRelationshipTypes: VALID_RELATIONSHIP_TYPES,
      getEntityId: (e) => e.id,
      getEntityName: (e) => e.name,
      buildMainEntityContext: (e) => {
        const a = e as BuildArtifact;
        const lines = [
          `BUILD ARTIFACT: ${a.name}`,
          `ID: ${a.id}`,
          `Type: ${a.buildType}`,
          `Path: ${a.codePath}`,
          ...(a.responsibility ? [`Responsibility: ${a.responsibility}`] : []),
        ];
        if (a.buildArtifactAnalysis) {
          const ba = a.buildArtifactAnalysis;
          if (ba.producedServices.length > 0) {
            lines.push('', 'SERVICES THIS BUILD PRODUCES (from Step 0.5 analysis):');
            ba.producedServices.forEach(s =>
              lines.push(
                `  - ${s.name}` +
                (s.outputName ? ` (image/output: ${s.outputName})` : '') +
                (s.runtime ? ` runtime: ${s.runtime}` : '') +
                (s.evidence ? ` — ${s.evidence}` : ''),
              ),
            );
          }
          if (ba.buildTechnology) lines.push(`Build technology: ${ba.buildTechnology}`);
        }
        return lines.join('\n');
      },
      buildTargetEntitiesContext: (entities) => {
        const deployments = entities.filter((e) => 'deploymentType' in e) as DeploymentArtifact[];
        if (!deployments.length) return 'No deployment artifacts available.';
        return [
          'DEPLOYMENT ARTIFACTS that might depend on this build:',
          ...deployments.map((d) =>
            `  - ID: ${d.id}\n    Name: ${d.name}\n    Type: ${d.deploymentType}\n    Path: ${d.codePath}` +
            (d.responsibility ? `\n    Responsibility: ${d.responsibility}` : '') +
            (d.iacAnalysis?.deployedServices.length
              ? `\n    IaC deploys: ${d.iacAnalysis.deployedServices.map(s => s.imageName ?? s.name).join(', ')}`
              : ''),
          ),
        ].join('\n');
      },
      buildAnalysisPrompt: (e) => {
        const a = e as BuildArtifact;
        const imageHints = analysis?.producedServices.length
          ? analysis.producedServices
              .filter(s => s.outputName)
              .map(s => `  • image/output "${s.outputName}" → look for deployment referencing this`)
              .join('\n')
          : '  (no output names found — read files to identify image references)';

        return `Find deployment artifacts that reference the images/outputs produced by "${a.name}".

OUTPUT/IMAGE HINTS (from Step 0.5 analysis):
${imageHints}

RELATIONSHIP TYPE:
  - DEPENDS_ON → the DEPLOYMENT artifact depends on this BUILD artifact
    (sourceId = deployment ID, targetId = this build artifact ID)

RELATIONSHIP FORMAT:
{
  "type": "DEPENDS_ON",
  "sourceId": "<exact deployment artifact entity ID>",
  "targetId": "${a.id}",
  "reason": "…",
  "evidence": "Image name or reference from deployment config (NO secret values)"
}

RULES:
- Use ONLY entity IDs from DEPLOYMENT ARTIFACTS — do NOT invent IDs.
- Match by container image name, registry reference, or output name.
- Require clear evidence — do NOT guess if there is no definitive match.
- If the IaC file was already read in Step 0, you do NOT need to re-read it.`;
      },
      taskInstructions: 'Find deployment artifacts that depend on this build artifact using Step 0.5 findings.',
    };

    const task = new CorrelationTask(api, config);
    const result = await task.execute();

    if (result.relationships.length > 0) {
      console.log(`   [SRE]     ✅ ${artifact.name}: ${result.relationships.length} relationship(s)`);
      const rels = result.relationships.map((r) =>
        makeRelationship(tenantId, r.type as RelationshipType, r.sourceId, r.targetId, {
          reason: r.reason,
          evidence: r.evidence,
          buildPath: artifact.codePath,
          buildName: artifact.name,
        }),
      );
      allRelationships.push(...rels);
      await persistence.persistRelationships(rels);
    } else {
      console.log(`   [SRE]     ℹ️  ${artifact.name}: no deployment relationships found`);
    }
  }

  return allRelationships;
}
