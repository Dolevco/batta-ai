/**
 * ScriptAnalyzer
 *
 * Service that wraps ScriptAnalyzerAgent and provides two promotion helpers
 * to normalise ScriptAnalysis output into the schemas used by declarative
 * IaC files and build artifacts.
 *
 * After promotion, Steps 1–6 correlators work identically for scripts and
 * declarative files — no changes required downstream.
 *
 * Security:
 *   - ScriptAnalysisCompletionTool validates all evidence fields before the
 *     analysis reaches this service.
 *   - sanitizeMetadata is applied to the raw LLM output before use.
 *   - buildBuildArtifactAnalysis and promoteToIaCAnalysis never touch secret
 *     fields because ScriptAnalysis itself is secret-free after validation.
 */

import type {
  BuildArtifact,
  DeploymentArtifact,
  ScriptAnalysis,
  IaCAnalysis,
  BuildArtifactAnalysis,
  BuildArtifactServiceRef,
} from '@ai-agent/shared';
import { sanitizeMetadata } from '../../../utils/secret-sanitizer';
import type { ScriptAnalysisInput } from '../../../agents/tools/scriptAnalysisCompletionTool';
import { DataIndexerAgentRegistry, DataIndexerAgentType, createScriptAnalyzerAgentWithRepository } from '../../../agents';
import type { CloudResourceRepository } from '../../cloud-resource-repository';

export class ScriptAnalyzer {
  constructor(
    private readonly registry: DataIndexerAgentRegistry,
    /** Optional cloud repository — when provided, query tools are wired into the agent */
    private readonly cloudRepository?: CloudResourceRepository,
  ) {}

  /**
   * Run the ScriptAnalyzerAgent on a build or deployment artifact.
   * Returns a fully validated ScriptAnalysis.
   */
  async analyzeScript(
    artifact: BuildArtifact | DeploymentArtifact,
    repositoryPath: string,
  ): Promise<ScriptAnalysis> {
    // Use repository-aware definition when a cloud repository is available
    let task;
    if (this.cloudRepository) {
      const def = createScriptAnalyzerAgentWithRepository(this.cloudRepository);
      task = this.registry.withDefinition(def).createTask(DataIndexerAgentType.ScriptAnalyzer, {
        workspace: repositoryPath,
      });
    } else {
      task = this.registry.createTask(DataIndexerAgentType.ScriptAnalyzer, {
        workspace: repositoryPath,
      });
    }

    const artifactKind = artifact.entityType === 'build_artifact' ? 'build' : 'deployment';
    const technology = 'technology' in artifact ? artifact.technology : 'bash';

    const result = await task.execute<ScriptAnalysisInput>(
      `Analyse the ${artifactKind} script "${artifact.name}" located at "${artifact.codePath}".\n` +
      `Technology: ${technology}.\n\n` +
      `Read the file thoroughly, then:\n` +
      `1. Extract all BUILD output (produced services, image names, source directories).\n` +
      `2. Extract all DEPLOYMENT actions (deployed services, resource group, image deployed).\n` +
      `3. Extract all CLOUD RESOURCES created or referenced.\n` +
      `4. Extract the DEPLOYMENT TARGET SCOPE (resource groups, subscriptions, regions) from CLI arguments.\n` +
      `5. Resolve bash/shell variable assignments before extracting values.\n` +
      `6. Document NAMING CONVENTIONS observed.\n` +
      `7. Write a concise SUMMARY.\n\n` +
      `Call task_complete when done.`,
    );

    if (!result.requiredOutput) {
      console.warn(`   [SRE] Script analysis produced no output for "${artifact.name}"`);
      return {
        producedServices: [],
        buildPatterns: [],
        deployedServices: [],
        deployedResources: [],
        usedResources: [],
        deploymentTargets: {},
        namingConventions: [],
        summary: '',
      };
    }

    const raw = result.requiredOutput as unknown as ScriptAnalysisInput;
    const sanitized = sanitizeMetadata(raw as unknown as Record<string, unknown>) as unknown as ScriptAnalysis;
    return sanitized;
  }

  /**
   * Promote the deployment side of a ScriptAnalysis to an IaCAnalysis so
   * that Steps 3 (IaC→Cloud) and 5 (IaC→Service) work without changes.
   */
  promoteToIaCAnalysis(analysis: ScriptAnalysis): IaCAnalysis {
    return {
      deployedServices: analysis.deployedServices.map(s => ({
        name: s.name,
        imageName: s.imageName,
        evidence: s.evidence,
      })),
      deployedResources: analysis.deployedResources,
      usedResources: analysis.usedResources,
      namingConventions: analysis.namingConventions,
      summary: analysis.summary,
      deploymentTargets: analysis.deploymentTargets,
    };
  }

  /**
   * Promote the build side of a ScriptAnalysis to a BuildArtifactAnalysis so
   * that Steps 1 (Build→Service) and 2 (Build→Deployment) work without changes.
   */
  promoteToBuildArtifactAnalysis(analysis: ScriptAnalysis): BuildArtifactAnalysis {
    const producedServices: BuildArtifactServiceRef[] = analysis.producedServices.map(s => ({
      name: s.name,
      outputName: s.outputName,
      evidence: s.evidence,
    }));

    return {
      producedServices,
      buildTechnology: analysis.buildTechnology ?? 'script',
      targetRuntime: analysis.targetRuntime,
      buildPatterns: analysis.buildPatterns,
      summary: analysis.summary,
    };
  }

  /**
   * Build an enriched responsibility string from ScriptAnalysis findings.
   */
  buildScriptResponsibility(artifact: BuildArtifact | DeploymentArtifact, analysis: ScriptAnalysis): string {
    const parts: string[] = [];
    if (analysis.summary) parts.push(analysis.summary);
    if (analysis.producedServices.length > 0) {
      parts.push(`Builds: ${analysis.producedServices.map(s => s.outputName ?? s.name).join(', ')}.`);
    }
    if (analysis.deployedServices.length > 0) {
      parts.push(`Deploys: ${analysis.deployedServices.map(s => s.name).join(', ')}.`);
    }
    if (analysis.deploymentTargets.resourceGroups?.length) {
      parts.push(`Target RG(s): ${analysis.deploymentTargets.resourceGroups.join(', ')}.`);
    }
    return parts.join(' ') || artifact.responsibility || `Script artifact: ${artifact.name}`;
  }
}
