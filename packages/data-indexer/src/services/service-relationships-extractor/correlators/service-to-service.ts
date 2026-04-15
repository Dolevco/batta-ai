/**
 * ServiceCallCorrelator (Step 2.6)
 *
 * Joins ExternalDep.endpoints[] from consumer services against
 * ServiceSkeleton.exposedEndpoints[] from provider services to emit
 * CALLS_SERVICE and CALLS_API relationships.
 *
 * Two sub-steps:
 *
 *   3a. Deterministic path matching
 *       - Strips optional HTTP method prefix from called paths.
 *       - Normalises parameterised segments (/:id → /:param) before comparing.
 *       - Scores each candidate provider by number of matched endpoints.
 *       - Requires minimum score ≥ 2 (or 30 % of called paths) to emit edges.
 *         A single common path like /health is ambiguous; two or more specific
 *         paths (/tasks + /chat) are strong evidence of an intentional relationship.
 *
 *   3b. LLM disambiguation (ambiguous / zero-match fallback)
 *       Invoked when:
 *         - Deterministic matching produces a tie (two providers with equal score).
 *         - endpoints[] is empty but dep.type === 'api' and dep.resourceName is set.
 *         - Score is exactly 1 (too low to be confident).
 *       The agent receives only structured data — no file reading needed.
 *
 * Relationship types emitted:
 *   CALLS_SERVICE — service-level: consumer → provider (one per dep / provider pair)
 *   CALLS_API     — endpoint-level: one per matched method+path pair
 *
 * Security:
 *   - No file system access — operates only on in-memory service structs.
 *   - Relationship metadata is sanitized by makeRelationship() before storage.
 *   - LLM prompt is composed only from INTERNAL-classified structural metadata.
 *   - Service IDs are validated to be non-empty before emitting edges.
 *   - Classification: INTERNAL — service names, IDs, and path strings only.
 */

import type { CodeService, Relationship, TenantId } from '@ai-agent/shared';
import { makeRelationship } from '../helpers/utils';
import type { DataIndexerAgentRegistry } from '../../../agents/registry';
import { DataIndexerAgentType } from '../../../agents';
import type { ServiceCallCorrelationInput } from '../../../agents/tools/serviceCallCorrelatorCompletionTool';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Minimum number of matched endpoints to emit a CALLS_SERVICE relationship. */
const MIN_MATCH_SCORE = 2;

/** Minimum match fraction (relative to called paths count) for low-path-count consumers. */
const MIN_MATCH_FRACTION = 0.3;

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Correlate service-to-service calls by matching ExternalDep.endpoints[]
 * against ServiceSkeleton.exposedEndpoints[].
 *
 * Runs after all services have completed Pass 2 (ServiceExternalSurface is populated).
 *
 * @param services  All CodeService entities (with serviceSkeleton + serviceExternalSurface).
 * @param tenantId  The tenant context.
 * @param registry  Agent registry for LLM fallback disambiguation.
 */
