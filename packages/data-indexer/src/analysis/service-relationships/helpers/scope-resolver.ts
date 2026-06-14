/**
 * Scope Resolver
 *
 * Deterministic (non-LLM) extraction of deployment scopes from IaCAnalysis
 * results, and resolution of candidate cloud resources for correlation.
 *
 * Called after all analysis steps (0 and 0.5) are complete, before any
 * correlation step that touches cloud resources.
 *
 * Algorithm (applied per artifact, in priority order):
 *   1. Direct  — use deploymentTargets.resourceGroups if present
 *   2. Name matching — cross-reference deployedResources[].name against
 *                      known resource group names (substring match)
 *   3. Path heuristic — if codePath contains env indicator (prod/staging/dev),
 *                       use as environment filter
 *   4. Fallback — no scope → use full repository (logs a warning)
 *
 * Security:
 *   - Resource group names from IaCAnalysis are validated to be non-empty
 *     strings ≤ 90 chars (Azure RG name limit) before use in filtering.
 *   - The function never logs the full resource list — only counts.
 *   - allResourceGroups is derived from CloudResourceRepository.listResourceGroups()
 *     which is already lower-cased; no additional normalisation needed here.
 */

import type { DeploymentArtifact, CloudResource } from '@batta/shared';
import type { CloudResourceRepository } from '../../../cloud/repository/cloud-resource-repository';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Azure resource group name max length */
const MAX_RG_NAME_LENGTH = 90;

/** Environment keywords that appear in code paths */
const ENV_KEYWORDS = ['prod', 'production', 'staging', 'stage', 'dev', 'development', 'test', 'qa'];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DeploymentScope {
  /** ID of the source DeploymentArtifact */
  artifactId: string;
  /** Resolved resource groups for this artifact */
  resourceGroups: string[];
  /** Subscription ID if deterministically known */
  subscriptionId?: string;
  /** Regions if deterministically known */
  regions: string[];
  /** How the scope was resolved (for logging / debugging) */
  resolutionMethod: 'direct' | 'name-match' | 'path-heuristic' | 'fallback';
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a scope map from all analysed deployment artifacts.
 *
 * @param artifacts         - Deployment artifacts with iacAnalysis populated
 * @param allResourceGroups - All known RG names from CloudResourceRepository
 * @returns Map of artifactId → DeploymentScope
 */
export function extractDeploymentScopes(
  artifacts: DeploymentArtifact[],
  allResourceGroups: string[],
): Map<string, DeploymentScope> {
  const scopeMap = new Map<string, DeploymentScope>();
  // Lower-case the known RG names once for efficient comparison
  const knownRGs = new Set(allResourceGroups.map(rg => rg.toLowerCase()));

  for (const artifact of artifacts) {
    const scope = resolveArtifactScope(artifact, knownRGs);
    scopeMap.set(artifact.id, scope);
  }

  return scopeMap;
}

/**
 * Resolve the candidate cloud resources for a set of scopes.
 * Resources are de-duplicated by ID.
 *
 * @param scopes     - Deployment scopes to resolve candidates for
 * @param repository - CloudResourceRepository to query
 * @param maxTotal   - Maximum total candidates returned (default 100)
 */
export function resolveResourceCandidates(
  scopes: DeploymentScope[],
  repository: CloudResourceRepository,
  maxTotal: number = 100,
): CloudResource[] {
  const seen = new Set<string>();
  const results: CloudResource[] = [];

  for (const scope of scopes) {
    if (results.length >= maxTotal) break;

    if (scope.resourceGroups.length > 0) {
      const candidates = repository.query(
        { resourceGroups: scope.resourceGroups },
        Math.min(maxTotal - results.length, 50),
      );
      for (const r of candidates) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          results.push(r);
        }
      }
    } else if (scope.subscriptionId) {
      const candidates = repository.query(
        { subscriptionId: scope.subscriptionId },
        Math.min(maxTotal - results.length, 50),
      );
      for (const r of candidates) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          results.push(r);
        }
      }
    }
    // Fallback scopes have no resource groups — handled by the caller
  }

  return results;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function resolveArtifactScope(artifact: DeploymentArtifact, knownRGs: Set<string>): DeploymentScope {
  const analysis = artifact.iacAnalysis;

  // ── Strategy 1: Direct — deploymentTargets.resourceGroups ───────────────
  const directRGs = analysis?.deploymentTargets?.resourceGroups
    ?.map(rg => rg.toLowerCase().trim())
    .filter(rg => rg.length > 0 && rg.length <= MAX_RG_NAME_LENGTH);

  if (directRGs && directRGs.length > 0) {
    return {
      artifactId: artifact.id,
      resourceGroups: directRGs,
      subscriptionId: analysis?.deploymentTargets?.subscriptionIds?.[0]?.toLowerCase(),
      regions: analysis?.deploymentTargets?.regions ?? [],
      resolutionMethod: 'direct',
    };
  }

  // ── Strategy 2: Name matching — resource names ↔ known RG names ─────────
  const allResourceNames = [
    ...(analysis?.deployedResources ?? []),
    ...(analysis?.usedResources ?? []),
  ].map(r => r.name.toLowerCase());

  const nameMatchedRGs: string[] = [];
  for (const rg of knownRGs) {
    for (const resourceName of allResourceNames) {
      // Substring match in either direction — catches "rg-payments-prod" in "payments-prod-api"
      if (rg.includes(resourceName.split('-')[0]) || resourceName.includes(rg.split('-')[0])) {
        nameMatchedRGs.push(rg);
        break;
      }
    }
  }

  if (nameMatchedRGs.length > 0) {
    return {
      artifactId: artifact.id,
      resourceGroups: nameMatchedRGs,
      regions: analysis?.deploymentTargets?.regions ?? [],
      resolutionMethod: 'name-match',
    };
  }

  // ── Strategy 3: Path heuristic — env keyword in codePath ────────────────
  const codePathLower = artifact.codePath.toLowerCase();
  const matchedEnv = ENV_KEYWORDS.find(env => codePathLower.includes(env));

  if (matchedEnv) {
    const envMatchedRGs = [...knownRGs].filter(rg => rg.includes(matchedEnv));
    if (envMatchedRGs.length > 0) {
      return {
        artifactId: artifact.id,
        resourceGroups: envMatchedRGs,
        regions: [],
        resolutionMethod: 'path-heuristic',
      };
    }
  }

  // ── Strategy 4: Fallback — no scope ─────────────────────────────────────
  console.warn(
    `   [SRE] scope-resolver: no scope found for artifact "${artifact.name}" (${artifact.id.slice(0, 8)}…) — will use full resource list (${knownRGs.size} RGs)`,
  );

  return {
    artifactId: artifact.id,
    resourceGroups: [],
    regions: [],
    resolutionMethod: 'fallback',
  };
}
