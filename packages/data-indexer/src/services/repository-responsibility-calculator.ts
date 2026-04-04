/**
 * Repository Responsibility Calculator
 *
 * Synthesises a repository-level responsibility description from:
 *   1. The RepositoryBriefing produced at the start of the pipeline (if available).
 *   2. The per-service ServiceAnalysis objects from Step 1 (service description,
 *      business value, tech stack, architectural patterns).
 *   3. Build artifact and deployment artifact responsibility strings (fallback).
 *
 * Having both the briefing (repo-wide orientation) and per-service analyses
 * (richer than bare responsibility strings) produces a more accurate and
 * business-oriented repository description than reading only responsibility
 * strings, which may be sparse for newly-indexed repositories.
 *
 * Runs after SRE Steps 0–1 (analysis phase) so it always has the richest
 * per-entity data available.
 *
 * Security:
 *   - Only LLM-generated fields from prior pipeline stages are fed into the
 *     prompt — no raw source code or config file content ever reaches this step.
 *   - The LLM is called without file tools.
 *   - Errors are logged with only the message string.
 */

import type { ILLMApiHandler } from '@ai-agent/core';
import { PlannedTaskCompletionTool, Task, MODES } from '@ai-agent/core';
import type {
  CanonicalEntity,
  CodeRepository,
  CodeService,
  BuildArtifact,
  DeploymentArtifact,
  RepositoryBriefing,
  TenantId,
} from '@ai-agent/shared';
import { Neo4jAdapter, QdrantAdapter } from '@ai-agent/shared';

export class RepositoryResponsibilityCalculator {
  constructor(
    private readonly api: ILLMApiHandler,
    private readonly qdrant?: QdrantAdapter,
    private readonly neo4j?: Neo4jAdapter,
  ) {}

