import type {
  BuildArtifact,
  DeploymentArtifact,
  Relationship,
  RelationshipType,
  TenantId,
} from '@batta/shared';
import { VALID_RELATIONSHIP_TYPES } from '../types';
import { makeRelationship } from '../helpers/utils';
import { PersistenceHelper } from '../helpers/persistence';
import type { DataIndexerAgentRegistry } from '../../../agents/registry';
import { createCorrelationAgentDefinition, ENTITY_CORRELATION_INSTRUCTIONS } from '../../../agents/definitions/correlationAgent';
import type { CorrelationResult } from '../../../agents/tools/correlationTaskCompletionTool';

/**
 * Step 3 – Build → Deployment (DEPENDS_ON)
 *
 * Correlate deployment artifacts to the build artifacts they depend on.
 * Runs after Step 0.5 so build artifacts have buildArtifactAnalysis context.
 */
export async function correlateBuildToDeployment(
  registry: DataIndexerAgentRegistry,
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

    const allEntities = [...buildArtifacts, ...deploymentArtifacts];
    const validEntityIds = new Set(allEntities.map(e => e.id));
    const entityIdToName = new Map(allEntities.map(e => [e.id, e.name]));

    const mainEntityContext = (() => {
      const lines = [
        `BUILD ARTIFACT: ${artifact.name}`,
        `ID: ${artifact.id}`,
        `Type: ${artifact.buildType}`,
        `Path: ${artifact.codePath}`,
        ...(artifact.responsibility ? [`Responsibility: ${artifact.responsibility}`] : []),
      ];
      if (analysis) {
        if (analysis.producedServices.length > 0) {
          lines.push('', 'SERVICES THIS BUILD PRODUCES (from Step 0.5 analysis):');
          analysis.producedServices.forEach(s =>
            lines.push(
              `  - ${s.name}` +
              (s.outputName ? ` (image/output: ${s.outputName})` : '') +
              (s.runtime ? ` runtime: ${s.runtime}` : '') +
              (s.evidence ? ` — ${s.evidence}` : ''),
            ),
          );
        }
        if (analysis.buildTechnology) lines.push(`Build technology: ${analysis.buildTechnology}`);
      }
      return lines.join('\n');
    })();

    const targetEntitiesContext = (() => {
      if (!deploymentArtifacts.length) return 'No deployment artifacts available.';
      return [
        'DEPLOYMENT ARTIFACTS that might depend on this build:',
        ...deploymentArtifacts.map(d =>
          `  - ID: ${d.id}\n    Name: ${d.name}\n    Type: ${d.deploymentType}\n    Path: ${d.codePath}` +
          (d.responsibility ? `\n    Responsibility: ${d.responsibility}` : '') +
          (d.iacAnalysis?.deployedServices.length
            ? `\n    IaC deploys: ${d.iacAnalysis.deployedServices.map(s => s.imageName ?? s.name).join(', ')}`
            : ''),
        ),
      ].join('\n');
    })();

    const imageHints = analysis?.producedServices.length
      ? analysis.producedServices
          .filter(s => s.outputName)
          .map(s => `  • image/output "${s.outputName}" → look for deployment referencing this`)
          .join('\n')
      : '  (no output names found — read files to identify image references)';

    const customInstructions = `${ENTITY_CORRELATION_INSTRUCTIONS}

Find deployment artifacts that reference the images/outputs produced by "${artifact.name}".

OUTPUT/IMAGE HINTS (from Step 0.5 analysis):
${imageHints}

RELATIONSHIP TYPE:
  - DEPENDS_ON → the DEPLOYMENT artifact depends on this BUILD artifact
    (sourceId = deployment ID, targetId = this build artifact ID)

RELATIONSHIP FORMAT:
{
  "type": "DEPENDS_ON",
  "sourceId": "<exact deployment artifact entity ID>",
  "targetId": "${artifact.id}",
  "reason": "…",
  "evidence": "Image name or reference from deployment config (NO secret values)"
}

RULES:
- Use ONLY entity IDs from DEPLOYMENT ARTIFACTS — do NOT invent IDs.
- Match by container image name, registry reference, or output name.
- Require clear evidence — do NOT guess if there is no definitive match.
- If the IaC file was already read in Step 0, you do NOT need to re-read it.`;

    const context = [
      '=== MAIN ENTITY TO ANALYZE ===',
      mainEntityContext,
      '',
      '=== AVAILABLE TARGET ENTITIES ===',
      targetEntitiesContext,
      '',
      'TASK: Find deployment artifacts that depend on this build artifact using Step 0.5 findings.',
      '',
      'IMPORTANT:',
      `- Every relationship MUST have "${artifact.id}" as sourceId or targetId`,
      '- Use the exact entity IDs listed above (not names)',
      '- Only create relationships if you find concrete evidence',
    ].join('\n');

    const def = createCorrelationAgentDefinition(
      { mainEntityId: artifact.id, mainEntityName: artifact.name, mainEntityType: 'Build Artifact', validEntityIds, entityIdToName, validRelationshipTypes: VALID_RELATIONSHIP_TYPES },
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
