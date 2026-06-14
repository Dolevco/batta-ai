import type {
  BuildArtifact,
  CodeService,
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
 * Step 2 – Build → Service (BUILDS)
 *
 * Correlate build artifacts to the services they produce.
 * Runs after Step 0.5 so every build artifact has its buildArtifactAnalysis
 * populated — the LLM can use that structured context instead of re-reading files.
 */
export async function correlateBuildToService(
  registry: DataIndexerAgentRegistry,
  persistence: PersistenceHelper,
  tenantId: TenantId,
  repositoryPath: string,
  buildArtifacts: BuildArtifact[],
  services: CodeService[],
): Promise<Relationship[]> {
  const allRelationships: Relationship[] = [];

  for (const artifact of buildArtifacts) {
    console.log(`   [SRE]   🔍 Build→Service: ${artifact.name}`);
    const analysis = artifact.buildArtifactAnalysis;

    const allEntities = [...buildArtifacts, ...services];
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
              (s.outputName ? ` (output: ${s.outputName})` : '') +
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
      if (!services.length) return 'No services available.';
      return [
        'AVAILABLE CODE SERVICES (match by name, output name, or path):',
        ...services.map(s =>
          `  - ID: ${s.id}\n    Name: ${s.name}\n    Path: ${s.codePath}` +
          (s.responsibility ? `\n    Responsibility: ${s.responsibility}` : ''),
        ),
      ].join('\n');
    })();

    const hints = analysis?.producedServices.length
      ? analysis.producedServices
          .map(s =>
            `  • "${s.name}"${s.outputName ? ` / output "${s.outputName}"` : ''} → ` +
            `find a service whose name or path matches`,
          )
          .join('\n')
      : '  (no hints — read the file to identify produced services)';

    const customInstructions = `${ENTITY_CORRELATION_INSTRUCTIONS}

Match each produced service from the Step 0.5 analysis to a code service entity.

PRODUCED SERVICE HINTS:
${hints}

RELATIONSHIP TYPE:
  - BUILDS → this build artifact builds/produces the code service

RELATIONSHIP FORMAT:
{
  "type": "BUILDS",
  "sourceId": "${artifact.id}",
  "targetId": "<exact code service entity ID from AVAILABLE CODE SERVICES>",
  "reason": "…",
  "evidence": "Output name or path reference from the build file (NO secret values)"
}

RULES:
- Use ONLY entity IDs from AVAILABLE CODE SERVICES — do NOT invent IDs.
- Match by container/service name, output name, or directory path.
- Require clear evidence — do NOT guess if there is no definitive match.
- If the file was already read in Step 0.5, you do NOT need to re-read it.`;

    const context = [
      '=== MAIN ENTITY TO ANALYZE ===',
      mainEntityContext,
      '',
      '=== AVAILABLE TARGET ENTITIES ===',
      targetEntitiesContext,
      '',
      `TASK: Match this build artifact to the service(s) it produces using Step 0.5 findings.`,
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
      console.log(`   [SRE]     ℹ️  ${artifact.name}: no service relationships found`);
    }
  }

  return allRelationships;
}
