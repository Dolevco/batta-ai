/**
 * RepositoryBriefingService
 *
 * Produces a structured RepositoryBriefing by reading top-level manifest and
 * config files (README, package.json, docker-compose, IaC, etc.) via the
 * RepositoryBriefingAgent.
 *
 * The briefing is:
 *   1. Stored on the CodeRepository entity so it is visible
 *      in the UI and available in subsequent incremental runs.
 *   2. Returned to the task-processor and passed as shared context to all
 *      downstream agents (ServiceAnalyzer, BusinessFeatureExtractor,
 *      RepositoryResponsibilityCalculator).
 *
 * Security:
 *   - All LLM output is sanitized with sanitizeMetadata before storage.
 *   - Errors are logged with only the message string — no raw LLM response,
 *     no file content, no workspace paths.
 *   - The RepositoryBriefingCompletionTool rejects any field that looks like
 *     an actual secret value.
 *   - Classification: INTERNAL — no secret values may appear in stored fields.
 */

import type { CanonicalEntity, CodeRepository, RepositoryBriefing, TenantId } from '@batta/shared';
import { PostgresGraphAdapter, PostgresDataAdapter } from '@batta/shared';
import { sanitizeMetadata } from '../utils/secret-sanitizer';
import type { RepositoryBriefingInput } from '../agents/tools/repositoryBriefingCompletionTool';
import { DataIndexerAgentRegistry, DataIndexerAgentType } from '../agents';

export class RepositoryBriefingService {
  constructor(
    private readonly registry: DataIndexerAgentRegistry,
    private readonly dataAdapter?: PostgresDataAdapter,
    private readonly graphAdapter?: PostgresGraphAdapter,
  ) {}

  /**
   * Produce and persist a RepositoryBriefing for the repository in `entities`.
   *
   * @param tenantId       - Tenant identifier for multi-tenant isolation.
   * @param entities       - All entities from the current indexing run.
   * @param repositoryPath - Absolute path to the cloned repository root.
   * @returns              The produced RepositoryBriefing, or undefined on failure.
   */
  async produce(
    _tenantId: TenantId,
    entities: CanonicalEntity[],
    repositoryPath: string,
  ): Promise<RepositoryBriefing | undefined> {
    const repository = entities.find(
      (e): e is CodeRepository => e.entityType === 'code_repository',
    );

    if (!repository) {
      console.warn('   [RepoBriefing] No CodeRepository entity found — skipping briefing.');
      return undefined;
    }

    console.log(`   [RepoBriefing] Analysing repository structure for "${repository.name}"…`);

    try {
      const briefing = await this.runBriefingTask(repository.name, repositoryPath);

      // Update entity in-place so downstream pipeline stages see the briefing
      (repository as CodeRepository).repositoryBriefing = briefing;

      await this.persist(repository);

      console.log(
        `   [RepoBriefing]   ✅ ${repository.name}: ` +
        `${briefing.serviceNames.length} service(s), ` +
        `languages: ${briefing.languages.join(', ')}, ` +
        `patterns: ${briefing.architecturalPatterns.join(', ')}`,
      );

      return briefing;
    } catch (err) {
      // Non-fatal: downstream agents work without the briefing (degraded context).
      console.error(
        `   [RepoBriefing]   ❌ ${repository.name}: briefing failed:`,
        err instanceof Error ? err.message : String(err),
      );
      return undefined;
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async runBriefingTask(
    repositoryName: string,
    repositoryPath: string,
  ): Promise<RepositoryBriefing> {
    const task = this.registry.createTask(DataIndexerAgentType.RepositoryBriefing, {
      workspace: repositoryPath,
    });

    const result = await task.execute<RepositoryBriefingInput>(
      `Produce a structured RepositoryBriefing for the repository "${repositoryName}".\n\n` +
        `Read top-level manifest and config files (README.md, package.json, ` +
        `pnpm-workspace.yaml / lerna.json, docker-compose.yml, Dockerfiles, ` +
        `IaC files, and each package's package.json) to fill every field.\n\n` +
        `When done, call complete_repository_briefing.`,
    );

    if (!result.requiredOutput) {
      throw new Error('Repository briefing task produced no output.');
    }

    const output = result.requiredOutput as unknown as RepositoryBriefingInput;
    return sanitizeMetadata(
      output.repositoryBriefing as unknown as Record<string, unknown>,
    ) as unknown as RepositoryBriefing;
  }

  private async persist(repo: CodeRepository): Promise<void> {
    const updated: CodeRepository = { ...repo, updatedAt: new Date().toISOString() };

    if (this.dataAdapter) {
      try {
        await this.dataAdapter.storeEntity(updated);
      } catch (err) {
        console.error(
          `   [RepoBriefing] ⚠️  DataAdapter: failed to persist briefing for "${repo.name}":`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    if (this.graphAdapter) {
      try {
        await this.graphAdapter.storeEntity(updated);
      } catch (err) {
        console.error(
          `   [RepoBriefing] ⚠️  GraphAdapter: failed to persist briefing for "${repo.name}":`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }
}
