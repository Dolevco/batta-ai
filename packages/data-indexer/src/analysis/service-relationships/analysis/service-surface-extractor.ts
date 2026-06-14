/**
 * ServiceSurfaceExtractor
 *
 * Orchestrates Pass 2: reads the config and client files identified in the
 * file map — and, for each internal sibling library, its package.json and
 * client/connector files — to exhaustively enumerate the service's full
 * external surface in a single agent call.
 *
 * When previously-completed sibling surfaces are available (because those
 * services were analysed earlier in dependency order), they are injected as
 * structured context so the agent does not need to re-read those libraries.
 *
 * Security:
 *   - Agent reads only config + client files — no route or model files.
 *   - Evidence fields are validated to contain only key names (not values).
 *   - Output is sanitized via sanitizeMetadata before use.
 *   - Errors are logged with only the message string.
 *   - Known sibling surfaces injected as context never include secret values.
 */

import type {
  CodeService,
  RepositoryBriefing,
  ServiceExternalSurface,
  ServiceFileMap,
  ServiceSkeleton,
} from '@batta/shared';
import { sanitizeMetadata } from '../../../utils/secret-sanitizer';
import type { ServiceExternalSurfaceInput } from '../../../agents/tools/serviceExternalSurfaceCompletionTool';
import { DataIndexerAgentRegistry, DataIndexerAgentType } from '../../../agents';

export class ServiceSurfaceExtractor {
  constructor(
    private readonly registry: DataIndexerAgentRegistry,
  ) {}

  /**
   * Run Pass 2: enumerate the service's full external surface.
   *
   * Reads the service's own config + client files, and also scans the
   * package.json and client/connector files of each internal sibling library
   * listed in the skeleton's `internalDependencies`. If a sibling's surface
   * was already computed (because it was analysed earlier in dependency order)
   * it is passed as structured context instead of being re-read from disk.
   *
   * @param service           - The service to analyse.
   * @param fileMap           - File map from Pass 0.
   * @param skeleton          - Skeleton from Pass 1 (orientation context).
   * @param repositoryPath    - Absolute path to the repository root.
   * @param briefing          - Optional repository briefing.
   * @param knownSiblings     - Map of serviceName → already-computed surface
   *                            for sibling services that were processed first.
   * @returns                 Sanitized ServiceExternalSurface.
   */
  async extractSurface(
    service: CodeService,
    fileMap: ServiceFileMap,
    _skeleton: ServiceSkeleton,
    repositoryPath: string,
    briefing?: RepositoryBriefing,
    knownSiblings: Map<string, ServiceExternalSurface> = new Map(),
  ): Promise<ServiceExternalSurface> {
    const servicePath = (service.metadata?.codePath as string) || service.codePath || '';

    const surfaceFilesList = buildSurfaceFilesList(fileMap);
    const skeletonContext = buildSkeletonContext(_skeleton);
    const siblingsContext = buildSiblingsContext(_skeleton.internalDependencies, knownSiblings);
    const briefingHint = briefing
      ? `\nRepository: ${briefing.summary}`
      : '';

    const task = this.registry.createTask(DataIndexerAgentType.ServiceExternalSurface, {
      workspace: repositoryPath,
    });

    const result = await task.execute<ServiceExternalSurfaceInput>(
      `Enumerate the complete external surface of service "${service.name}" at "${servicePath}".` +
      briefingHint + `\n\n` +
      `SKELETON CONTEXT (from Pass 1):\n${skeletonContext}\n\n` +
      `READ ONLY these files for this service (config + clients from the file map, plus package.json):\n` +
      surfaceFilesList + `\n\n` +
      siblingsContext +
      `SECURITY: evidence fields must contain only env var KEY NAMES and import/package names — ` +
      `NEVER actual secret values, connection strings, or tokens.\n\n` +
      `Call complete_service_external_surface when done.`,
    );

    if (!result.requiredOutput) {
      console.warn(`   [Pass 2] Surface extractor produced no output for "${service.name}", using skeleton deps`);
      return this.buildFallbackSurface();
    }

    const raw = result.requiredOutput as unknown as ServiceExternalSurfaceInput;
    const sanitized = sanitizeMetadata(raw as unknown as Record<string, unknown>);
    return (sanitized as unknown as ServiceExternalSurfaceInput).surface;
  }