  /**
   * For every CodeRepository entity in `entities`, compute a responsibility
   * string from the repository briefing and per-service analyses, update
   * the entity in-place, and persist to Qdrant + Neo4j.
   *
   * @param briefing - Optional repository briefing (produced before SRE).
   *                   When present, it enriches the LLM prompt significantly.
   */
  async calculate(
    tenantId: TenantId,
    entities: CanonicalEntity[],
    briefing?: RepositoryBriefing,
  ): Promise<void> {
    const repositories = entities.filter(
      (e): e is CodeRepository => e.entityType === 'code_repository',
    );

    if (repositories.length === 0) return;

    const services = entities.filter(
      (e): e is CodeService => e.entityType === 'code_service',
    );
    const builds = entities.filter(
      (e): e is BuildArtifact => e.entityType === 'build_artifact',
    );
    const deployments = entities.filter(
      (e): e is DeploymentArtifact => e.entityType === 'deployment_artifact',
    );

    console.log(
      `   [RepoResp] Calculating responsibility for ${repositories.length} repository/ies…`,
    );

    for (const repo of repositories) {
      try {
        const serviceContext = this.collectServiceContext(repo.id, services);
        const artifactContext = this.collectArtifactContext(repo.id, builds, deployments);

        const responsibility = await this.synthesiseResponsibility(
          repo.name,
          serviceContext,
          artifactContext,
          briefing,
        );

        (repo as CodeRepository).responsibility = responsibility;
        await this.persist(repo as CodeRepository);

        console.log(`   [RepoResp]   ✅ ${repo.name}`);
      } catch (err) {
        console.error(
          `   [RepoResp]   ❌ ${repo.name}: failed to calculate responsibility:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private collectServiceContext(
    repositoryId: string,
    services: CodeService[],
  ): Array<{ name: string; description: string; businessValue: string; techStack: string[]; patterns: string[] }> {
    return services
      .filter(s => s.repositoryId === repositoryId)
      .map(s => ({
        name: s.name,
        description: s.serviceAnalysis?.serviceDescription || s.responsibility || '',
        businessValue: s.serviceAnalysis?.businessValue || '',
        techStack: s.serviceAnalysis?.techStack || s.techStack || [],
        patterns: s.serviceAnalysis?.architecturalPatterns || [],
      }))
      .filter(s => s.description || s.businessValue);
  }

  private collectArtifactContext(
    repositoryId: string,
    builds: BuildArtifact[],
    deployments: DeploymentArtifact[],
  ): { builds: string[]; deployments: string[] } {
    return {
      builds: builds
        .filter(b => b.repositoryId === repositoryId && b.responsibility)
        .map(b => `${b.name}: ${b.responsibility}`),
      deployments: deployments
        .filter(d => d.repositoryId === repositoryId && d.responsibility)
        .map(d => `${d.name}: ${d.responsibility}`),
    };
  }

  private async synthesiseResponsibility(
    repoName: string,
    serviceContext: Array<{ name: string; description: string; businessValue: string; techStack: string[]; patterns: string[] }>,
    artifactContext: { builds: string[]; deployments: string[] },
    briefing?: RepositoryBriefing,
  ): Promise<string> {
    const hasContext = serviceContext.length > 0 ||
      artifactContext.builds.length > 0 ||
      artifactContext.deployments.length > 0 ||
      !!briefing;

    if (!this.api || !hasContext) {
      return this.buildFallbackResponsibility(repoName, briefing, serviceContext);
    }

    const prompt = this.buildPrompt(repoName, serviceContext, artifactContext, briefing);
    const completionTool = new PlannedTaskCompletionTool({
      responsibility: '1-2 sentence repository-level responsibility description',
    });
    const task = new Task(this.api, {
      mode: MODES.RESPONSIBILITY_EXTRACTION,
      tools: [completionTool],
      maxIterations: 5,
    });

    const result = await task.execute<{ responsibility: string }>(prompt);

    if (!result.success || !result.requiredOutput) {
      return this.buildFallbackResponsibility(repoName, briefing, serviceContext);
    }

    return (result.requiredOutput as any).responsibility
      || this.buildFallbackResponsibility(repoName, briefing, serviceContext);
  }

  private buildPrompt(
    repoName: string,
    serviceContext: Array<{ name: string; description: string; businessValue: string; techStack: string[]; patterns: string[] }>,
    artifactContext: { builds: string[]; deployments: string[] },
    briefing?: RepositoryBriefing,
  ): string {
    const lines: string[] = [
      `You are summarising the repository "${repoName}" based on its components.`,
      `Write a single 1-2 sentence responsibility description for the REPOSITORY AS A WHOLE.`,
      `Capture what the repository delivers end-to-end, not a list of every component.`,
      ``,
    ];

    if (briefing) {
      lines.push('Repository overview:');
      lines.push(`  Summary: ${briefing.summary}`);
      lines.push(`  Languages: ${briefing.languages.join(', ')}`);
      lines.push(`  Frameworks: ${briefing.frameworks.join(', ')}`);
      lines.push(`  Architecture: ${briefing.architecturalPatterns.join(', ')}`);
      lines.push(`  Deployment: ${briefing.deploymentTargets.join(', ')}`);
      lines.push('');
    }

    if (serviceContext.length > 0) {
      lines.push('Services:');
      serviceContext.forEach(s => {
        const tech = s.techStack.length > 0 ? ` [${s.techStack.slice(0, 3).join(', ')}]` : '';
        lines.push(`  - ${s.name}${tech}: ${s.description}`);
        if (s.businessValue) lines.push(`    Business value: ${s.businessValue}`);
      });
      lines.push('');
    }

    if (artifactContext.builds.length > 0) {
      lines.push('Build artifacts:');
      artifactContext.builds.forEach(r => lines.push(`  - ${r}`));
      lines.push('');
    }

    if (artifactContext.deployments.length > 0) {
      lines.push('Deployment artifacts:');
      artifactContext.deployments.forEach(r => lines.push(`  - ${r}`));
      lines.push('');
    }

    lines.push(
      'Write a concise 1-2 sentence repository responsibility.',
      'Call complete_task with the result.',
    );

    return lines.join('\n');
  }

  private buildFallbackResponsibility(
    repoName: string,
    briefing?: RepositoryBriefing,
    serviceContext?: Array<{ name: string; description: string }>,
  ): string {
    if (briefing?.summary) return briefing.summary;

    if (serviceContext && serviceContext.length > 0) {
      const serviceNames = serviceContext.map(s => s.name).join(', ');
      return `Repository "${repoName}" containing ${serviceContext.length} service(s): ${serviceNames}.`;
    }

    return `Source code repository: ${repoName}.`;
  }

  private async persist(repo: CodeRepository): Promise<void> {
    const updated: CodeRepository = { ...repo, updatedAt: new Date().toISOString() };

    if (this.qdrant) {
      try {
        await this.qdrant.storeEntity(updated);
      } catch (err) {
        console.error(
          `   [RepoResp] ⚠️  Qdrant: failed to persist responsibility for "${repo.name}":`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    if (this.neo4j) {
      try {
        await this.neo4j.storeEntity(updated);
      } catch (err) {
        console.error(
          `   [RepoResp] ⚠️  Neo4j: failed to persist responsibility for "${repo.name}":`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }
}
