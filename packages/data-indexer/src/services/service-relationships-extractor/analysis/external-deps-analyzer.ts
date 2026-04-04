/**
 * @deprecated Superseded by ServiceAnalyzer (service-analyzer.ts).
 * Retained for reference only — not used in the active pipeline.
 * The ServiceAnalyzer produces a richer ServiceAnalysis that includes
 * all ExternalDep data plus code structure, tech stack, and business value.
 */
import type { ILLMApiHandler } from '@ai-agent/core';
import type { CodeService, ExternalDep } from '@ai-agent/shared';
import { sanitizeMetadata } from '../../../utils/secret-sanitizer';
import type { ExternalDepsInput } from '../../../agents/tools/externalDepsCompletionTool';
import { DataIndexerAgentRegistry, DataIndexerAgentType, dataIndexerAgentRegistry } from '../../../agents';

/** @deprecated Use ServiceAnalyzer instead. */
export class ExternalDepsAnalyzer {
  constructor(
    private readonly api: ILLMApiHandler,
    private readonly registry: DataIndexerAgentRegistry = dataIndexerAgentRegistry,
  ) {}

  async extractExternalDeps(
    service: CodeService,
    repositoryPath: string,
  ): Promise<{ externalDeps: ExternalDep[]; serviceDescription?: string }> {
    const servicePath = (service.metadata?.codePath as string) || service.codePath || '';
    const task = this.registry.createTask(DataIndexerAgentType.ServiceAnalyzer, this.api, {
      workspace: repositoryPath,
    });

    const result = await task.execute<ExternalDepsInput>(
      `Analyse the service "${service.name}" located at "${servicePath}" ` +
        `(tech stack: ${service.techStack?.join(', ') || 'unknown'}).\n\n` +
        `YOUR GOAL: find EVERY external dependency — do not stop early.\n\n` +
        `Follow ALL five analysis steps in the system instructions:\n` +
        `  Step 1 — Read package manifests (package.json, requirements.txt, go.mod, pom.xml, etc.) and flag any SDK/package that suggests an external service.\n` +
        `  Step 2 — Read ALL env var files (.env, .env.*, docker-compose, helm values, CI/CD YAMLs, Terraform) and flag any variable whose name suggests an external endpoint, key, or connection string.\n` +
        `  Step 3 — Read ALL config files (config.ts, settings.py, appSettings.json, *.config.*, src/config/, etc.).\n` +
        `  Step 4 — Scan EVERY source file in the service for HTTP client calls, cloud SDK usage, and third-party library imports.\n` +
        `  Step 5 — Skim README/docs for mentioned integrations.\n\n` +
        `1. Write a concrete serviceDescription (1-3 sentences): business purpose, primary responsibilities, key capabilities.\n` +
        `2. List ALL external dependencies found across all five steps.\n` +
        `Then call complete_external_deps.`,
    );

    if (!result.requiredOutput) {
      console.warn(`   [SRE] External deps task produced no output for "${service.name}"`);
      return { externalDeps: [] };
    }

    const output = result.requiredOutput as unknown as ExternalDepsInput;
    const sanitized = sanitizeMetadata(
      { externalDeps: output.externalDeps ?? [], serviceDescription: output.serviceDescription ?? '' } as unknown as Record<string, unknown>,
    ) as unknown as { externalDeps: ExternalDep[]; serviceDescription: string };

    return {
      externalDeps: sanitized.externalDeps ?? [],
      serviceDescription: sanitized.serviceDescription || undefined,
    };
  }

  /**
   * Build a responsibility string for a service from its metadata and externalDeps.
   * This replaces the separate semantic analysis LLM call for code services.
   */
  buildServiceResponsibility(service: CodeService, externalDeps: ExternalDep[], serviceDescription?: string): string {
    if (serviceDescription) return serviceDescription;
    if (service.responsibility) return service.responsibility;

    const parts: string[] = [];
    const techStack = service.techStack?.join(', ');

    parts.push(
      `${service.serviceType === 'api' ? 'API service' : service.serviceType} "${service.name}"` +
      (techStack ? ` (${techStack})` : '') +
      `.`,
    );

    if (externalDeps.length > 0) {
      const depSummary = externalDeps
        .slice(0, 3)
        .map(d => d.name)
        .join(', ');
      parts.push(
        `Integrates with: ${depSummary}${externalDeps.length > 3 ? `, and ${externalDeps.length - 3} more` : ''}.`,
      );
    }

    return parts.join(' ');
  }
}