  private buildFallbackSurface(): ServiceExternalSurface {
    return {
      externalDeps: [],
      trustBoundaryMap: { IDENTITY: [], DATA: [], EXTERNAL: [], INTERNET: [], SERVICE: [] },
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildSurfaceFilesList(fileMap: ServiceFileMap): string {
  const { config, clients } = fileMap.priorityFiles;
  const lines: string[] = ['- package.json (always)'];

  if (config.length > 0) {
    lines.push('Config/env files:');
    config.forEach(f => lines.push(`  - ${f}`));
  }
  if (clients.length > 0) {
    lines.push('Client/SDK files:');
    clients.forEach(f => lines.push(`  - ${f}`));
  }

  return lines.join('\n');
}

function buildSkeletonContext(skeleton: ServiceSkeleton): string {
  const lines: string[] = [
    `Description: ${skeleton.serviceDescription}`,
    `Tech stack: ${skeleton.techStack.join(', ')}`,
    `Entry point types: ${skeleton.entryPointTypes.join(', ')}`,
  ];
  if (skeleton.internalDependencies.length > 0) {
    lines.push(`Internal deps (sibling services): ${skeleton.internalDependencies.join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * Build the sibling-surfaces context block injected into the Pass 2 prompt.
 *
 * For sibling packages whose surface was already computed (processed earlier
 * in dependency order) we emit a structured summary so the LLM can treat their
 * external deps as transitive deps of the current service without re-reading
 * those files from disk.
 *
 * For siblings that have NOT been computed yet (e.g. circular or unresolved),
 * we instruct the agent to locate and read the library's package.json and
 * client/connector files itself.
 *
 * IMPORTANT: Only propagate transitive deps from siblings that are compiled/bundled
 * into the consuming service. Siblings that are separately-deployed and called over
 * a network boundary are an api dep — their internal infrastructure is not visible
 * to (and not a direct dep of) this service. The TOPOLOGY CHECK in the agent's
 * customInstructions is the primary guard; this context block reinforces it.
 */
function buildSiblingsContext(
  internalDeps: string[],
  knownSiblings: Map<string, ServiceExternalSurface>,
): string {
  if (internalDeps.length === 0) return '';

  const lines: string[] = [
    `INTERNAL SIBLING LIBRARIES (${internalDeps.length}):`,
    `These are internal packages that are compiled/bundled INTO this service.`,
    `Their external deps are ALSO part of this service's external surface — include them in the output.`,
    ``,
    `⚠️  Only propagate deps from siblings that are compiled-in libraries.`,
    `   If a sibling is a separately-deployed service called over a network boundary,`,
    `   record it as a single api dep — do NOT include its internal infrastructure.`,
    ``,
  ];

  const toScan: string[] = [];

  for (const dep of internalDeps) {
    const known = knownSiblings.get(dep);
    if (known && known.externalDeps.length > 0) {
      lines.push(`[${dep}] — surface already computed, ${known.externalDeps.length} external dep(s):`);
      for (const d of known.externalDeps) {
        lines.push(`  • ${d.name} (${d.type}): ${d.purpose}`);
      }
      lines.push('  → If compiled-in: include ALL of the above as transitive deps in your output.');
      lines.push('  → If separately-deployed (called over network): record as a single api dep only.');
    } else if (known) {
      lines.push(`[${dep}] — surface already computed, no external deps found.`);
    } else {
      lines.push(`[${dep}] — NOT yet computed → you must READ it:`);
      lines.push(`  ✅ Read: <workspace>/.../packages/<name>/package.json`);
      lines.push(`  ✅ Read: <workspace>/.../packages/<name>/src/clients/*.ts`);
      lines.push(`  ✅ Read: <workspace>/.../packages/<name>/src/connectors/*.ts`);
      lines.push(`  ✅ Read: <workspace>/.../packages/<name>/src/adapters/*.ts`);
      lines.push(`  ❌ Skip: route files, model files, test files`);
      toScan.push(dep);
    }
  }

  if (toScan.length > 0) {
    lines.push('');
    lines.push(`Libraries to scan: ${toScan.join(', ')}`);
    lines.push(
      'HOW TO LOCATE: Check pnpm-workspace.yaml or root package.json workspaces field. ' +
      'In a typical monorepo the path is packages/<short-name>/ or services/<short-name>/.',
    );
  }

  lines.push('');
  return lines.join('\n') + '\n';
}
