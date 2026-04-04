import type { ILLMApiHandler } from '@ai-agent/core';
import type { DeploymentArtifact, IaCAnalysis } from '@ai-agent/shared';
import { sanitizeMetadata } from '../../../utils/secret-sanitizer';
import type { IaCAnalysisInput } from '../../../agents/tools/iacAnalysisCompletionTool';
import { DataIndexerAgentRegistry, DataIndexerAgentType, dataIndexerAgentRegistry, createIaCAnalyzerAgentWithRepository } from '../../../agents';
import type { CloudResourceRepository } from '../../cloud-resource-repository';

export class IaCAnalyzer {
  constructor(
    private readonly api: ILLMApiHandler,
    private readonly registry: DataIndexerAgentRegistry = dataIndexerAgentRegistry,
    /** Optional cloud repository — when provided, query tools are wired into the agent */
    private readonly cloudRepository?: CloudResourceRepository,
  ) {}

  async analyzeIaCFile(
    artifact: DeploymentArtifact,
    repositoryPath: string,
  ): Promise<IaCAnalysis> {
    // Use repository-aware definition when a cloud repository is available
    // so the agent can call list_resource_groups / query_cloud_resources during analysis.
    let task;
    if (this.cloudRepository) {
      const def = createIaCAnalyzerAgentWithRepository(this.cloudRepository);
      // Register temporarily on a local registry to create a task from the factory def
      const localRegistry = new DataIndexerAgentRegistry();
      localRegistry.register(def);
      task = localRegistry.createTask(DataIndexerAgentType.IacAnalyzer, this.api, {
        workspace: repositoryPath,
      });
    } else {
      task = this.registry.createTask(DataIndexerAgentType.IacAnalyzer, this.api, {
        workspace: repositoryPath,
      });
    }

    const result = await task.execute<IaCAnalysisInput>(
      `Analyse the IaC file "${artifact.name}" located at "${artifact.codePath}".\n` +
      `Deployment type: ${artifact.deploymentType}, Technology: ${artifact.technology}.\n\n` +
      `Read the file thoroughly, then:\n` +
      `1. Identify all CODE SERVICES it deploys (container images, app packages, etc.).\n` +
      `2. Identify all CLOUD RESOURCES it CREATES/PROVISIONS.\n` +
      `3. Identify all CLOUD RESOURCES it only REFERENCES (reads config, connects to existing resource).\n` +
      `4. Document any NAMING CONVENTIONS (prefixes, suffixes, env-token patterns).\n` +
      `5. Write a concise SUMMARY.\n\n` +
      `Call complete_iac_analysis when done.`,
    );

    if (!result.requiredOutput) {
      console.warn(`   [SRE] IaC analysis produced no output for "${artifact.name}"`);
      return { deployedServices: [], deployedResources: [], usedResources: [], namingConventions: [], summary: '' };
    }

    const raw = result.requiredOutput as unknown as IaCAnalysisInput;
    const sanitized = sanitizeMetadata(
      raw as unknown as Record<string, unknown>,
    ) as unknown as IaCAnalysis;

    return sanitized;
  }

  /**
   * Build an enriched responsibility string from IaCAnalysis findings.
   * This replaces the generic semantic-analysis description for IaC files.
   */
  buildIaCResponsibility(artifact: DeploymentArtifact, analysis: IaCAnalysis): string {
    const parts: string[] = [];

    if (analysis.summary) {
      parts.push(analysis.summary);
    }
    if (analysis.deployedServices.length > 0) {
      parts.push(`Deploys: ${analysis.deployedServices.map(s => s.name).join(', ')}.`);
    }
    if (analysis.deployedResources.length > 0) {
      parts.push(`Provisions: ${analysis.deployedResources.map(r => `${r.name} (${r.resourceType})`).join(', ')}.`);
    }
    if (analysis.usedResources.length > 0) {
      parts.push(`References: ${analysis.usedResources.map(r => `${r.name} (${r.resourceType})`).join(', ')}.`);
    }
    if (analysis.namingConventions.length > 0) {
      parts.push(`Naming: ${analysis.namingConventions[0]}`);
    }

    return parts.join(' ') || artifact.responsibility || `${artifact.deploymentType} deployment artifact`;
  }
}
