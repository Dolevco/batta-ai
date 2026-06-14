/**
 * ServiceAnalyzer
 *
 * Orchestrates the 3-pass pre-analysis pipeline for a single CodeService:
 *
 *   Pass 0 – ServiceFileMapper        → ServiceFileMap   (cheap, no content reads)
 *   Pass 1 – ServiceSkeletonExtractor → ServiceSkeleton  (priority files only)
 *   Pass 2 – ServiceSurfaceExtractor  → ServiceExternalSurface
 *              Reads this service's config + client files AND, for each internal
 *              sibling library not yet computed, its package.json + client files.
 *              Pre-computed sibling surfaces are injected as structured context
 *              so the agent does not re-read already-analysed libraries.
 *
 * Callers that process services in dependency order (leaves first) should
 * populate `knownSiblings` with previously completed surfaces so that Pass 2
 * receives the richest possible context without redundant LLM calls.
 *
 * The composed ServiceAnalysis (skeleton + enriched surface) replaces the old
 * single-pass ServiceAnalyzer.
 *
 * Additionally, the skeleton's serviceDescription directly seeds
 * CodeService.responsibility, eliminating the separate CodeSemanticAnalysisStage
 * responsibility pass for services (Step 9 of the improvement plan).
 *
 * Security:
 *   - All LLM outputs are sanitized with sanitizeMetadata before use.
 *   - Errors are logged with only the message string.
 *   - No secret values flow through any pass — only key names and file paths.
 *   - Repository briefing context (if provided) is injected as read-only orientation.
 *   - knownSiblings surfaces are sanitized before they were stored; no re-sanitization needed.
 */

import type {
  CodeService,
  ExternalDep,
  RepositoryBriefing,
  ServiceAnalysis,
  ServiceExternalSurface,
  ServiceFileMap,
  ServiceSkeleton,
} from '@batta/shared';
import { DataIndexerAgentRegistry } from '../../../agents';
import { ServiceFileMapper } from './service-file-mapper';
import { ServiceSkeletonExtractor } from './service-skeleton-extractor';
import { ServiceSurfaceExtractor } from './service-surface-extractor';

export class ServiceAnalyzer {
  private readonly fileMapper: ServiceFileMapper;
  private readonly skeletonExtractor: ServiceSkeletonExtractor;
  private readonly surfaceExtractor: ServiceSurfaceExtractor;

  constructor(registry: DataIndexerAgentRegistry) {
    this.fileMapper = new ServiceFileMapper(registry);
    this.skeletonExtractor = new ServiceSkeletonExtractor(registry);
    this.surfaceExtractor = new ServiceSurfaceExtractor(registry);
  }