export async function correlateServiceCalls(
  services: CodeService[],
  tenantId: TenantId,
  registry: DataIndexerAgentRegistry,
): Promise<Relationship[]> {
  const relationships: Relationship[] = [];
  const serviceById = new Map(services.map(s => [s.id, s]));

  for (const consumer of services) {
    const surface = consumer.serviceExternalSurface;
    if (!surface?.externalDeps?.length) continue;

    for (const dep of surface.externalDeps) {
      if (dep.type !== 'api') continue;

      const calledPaths = normaliseCalledPaths(dep.endpoints ?? []);
      // resourceName for api deps is the base path prefix the consumer uses
      // (e.g. "/api" or "/api/v1"), recorded by the surface extractor agent.
      const hintPrefix = dep.resourceName?.trim() || undefined;

      // ── 3a. Deterministic path matching ──────────────────────────────────
      const scores = scoreProviders(consumer, calledPaths, services, hintPrefix);
      const topScore = scores.length > 0 ? scores[0].score : 0;

      // Minimum threshold: ≥ MIN_MATCH_SCORE absolute OR ≥ MIN_MATCH_FRACTION of called paths.
      const threshold = Math.max(
        MIN_MATCH_SCORE,
        Math.ceil((calledPaths.length || 1) * MIN_MATCH_FRACTION),
      );
      const confident = scores.filter(s => s.score >= threshold);

      if (confident.length === 1) {
        // Unambiguous high-confidence match — emit relationships deterministically.
        const best = confident[0];
        relationships.push(...buildRelationships(tenantId, consumer, best.service, best.matches, 'heuristic'));
        continue;
      }

      if (confident.length > 1) {
        // Tie — fall back to LLM disambiguation.
        const resolved = await disambiguateWithLLM(
          consumer, dep, confident.map(s => s.service), registry,
        );
        if (resolved) {
          const provider = serviceById.get(resolved.providerId);
          if (provider) {
            relationships.push(
              ...buildRelationships(
                tenantId, consumer, provider, resolved.matchedPaths,
                resolved.confidence === 'high' ? 'heuristic' : 'heuristic',
              ),
            );
          }
        }
        continue;
      }

      // ── 3b. LLM fallback: no good deterministic match ──────────────────────
      // Invoke when endpoints[] is empty but dep.resourceName is set, or when
      // we got a single low-confidence match (score = 1).
      const shouldFallback =
        (calledPaths.length === 0 && dep.resourceName) ||
        (scores.length > 0 && scores[0].score === 1);

      if (shouldFallback) {
        const candidates = services.filter(s => s.id !== consumer.id);
        const resolved = await disambiguateWithLLM(consumer, dep, candidates, registry);
        if (resolved) {
          const provider = serviceById.get(resolved.providerId);
          if (provider) {
            relationships.push(
              ...buildRelationships(
                tenantId, consumer, provider, resolved.matchedPaths, 'heuristic',
              ),
            );
          }
        }
      }
    }
  }

  return relationships;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

interface ProviderScore {
  service: CodeService;
  score: number;
  matches: string[];
}

/**
 * Strip optional HTTP method prefix from called paths and normalise
 * parameterised segments so "/tasks/abc123" and "/tasks/:id" compare equal.
 */
function normaliseCalledPaths(endpoints: string[]): string[] {
  return endpoints.map(e =>
    e
      .replace(/^(GET|POST|PUT|DELETE|PATCH)\s+/i, '')
      .trim()
      .replace(/\/[^/]+(?=\/|$)/g, seg =>
        // Treat path segments that look like IDs as :param
        /^\/[a-f0-9]{24}$|^\/\d+$|^\/[a-zA-Z0-9_-]{20,}$/.test(seg) ? '/:param' : seg,
      )
      .replace(/\/:([^/]+)/g, '/:param'),
  );
}

/**
 * Normalise an exposedEndpoint path for comparison (same rules as caller paths).
 * Also normalises wildcard segments (*) to /:param so they match normalised called paths.
 */
function normaliseProviderPath(path: string): string {
  return path
    .replace(/\/:([^/]+)/g, '/:param')
    .replace(/\/\*/g, '/:param');
}

/**
 * Score all candidate providers for a given consumer dep.
 * Returns sorted descending by score.
 *
 * Matching strategy (applied in order, best result wins):
 *   1. Direct path match — normalised called path equals normalised provider path.
 *   2. Prefix-stripped match — provider exposes paths under a consistent prefix
 *      (e.g. "/api" or "/api/v1") absent from the called paths.
 *      The prefix to try comes from (in priority order):
 *        a. hintPrefix — the dep.resourceName recorded by the surface extractor
 *           (authoritative: the consumer told us what prefix it strips).
 *        b. Inference — derived from the first endpoint where
 *           `providerNorm === somePrefix + calledPath` exactly.
 *      Once a prefix is established it must be consistent across all matches.
 */
function scoreProviders(
  consumer: CodeService,
  calledPaths: string[],
  services: CodeService[],
  hintPrefix?: string,
): ProviderScore[] {
  if (calledPaths.length === 0) return [];

  const scores: ProviderScore[] = [];

  for (const provider of services) {
    if (provider.id === consumer.id) continue;

    const skeleton = provider.serviceSkeleton;
    if (!skeleton?.exposedEndpoints?.length) continue;
    if (!skeleton.entryPointTypes?.includes('http')) continue;

    const normProviderPaths = skeleton.exposedEndpoints.map(ep => ({
      ep,
      norm: normaliseProviderPath(ep.path),
    }));

    // ── Pass 1: direct match ────────────────────────────────────────────────
    const directMatches: string[] = [];
    const unmatchedAfterDirect: string[] = [];

    for (const calledPath of calledPaths) {
      let hit = false;
      for (const { ep, norm } of normProviderPaths) {
        if (
          norm === calledPath ||
          norm.startsWith(calledPath + '/') ||
          calledPath.startsWith(norm + '/')
        ) {
          directMatches.push(`${ep.method} ${ep.path}`);
          hit = true;
          break;
        }
      }
      if (!hit) unmatchedAfterDirect.push(calledPath);
    }

    // ── Pass 2: prefix-stripped match for remaining called paths ───────────
    // If dep.resourceName supplied a hint prefix (e.g. "/api"), use it directly.
    // Otherwise infer the prefix from the first endpoint where
    //   providerNorm === candidatePrefix + calledPath   (exact, no substring ambiguity).
    // Once a prefix is established it must be consistent across all matched endpoints.
    let activePrefix: string | null = hintPrefix ?? null;
    const prefixMatches: string[] = [];

    for (const calledPath of unmatchedAfterDirect) {
      let hit = false;
      for (const { ep, norm } of normProviderPaths) {
        if (activePrefix !== null) {
          // We have a prefix — require an exact match: norm === prefix + calledPath.
          // Also accept prefix + calledPath + '/' for sub-path containment.
          if (norm !== activePrefix + calledPath && !norm.startsWith(activePrefix + calledPath + '/')) {
            continue;
          }
        } else {
          // No prefix yet — infer it: norm must be exactly somePrefix + calledPath.
          // Both norm and calledPath start with '/', so the prefix is whatever comes
          // before calledPath in norm (e.g. norm="/api/foo", calledPath="/foo" → prefix="/api").
          if (!norm.endsWith(calledPath) && !norm.startsWith(norm.slice(0, norm.indexOf(calledPath)) + calledPath + '/')) continue;
          const candidate = norm.slice(0, norm.length - calledPath.length);
          // Verify the full reconstruction is exact (guards against partial segment matches).
          if (candidate + calledPath !== norm) continue;
          if (!candidate) continue; // no prefix at all — would have matched in Pass 1
          activePrefix = candidate;
        }

        prefixMatches.push(`${ep.method} ${ep.path}`);
        hit = true;
        break;
      }
      void hit; // partial coverage under an established prefix is fine
    }

    const matches = [...directMatches, ...prefixMatches];
    if (matches.length > 0) {
      scores.push({ service: provider, score: matches.length, matches });
    }
  }

  return scores.sort((a, b) => b.score - a.score);
}

/**
 * Build CALLS_SERVICE + CALLS_API relationships for a confirmed consumer→provider pair.
 *
 * Security: service IDs are validated as non-empty before use in relationship IDs.
 *   All metadata is INTERNAL-classified (service names, paths, scores).
 */
function buildRelationships(
  tenantId: TenantId,
  consumer: CodeService,
  provider: CodeService,
  matchedEndpoints: string[],
  confidence: 'heuristic' | 'deterministic',
): Relationship[] {
  // Guard: never emit relationships with empty IDs.
  if (!consumer.id?.trim() || !provider.id?.trim()) return [];

  const rels: Relationship[] = [];

  // Service-level: one edge per consumer→provider pair.
  rels.push(makeRelationship(tenantId, 'CALLS_SERVICE', consumer.id, provider.id, {
    matchedEndpoints,
    score: matchedEndpoints.length,
    totalCalledPaths: matchedEndpoints.length,
    confidence,
    correlatedBy: 'ServiceCallCorrelator',
    // Classification: INTERNAL
    dataClassification: 'internal',
  }));

  // Endpoint-level: one CALLS_API edge per matched method+path.
  for (const match of matchedEndpoints) {
    const spaceIdx = match.indexOf(' ');
    const method = spaceIdx > 0 ? match.slice(0, spaceIdx).toUpperCase() : 'UNKNOWN';
    const path   = spaceIdx > 0 ? match.slice(spaceIdx + 1) : match;

    rels.push(makeRelationship(tenantId, 'CALLS_API', consumer.id, provider.id, {
      method,
      path,
      correlatedBy: 'ServiceCallCorrelator',
      // Classification: INTERNAL — path template only, no concrete request data.
      dataClassification: 'internal',
    }));
  }

  return rels;
}

/**
 * Invoke the ServiceCallCorrelatorAgent to disambiguate among candidate providers.
 *
 * The prompt is composed from INTERNAL-classified structural data only — no
 * file contents, no secret values. Classification: INTERNAL.
 */
async function disambiguateWithLLM(
  consumer: CodeService,
  dep: {
    name: string;
    type: string;
    resourceName?: string;
    endpoints?: string[];
    evidence?: string;
    purpose?: string;
  },
  candidates: CodeService[],
  registry: DataIndexerAgentRegistry,
): Promise<ServiceCallCorrelationInput | null> {
  if (candidates.length === 0) return null;

  try {
    const prompt = buildDisambiguationPrompt(consumer, dep, candidates);
    const task = registry.createTask(DataIndexerAgentType.ServiceCallCorrelator);
    const result = await task.execute<ServiceCallCorrelationInput>(prompt);
    const output = result?.requiredOutput as ServiceCallCorrelationInput | undefined;

    // Validate the returned IDs are within the candidate set (injection guard).
    if (!output) return null;
    const validProviderIds = new Set(candidates.map(c => c.id));
    if (!validProviderIds.has(output.providerId)) {
      console.warn(
        `   [SRE]   ⚠️  ServiceCallCorrelator: LLM returned unknown providerId "${output.providerId}" — discarding.`,
      );
      return null;
    }

    return output;
  } catch (err) {
    // Log only the error message — no stack traces or internal paths.
    console.error(
      `   [SRE]   ⚠️  ServiceCallCorrelator: LLM disambiguation failed:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * Build the structured disambiguation prompt for the LLM agent.
 * Only INTERNAL-classified data is included: service names, IDs, paths, tech stacks.
 * No file contents, secrets, or user-supplied free-text are included.
 */
function buildDisambiguationPrompt(
  consumer: CodeService,
  dep: {
    name: string;
    type: string;
    resourceName?: string;
    endpoints?: string[];
    evidence?: string;
    purpose?: string;
  },
  candidates: CodeService[],
): string {
  const lines: string[] = [
    `CONSUMER SERVICE`,
    `  Name:        ${consumer.name}`,
    `  ID:          ${consumer.id}`,
    `  Tech Stack:  ${consumer.techStack?.join(', ') || consumer.serviceSkeleton?.techStack?.join(', ') || 'unknown'}`,
    `  Entry Points:${consumer.serviceSkeleton?.entryPointTypes?.join(', ') || 'unknown'}`,
    ``,
    `EXTERNAL DEP`,
    `  Name:         ${dep.name}`,
    `  Type:         ${dep.type}`,
    `  ResourceName: ${dep.resourceName || '(not set)'}`,
    `  Endpoints:    ${dep.endpoints?.join(', ') || '(none)'}`,
    `  Evidence:     ${dep.evidence || '(none)'}`,
    `  Purpose:      ${dep.purpose || '(none)'}`,
    ``,
    `CANDIDATE PROVIDERS (choose one)`,
  ];

  for (const candidate of candidates) {
    const skeleton = candidate.serviceSkeleton;
    const eps = skeleton?.exposedEndpoints?.slice(0, 15).map(e => `${e.method} ${e.path}`).join(', ') || '(none)';
    lines.push(
      `  - Name:        ${candidate.name}`,
      `    ID:          ${candidate.id}`,
      `    Entry Points:${skeleton?.entryPointTypes?.join(', ') || 'unknown'}`,
      `    Tech Stack:  ${candidate.techStack?.join(', ') || skeleton?.techStack?.join(', ') || 'unknown'}`,
      `    Endpoints:   ${eps}`,
      ``,
    );
  }

  lines.push(
    `Which candidate is the provider for the "${dep.name}" dep?`,
    `Call complete_service_call_correlation with your decision.`,
  );

  return lines.join('\n');
}
