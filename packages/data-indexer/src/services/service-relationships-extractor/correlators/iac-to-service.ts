import { CorrelationTask } from '@ai-agent/core';
import type { CorrelationConfig } from '@ai-agent/core';
import type { ILLMApiHandler } from '@ai-agent/core';
import type {
  CodeService,
  DeploymentArtifact,
  Relationship,
  RelationshipType,
  TenantId,
} from '@ai-agent/shared';
import { VALID_RELATIONSHIP_TYPES } from '../types';
import { makeRelationship } from '../helpers/utils';
import { PersistenceHelper } from '../helpers/persistence';

/**
 * Step 5 – IaC → Service (DEPLOYS)
 *
 * Uses IaCAnalysis to correlate deployment artifacts to code service entities.
 */
export async function correlateIaCToServices(
  api: ILLMApiHandler,
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

    const config: CorrelationConfig<DeploymentArtifact | CodeService> = {
      mainEntity: artifact,
      mainEntityType: 'Deployment Artifact (IaC)',
      allEntities: [...deploymentArtifacts, ...services],
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
      },
      buildTargetEntitiesContext: (entities) => {
        const svcs = entities.filter((e) => 'serviceType' in e) as CodeService[];
        if (!svcs.length) return 'No services available.';
        return [
          'AVAILABLE CODE SERVICES (match by name, image reference, or path):',
          ...svcs.map((s) =>
            `  - ID: ${s.id}\n    Name: ${s.name}\n    Path: ${s.codePath}` +
            (s.responsibility ? `\n    Responsibility: ${s.responsibility}` : ''),
          ),
        ].join('\n');
      },
      buildAnalysisPrompt: (e) => {
        const a = e as DeploymentArtifact;
        const serviceHints = analysis?.deployedServices.length
          ? analysis.deployedServices
              .map(s =>
                `  • "${s.name}"${s.imageName ? ` / image "${s.imageName}"` : ''} → ` +
                `look for a service whose name or path matches this`,
              )
              .join('\n')
          : '  (no hints — read the file to identify deployed services)';

        return `Match each deployed service from the Step 0 analysis to a code service entity.

DEPLOYED SERVICE HINTS:
${serviceHints}

RELATIONSHIP TYPE:
  - DEPLOYS → this IaC deploys the code service

RELATIONSHIP FORMAT:
{
  "type": "DEPLOYS",
  "sourceId": "${a.id}",
  "targetId": "<exact code service entity ID from AVAILABLE CODE SERVICES>",
  "reason": "…",
  "evidence": "Image ref or service name from the file (NO secret values)"
}

RULES:
- Use ONLY entity IDs from AVAILABLE CODE SERVICES — do NOT invent IDs.
- Match by container/service name, image reference, or directory path.
- Require clear evidence — do NOT guess if there is no definitive match.
- If the file was already read in Step 0, you do NOT need to re-read it unless additional detail is needed.`;
      },
      taskInstructions:
        'Match IaC-deployed services to code service entities using Step 0 findings.',
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
      console.log(`   [SRE]     ℹ️  ${artifact.name}: no service relationships found`);
    }
  }

  return allRelationships;
}