  /**
   * Run the 3-pass pipeline for a single CodeService.
   *
   * Returns a composed ServiceAnalysis (skeleton + surface), along with the
   * raw ServiceFileMap, ServiceSkeleton, and ServiceExternalSurface so that
   * the caller can persist them separately on the CodeService entity.
   *
   * @param service        - The service to analyse.
   * @param repositoryPath - Absolute path to the repository root (workspace).
   * @param briefing       - Optional repository briefing for orientation context.
   * @param knownSiblings  - Map of serviceName → completed ServiceExternalSurface
   *                         for sibling services already processed this run.
   *                         Pass 2 injects these as context so transitive deps from
   *                         known siblings do not require re-reading files.
   */
  async analyzeService(
    service: CodeService,
    repositoryPath: string,
    briefing?: RepositoryBriefing,
    knownSiblings: Map<string, ServiceExternalSurface> = new Map(),
  ): Promise<ServiceAnalysis & {
    _fileMap: ServiceFileMap;
    _skeleton: ServiceSkeleton;
    _surface: ServiceExternalSurface;
  }> {
    const serviceName = service.name;

    // ── Pass 0: File Map ───────────────────────────────────────────────────
    console.log(`   [SRE/Pass 0] File mapper → "${serviceName}"`);
    let fileMap: ServiceFileMap;
    try {
      fileMap = await this.fileMapper.mapServiceFiles(service, repositoryPath, briefing);
      const totalPriority =
        fileMap.priorityFiles.entry.length + fileMap.priorityFiles.routes.length +
        fileMap.priorityFiles.models.length + fileMap.priorityFiles.types.length +
        fileMap.priorityFiles.config.length + fileMap.priorityFiles.clients.length;
      console.log(
        `   [SRE/Pass 0]   ✅ "${serviceName}": ` +
        `${totalPriority} priority files, ${fileMap.totalFiles} total`,
      );
    } catch (err) {
      console.error(
        `   [SRE/Pass 0]   ❌ "${serviceName}": file mapper failed:`,
        err instanceof Error ? err.message : String(err),
      );
      fileMap = { priorityFiles: { entry: [], routes: [], models: [], types: [], config: [], clients: [] }, skipFiles: [], estimatedSignalFiles: 0, totalFiles: 0 };
    }

    // ── Pass 1: Skeleton ───────────────────────────────────────────────────
    console.log(`   [SRE/Pass 1] Skeleton extractor → "${serviceName}"`);
    let skeleton: ServiceSkeleton;
    try {
      skeleton = await this.skeletonExtractor.extractSkeleton(service, fileMap, repositoryPath, briefing);
      console.log(
        `   [SRE/Pass 1]   ✅ "${serviceName}": ` +
        `${skeleton.exposedEndpoints.length} endpoint(s), ` +
        `${skeleton.dataModels.length} model(s), ` +
        `tech: ${skeleton.techStack.slice(0, 3).join(', ')}`,
      );
    } catch (err) {
      console.error(
        `   [SRE/Pass 1]   ❌ "${serviceName}": skeleton extractor failed:`,
        err instanceof Error ? err.message : String(err),
      );
      skeleton = this.skeletonExtractor['buildFallbackSkeleton'](service);
    }

    // ── Pass 2: External Surface ───────────────────────────────────────────
    // Reads this service's config + client files AND, for any unresolved
    // internal sibling libraries, their package.json + client files.
    // knownSiblings surfaces are injected as structured context in the prompt.
    const siblingCount = skeleton.internalDependencies.length;
    const knownCount = skeleton.internalDependencies.filter(d => knownSiblings.has(d)).length;
    console.log(
      `   [SRE/Pass 2] Surface extractor → "${serviceName}" ` +
      `(${siblingCount} sibling(s): ${knownCount} known, ${siblingCount - knownCount} to scan)`,
    );
    let surface: ServiceExternalSurface;
    try {
      surface = await this.surfaceExtractor.extractSurface(
        service, fileMap, skeleton, repositoryPath, briefing, knownSiblings,
      );
      console.log(
        `   [SRE/Pass 2]   ✅ "${serviceName}": ` +
        `${surface.externalDeps.length} external dep(s), ` +
        `IDENTITY: [${surface.trustBoundaryMap.IDENTITY.join(', ')}], ` +
        `DATA: [${surface.trustBoundaryMap.DATA.join(', ')}]`,
      );
    } catch (err) {
      console.error(
        `   [SRE/Pass 2]   ❌ "${serviceName}": surface extractor failed:`,
        err instanceof Error ? err.message : String(err),
      );
      surface = { externalDeps: [], trustBoundaryMap: { IDENTITY: [], DATA: [], EXTERNAL: [], INTERNET: [], SERVICE: [] } };
    }

    // ── Compose ServiceAnalysis ────────────────────────────────────────────
    const analysis = this.composeServiceAnalysis(skeleton, surface);

    return { ...analysis, _fileMap: fileMap, _skeleton: skeleton, _surface: surface };
  }

  /**
   * Compose a ServiceAnalysis from a skeleton and an external surface.
   * The skeleton covers code structure; the surface covers external deps.
   */
  private composeServiceAnalysis(
    skeleton: ServiceSkeleton,
    surface: ServiceExternalSurface,
  ): ServiceAnalysis {
    return {
      serviceDescription: skeleton.serviceDescription,
      businessValue: skeleton.businessValue,
      techStack: skeleton.techStack,
      codeStructure: skeleton.exposedEndpoints.length > 0
        ? `Exposes ${skeleton.exposedEndpoints.length} endpoint(s): ${skeleton.exposedEndpoints.slice(0, 3).map(e => e.path).join(', ')}${skeleton.exposedEndpoints.length > 3 ? '...' : ''}`
        : `Entry types: ${skeleton.entryPointTypes.join(', ')}`,
      externalDeps: surface.externalDeps as ExternalDep[],
      internalDependencies: skeleton.internalDependencies,
      entryPointTypes: skeleton.entryPointTypes,
      architecturalPatterns: skeleton.architecturalPatterns,
    };
  }

  /**
   * Build a responsibility string from a ServiceAnalysis.
   * Used to populate CodeService.responsibility for semantic search.
   * Seeded from the skeleton's serviceDescription — no extra LLM call needed.
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
}
