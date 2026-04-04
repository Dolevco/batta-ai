/**
 * CloudResourceRepository
 *
 * In-memory indexed store for cloud resources.  Built once after Stage 2 and
 * queried throughout Stage 4 instead of passing the flat array around.
 *
 * Design goals:
 *   - query() is always bounded (maxResults default = 50) so the LLM never
 *     receives an unbounded 800-resource context window.
 *   - All filter strings are normalised to lower-case before comparison so
 *     resource group matching is case-insensitive (Azure is case-insensitive).
 *   - getAll() is intentionally available but callers should prefer query().
 *
 * Security:
 *   - Input filter values are length-capped (MAX_FILTER_STRING_LENGTH) to prevent
 *     excessively long strings from being used in substring searches.
 *   - No secret material is stored or returned; this only wraps CloudResource
 *     objects which are already classified INTERNAL.
 *   - maxResults is capped at MAX_RESULTS_CAP to prevent callers from requesting
 *     unbounded result sets.
 */

import type { CloudResource } from '@ai-agent/shared';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Hard cap on results per query to prevent unbounded LLM context. */
const MAX_RESULTS_CAP = 200;

/** Default results per query. */
const DEFAULT_MAX_RESULTS = 50;

/** Maximum length for filter string values — prevents excessive substring searches. */
const MAX_FILTER_STRING_LENGTH = 256;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CloudResourceFilter {
  subscriptionId?: string;
  /** Case-insensitive exact match against CloudResource.resourceGroup */
  resourceGroup?: string;
  /** Match any of these resource groups (case-insensitive) */
  resourceGroups?: string[];
  resourceType?: CloudResource['resourceType'];
  /** Case-insensitive substring match against CloudResource.name */
  nameContains?: string;
  environment?: string;
  appTag?: string;
}

export interface ResourceGroupSummary {
  name: string;
  resourceCount: number;
}

// ─── Repository ───────────────────────────────────────────────────────────────

export class CloudResourceRepository {
  /** Master list — never mutated after construction */
  private readonly resources: CloudResource[];

  /** Indexes for fast lookups */
  private readonly byId: Map<string, CloudResource>;
  private readonly byResourceGroup: Map<string, CloudResource[]>;
  private readonly bySubscription: Map<string, CloudResource[]>;

  constructor(resources: CloudResource[]) {
    this.resources = [...resources];
    this.byId = new Map(resources.map(r => [r.id, r]));

    this.byResourceGroup = new Map();
    this.bySubscription = new Map();

    for (const r of resources) {
      // Resource group index (lower-case — Azure is case-insensitive)
      if (r.resourceGroup) {
        const key = r.resourceGroup.toLowerCase();
        if (!this.byResourceGroup.has(key)) this.byResourceGroup.set(key, []);
        this.byResourceGroup.get(key)!.push(r);
      }
      // Subscription index
      if (r.subscriptionId) {
        const key = r.subscriptionId.toLowerCase();
        if (!this.bySubscription.has(key)) this.bySubscription.set(key, []);
        this.bySubscription.get(key)!.push(r);
      }
    }
  }

  /**
   * Primary access method — always bounded by maxResults.
   *
   * Filters are ANDed together.  All string comparisons are case-insensitive.
   * Filter string values are truncated to MAX_FILTER_STRING_LENGTH before use.
   */
  query(filter: CloudResourceFilter, maxResults: number = DEFAULT_MAX_RESULTS): CloudResource[] {
    // Security: cap maxResults so callers cannot request unbounded result sets.
    const limit = Math.min(Math.max(1, maxResults), MAX_RESULTS_CAP);

    // Normalise and length-cap all string filter values.
    const rgSingle = filter.resourceGroup
      ? filter.resourceGroup.toLowerCase().slice(0, MAX_FILTER_STRING_LENGTH)
      : undefined;
    const rgMultiple = filter.resourceGroups
      ? filter.resourceGroups.map(rg => rg.toLowerCase().slice(0, MAX_FILTER_STRING_LENGTH))
      : undefined;
    const subId = filter.subscriptionId
      ? filter.subscriptionId.toLowerCase().slice(0, MAX_FILTER_STRING_LENGTH)
      : undefined;
    const nameContains = filter.nameContains
      ? filter.nameContains.toLowerCase().slice(0, MAX_FILTER_STRING_LENGTH)
      : undefined;
    const environment = filter.environment
      ? filter.environment.toLowerCase().slice(0, MAX_FILTER_STRING_LENGTH)
      : undefined;
    const appTag = filter.appTag
      ? filter.appTag.toLowerCase().slice(0, MAX_FILTER_STRING_LENGTH)
      : undefined;
    const resourceType = filter.resourceType;

    // Fast path: resource group is indexed.
    let candidates: CloudResource[];
    if (rgSingle) {
      candidates = this.byResourceGroup.get(rgSingle) ?? [];
    } else if (rgMultiple && rgMultiple.length > 0) {
      const seen = new Set<string>();
      candidates = [];
      for (const rg of rgMultiple) {
        for (const r of this.byResourceGroup.get(rg) ?? []) {
          if (!seen.has(r.id)) {
            seen.add(r.id);
            candidates.push(r);
          }
        }
      }
    } else if (subId) {
      candidates = this.bySubscription.get(subId) ?? [];
    } else {
      candidates = this.resources;
    }

    const results: CloudResource[] = [];
    for (const r of candidates) {
      if (results.length >= limit) break;

      // Apply remaining filters.
      if (subId && r.subscriptionId?.toLowerCase() !== subId) continue;
      if (resourceType && r.resourceType !== resourceType) continue;
      if (nameContains && !r.name.toLowerCase().includes(nameContains)) continue;
      if (environment && r.environment?.toLowerCase() !== environment) continue;
      if (appTag && r.appTag?.toLowerCase() !== appTag) continue;

      results.push(r);
    }

    return results;
  }

  /** All distinct resource group names. */
  listResourceGroups(): string[] {
    return Array.from(this.byResourceGroup.keys()).sort();
  }

  /** All distinct subscription IDs. */
  listSubscriptions(): string[] {
    return Array.from(this.bySubscription.keys()).sort();
  }

  /** Resource group names with per-group counts. */
  listResourceGroupSummaries(): ResourceGroupSummary[] {
    return Array.from(this.byResourceGroup.entries())
      .map(([name, rgs]) => ({ name, resourceCount: rgs.length }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getById(id: string): CloudResource | undefined {
    return this.byId.get(id);
  }

  /** Use sparingly — prefer query() to keep LLM context bounded. */
  getAll(): CloudResource[] {
    return [...this.resources];
  }

  get totalCount(): number {
    return this.resources.length;
  }
}
