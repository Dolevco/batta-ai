import { CorrelationTask } from '@ai-agent/core';
import type { CorrelationConfig } from '@ai-agent/core';
import type { ILLMApiHandler } from '@ai-agent/core';
import type {
  BuildArtifact,
  CodeService,
  Relationship,
  RelationshipType,
  TenantId,
} from '@ai-agent/shared';
import { VALID_RELATIONSHIP_TYPES } from '../types';
import { makeRelationship } from '../helpers/utils';
import { PersistenceHelper } from '../helpers/persistence';

/**
 * Step 2 – Build → Service (BUILDS)
 *
 * Correlate build artifacts to the services they produce.
 * Runs after Step 0.5 so every build artifact has its buildArtifactAnalysis
 * populated — the LLM can use that structured context instead of re-reading files.
 */
export async function correlateBuildToService(
  api: ILLMApiHandler,
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

    const config: CorrelationConfig<BuildArtifact | CodeService> = {
      mainEntity: artifact,
      mainEntityType: 'Build Artifact',
      allEntities: [...buildArtifacts, ...services],
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
                (s.outputName ? ` (output: ${s.outputName})` : '') +
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
        const svcs = entities.filter((e) => 'serviceType' in e) as CodeService[];
        if (!svcs.length) return 'No services available.';
        return [
          'AVAILABLE CODE SERVICES (match by name, output name, or path):',
          ...svcs.map((s) =>
            `  - ID: ${s.id}\n    Name: ${s.name}\n    Path: ${s.codePath}` +
            (s.responsibility ? `\n    Responsibility: ${s.responsibility}` : ''),
          ),
        ].join('\n');
      },
      buildAnalysisPrompt: (e) => {
        const a = e as BuildArtifact;
        const hints = analysis?.producedServices.length
          ? analysis.producedServices
              .map(s =>
                `  • "${s.name}"${s.outputName ? ` / output "${s.outputName}"` : ''} → ` +
                `find a service whose name or path matches`,
              )
              .join('\n')
          : '  (no hints — read the file to identify produced services)';

        return `Match each produced service from the Step 0.5 analysis to a code service entity.

PRODUCED SERVICE HINTS:
${hints}

RELATIONSHIP TYPE:
  - BUILDS → this build artifact builds/produces the code service

RELATIONSHIP FORMAT:
{
  "type": "BUILDS",
  "sourceId": "${a.id}",
  "targetId": "<exact code service entity ID from AVAILABLE CODE SERVICES>",
  "reason": "…",
  "evidence": "Output name or path reference from the build file (NO secret values)"
}

RULES:
- Use ONLY entity IDs from AVAILABLE CODE SERVICES — do NOT invent IDs.
- Match by container/service name, output name, or directory path.
- Require clear evidence — do NOT guess if there is no definitive match.
- If the file was already read in Step 0.5, you do NOT need to re-read it.`;
      },
      taskInstructions: 'Match this build artifact to the service(s) it produces using Step 0.5 findings.',
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
      console.log(`   [SRE]     ℹ️  ${artifact.name}: no service relationships found`);
    }
  }

  return allRelationships;
}
