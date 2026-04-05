import type { BuildArtifact, BuildArtifactAnalysis } from '@ai-agent/shared';
import { sanitizeMetadata } from '../../../utils/secret-sanitizer';
import type { BuildArtifactAnalysisInput } from '../../../agents/tools/buildArtifactAnalysisCompletionTool';
import { DataIndexerAgentRegistry, DataIndexerAgentType } from '../../../agents';

export class BuildArtifactAnalyzer {
  constructor(
    private readonly registry: DataIndexerAgentRegistry,
  ) {}

  async analyzeBuildArtifactFile(
    artifact: BuildArtifact,
    repositoryPath: string,
  ): Promise<BuildArtifactAnalysis> {
    const task = this.registry.createTask(DataIndexerAgentType.BuildArtifactAnalyzer, {
      workspace: repositoryPath,
    });

    const result = await task.execute<BuildArtifactAnalysisInput>(
      `Analyse the build artifact "${artifact.name}" located at "${artifact.codePath}".\n` +
      `Build type: ${artifact.buildType}, Technology: ${artifact.technology}.\n\n` +
      `Read the file thoroughly, then:\n` +
      `1. Identify all CODE SERVICES this file PRODUCES (images, packages, jars, etc.).\n` +
      `2. Identify the BUILD TECHNOLOGY used (e.g. "Docker multi-stage", "pnpm build + Docker").\n` +
      `3. Identify the TARGET RUNTIME or final base image.\n` +
      `4. Document any notable BUILD PATTERNS (multi-stage, layer caching, etc.).\n` +
      `5. Write a concise SUMMARY.\n\n` +
      `Call complete_build_artifact_analysis when done.`,
    );

    if (!result.requiredOutput) {
      console.warn(`   [SRE] Build artifact analysis produced no output for "${artifact.name}"`);
      return { producedServices: [], buildTechnology: artifact.buildType, buildPatterns: [], summary: '' };
    }

    const raw = result.requiredOutput as unknown as BuildArtifactAnalysisInput;
    const sanitized = sanitizeMetadata(
      raw as unknown as Record<string, unknown>,
    ) as unknown as BuildArtifactAnalysis;

    return sanitized;
  }

  /**
   * Build an enriched responsibility string from BuildArtifactAnalysis findings.
   * This replaces the generic semantic-analysis description for build files.
   */
  buildBuildArtifactResponsibility(
    artifact: BuildArtifact,
    analysis: BuildArtifactAnalysis,
  ): string {
    const parts: string[] = [];

    if (analysis.summary) {
      parts.push(analysis.summary);
    }
    if (analysis.producedServices.length > 0) {
      const serviceNames = analysis.producedServices.map(s =>
        s.outputName ? `${s.name} (${s.outputName})` : s.name,
      );
      parts.push(`Builds: ${serviceNames.join(', ')}.`);
    }
    if (analysis.targetRuntime) {
      parts.push(`Runtime: ${analysis.targetRuntime}.`);
    }
    if (analysis.buildPatterns.length > 0) {
      parts.push(`Patterns: ${analysis.buildPatterns.slice(0, 2).join(', ')}.`);
    }

    return parts.join(' ') || artifact.responsibility || `${artifact.buildType} build artifact`;
  }
}
