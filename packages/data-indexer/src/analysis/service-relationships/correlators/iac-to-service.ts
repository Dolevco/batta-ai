import type {
  CodeService,
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
 * Step 5 – IaC → Service (DEPLOYS)
 *
 * Uses IaCAnalysis to correlate deployment artifacts to code service entities.
 */
export async function correlateIaCToServices(
  registry: DataIndexerAgentRegistry,
  persistence: PersistenceHelper,
  tenantId: TenantId,
  repositoryPath: string,
  deploymentArtifacts: DeploymentArtifact[],
  services: CodeService[],
): Promise<Relationship[]> {
  const allRelationships: Relationship[] = [];

  for (const artifact of deploymentArtifacts) {
    console.log(`   [SRE]   🔍 IaC→Service: ${artifact.name}`);
    const analysis = artifact.iacAnalysis;

    const allEntities = [...deploymentArtifacts, ...services];
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
      if (analysis?.deployedServices.length) {
        lines.push('', 'SERVICES THIS IaC DEPLOYS (from Step 0 analysis):');
        analysis.deployedServices.forEach(s =>
          lines.push(
            `  - ${s.name}` +
            (s.imageName ? ` (image: ${s.imageName})` : '') +
            (s.evidence ? ` — ${s.evidence}` : ''),
          ),
        );
      } else {
        lines.push('', '(Step 0 analysis found no explicitly named deployed services — check the file.)');
      }
      return lines.join('\n');
    })();

    const targetEntitiesContext = (() => {
      if (!services.length) return 'No services available.';
      return [
        'AVAILABLE CODE SERVICES (match by name, image reference, or path):',
        ...services.map(s =>
          `  - ID: ${s.id}\n    Name: ${s.name}\n    Path: ${s.codePath}` +
          (s.responsibility ? `\n    Responsibility: ${s.responsibility}` : ''),
        ),
      ].join('\n');
    })();

    const serviceHints = analysis?.deployedServices.length
      ? analysis.deployedServices
          .map(s =>
            `  • "${s.name}"${s.imageName ? ` / image "${s.imageName}"` : ''} → ` +
            `look for a service whose name or path matches this`,
          )
          .join('\n')
      : '  (no hints — read the file to identify deployed services)';

    const customInstructions = `${ENTITY_CORRELATION_INSTRUCTIONS}

Match each deployed service from the Step 0 analysis to a code service entity.

DEPLOYED SERVICE HINTS:
${serviceHints}

RELATIONSHIP TYPE:
  - DEPLOYS → this IaC deploys the code service

RELATIONSHIP FORMAT:
{
  "type": "DEPLOYS",
  "sourceId": "${artifact.id}",
  "targetId": "<exact code service entity ID from AVAILABLE CODE SERVICES>",
  "reason": "…",
  "evidence": "Image ref or service name from the file (NO secret values)"
}

RULES:
- Use ONLY entity IDs from AVAILABLE CODE SERVICES — do NOT invent IDs.
- Match by container/service name, image reference, or directory path.
- Require clear evidence — do NOT guess if there is no definitive match.
- If the file was already read in Step 0, you do NOT need to re-read it unless additional detail is needed.`;

    const context = [
      '=== MAIN ENTITY TO ANALYZE ===',
      mainEntityContext,
      '',
      '=== AVAILABLE TARGET ENTITIES ===',
      targetEntitiesContext,
      '',
      'TASK: Match IaC-deployed services to code service entities using Step 0 findings.',
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
      await persistence.persistRelationships(rels);
    } else {
      console.log(`   [SRE]     ℹ️  ${artifact.name}: no service relationships found`);
    }
  }

  return allRelationships;
}
