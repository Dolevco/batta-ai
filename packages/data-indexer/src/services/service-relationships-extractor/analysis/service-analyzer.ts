/**
 * ServiceAnalyzer
 *
 * Replaces the former ExternalDepsAnalyzer. Produces a rich structured
 * ServiceAnalysis for each CodeService — including business description,
 * business value, tech stack, code structure, external/internal dependencies,
 * entry point types, and architectural patterns.
 *
 * The richer output is used as shared context by all downstream agents
 * (feature extraction, threat models, repository responsibility).
 *
 * Security:
 *   - All LLM outputs are sanitized with sanitizeMetadata before use.
 *   - Errors are logged with only the message string.
 *   - The ServiceAnalysisCompletionTool rejects evidence fields that look
 *     like actual secret values.
 *   - Repository briefing context (if provided) is injected into the prompt
 *     as read-only orientation — it is never written back to the LLM tool.
 */

import type { ILLMApiHandler } from '@ai-agent/core';
import type { CodeService, ExternalDep, RepositoryBriefing, ServiceAnalysis } from '@ai-agent/shared';
import { sanitizeMetadata } from '../../../utils/secret-sanitizer';
import type { ServiceAnalysisInput } from '../../../agents/tools/serviceAnalysisCompletionTool';
import { DataIndexerAgentRegistry, DataIndexerAgentType, dataIndexerAgentRegistry } from '../../../agents';

export class ServiceAnalyzer {
  constructor(
    private readonly api: ILLMApiHandler,
    private readonly registry: DataIndexerAgentRegistry = dataIndexerAgentRegistry,
  ) {}

  /**
   * Run the full service analysis for a single CodeService.
   *
   * @param service        - The service to analyse.
   * @param repositoryPath - Absolute path to the repository root (workspace).
   * @param briefing       - Optional repository briefing for orientation context.
   * @returns              Sanitized ServiceAnalysis output.
   */
  async analyzeService(
    service: CodeService,
    repositoryPath: string,
    briefing?: RepositoryBriefing,
  ): Promise<ServiceAnalysis> {
    const servicePath = (service.metadata?.codePath as string) || service.codePath || '';

    const briefingContext = briefing
      ? `\n\n--- REPOSITORY BRIEFING (orientation context) ---\n` +
        `Summary: ${briefing.summary}\n` +
        `Languages: ${briefing.languages.join(', ')}\n` +
        `Frameworks: ${briefing.frameworks.join(', ')}\n` +
        `Build tools: ${briefing.buildTools.join(', ')}\n` +
        `Services in this repo: ${briefing.serviceNames.join(', ')}\n` +
        `Deployment targets: ${briefing.deploymentTargets.join(', ')}\n` +
        `Architecture: ${briefing.architecturalPatterns.join(', ')}\n` +
        `---`
      : '';

    const task = this.registry.createTask(DataIndexerAgentType.ServiceAnalyzer, this.api, {
      workspace: repositoryPath,
    });

    const result = await task.execute<ServiceAnalysisInput>(
      `Analyse the service "${service.name}" located at "${servicePath}" ` +
        `(known tech stack: ${service.techStack?.join(', ') || 'unknown'}).` +
        briefingContext + `\n\n` +
        `YOUR GOAL: produce a complete ServiceAnalysis covering ALL six analysis steps.\n\n` +
        `Step 1 — Package manifests: identify tech stack, runtime SDKs, external service packages.\n` +
        `Step 2 — Env var files: flag *_URL, *_API_KEY, *_HOST, DATABASE_URL, REDIS_URL, etc.\n` +
        `Step 3 — Config files: config.ts, settings.*, appSettings.json, src/config/.\n` +
        `Step 4 — Entry points & architecture: index/main/app files, routes, workers — identify entry point types and patterns.\n` +
        `Step 5 — Source scanning: HTTP clients, cloud SDK imports, sibling service imports.\n` +
        `Step 6 — README/docs: business purpose, integration mentions.\n\n` +
        `Then call complete_service_analysis.`,
    );

    if (!result.requiredOutput) {
      console.warn(`   [SRE] Service analysis task produced no output for "${service.name}"`);
      return this.buildFallbackAnalysis(service);
    }

    const output = result.requiredOutput as unknown as ServiceAnalysisInput;
    const sanitized = sanitizeMetadata(
      output.serviceAnalysis as unknown as Record<string, unknown>,
    ) as unknown as ServiceAnalysis;

    return sanitized;
  }

  /**
   * Build a responsibility string from a ServiceAnalysis.
   * Used to populate CodeService.responsibility for semantic search.
   */
  buildServiceResponsibility(analysis: ServiceAnalysis): string {
    if (analysis.serviceDescription) return analysis.serviceDescription;

    const parts: string[] = [];
    if (analysis.techStack.length > 0) {
      parts.push(`Service using ${analysis.techStack.slice(0, 3).join(', ')}.`);
    }
    if (analysis.externalDeps.length > 0) {
      const depSummary = analysis.externalDeps
        .slice(0, 3)
        .map((d: ExternalDep) => d.name)
        .join(', ');
      parts.push(
        `Integrates with: ${depSummary}${analysis.externalDeps.length > 3 ? `, and ${analysis.externalDeps.length - 3} more` : ''}.`,
      );
    }
    return parts.join(' ') || `Service at ${analysis.codeStructure}.`;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private buildFallbackAnalysis(service: CodeService): ServiceAnalysis {
    return {
      serviceDescription: service.responsibility || service.name,
      businessValue: `Provides ${service.serviceType} capabilities.`,
      techStack: service.techStack ?? [],
      codeStructure: service.codePath ?? '',
      externalDeps: service.externalDeps ?? [],
      internalDependencies: [],
      entryPointTypes: ['other'],
      architecturalPatterns: [],
    };
  }
}
