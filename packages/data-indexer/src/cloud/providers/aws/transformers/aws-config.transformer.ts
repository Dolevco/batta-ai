/**
 * AWS Config Transformer
 *
 * Maps RawConfigResource records (from AWS Config Advanced Query) to the
 * normalized CloudResource shape used by the rest of the pipeline.
 *
 * This is the AWS equivalent of the Azure Resource Graph transformer — it
 * produces the flat resource inventory that drives asset pages, search, and
 * graph node creation.
 *
 * Design notes:
 *   - `subscriptionId` maps to `accountId` for AWS (same structural slot).
 *   - `resourceGroup` maps to the AWS region (closest semantic equivalent).
 *   - `rawData` carries the full Config configuration blob for graph-builder
 *     enrichment; it is never sent to the LLM directly.
 *   - Resource names fall back to the ARN suffix when Config provides no name.
 *   - Tags are preserved as-is; values are truncated to 256 chars to prevent
 *     oversized payloads.
 */

import type { RawConfigResourceBatch, RawConfigResource } from '@batta/shared';

const MAX_TAG_VALUE_LENGTH = 256;

// ============================================================================
// Public surface
// ============================================================================

export interface CloudResourceRecord {
  id: string;
  name: string;
  type: string;
  provider: 'aws';
  accountId: string;
  region: string;
  arn: string;
  tags: Record<string, string>;
  rawData: Record<string, unknown>;
}

export function transformConfigResources(
  batch: RawConfigResourceBatch,
): CloudResourceRecord[] {
  const out: CloudResourceRecord[] = [];

  for (const item of batch) {
    const record = transformOne(item);
    if (record) out.push(record);
  }

  return out;
}

// ============================================================================
// Per-resource mapping
// ============================================================================

function transformOne(item: RawConfigResource): CloudResourceRecord | null {
  if (!item.resourceId || !item.resourceType) return null;

  const name = resolveName(item);
  const tags = sanitizeTags(item.tags);

  return {
    id: item.arn || `${item.accountId}/${item.region}/${item.resourceType}/${item.resourceId}`,
    name,
    type: item.resourceType,
    provider: 'aws',
    accountId: item.accountId,
    region: item.region,
    arn: item.arn,
    tags,
    rawData: item.configuration,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Prefer the human-readable resource name from Config.
 * Fall back to the ARN's last path segment, then the raw resource ID.
 */
function resolveName(item: RawConfigResource): string {
  if (item.resourceName && item.resourceName !== item.resourceId) {
    return item.resourceName;
  }
  if (item.arn) {
    const parts = item.arn.split('/');
    const last = parts[parts.length - 1];
    if (last && last !== item.arn) return last;
  }
  return item.resourceId;
}

function sanitizeTags(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = typeof v === 'string' && v.length > MAX_TAG_VALUE_LENGTH
      ? v.slice(0, MAX_TAG_VALUE_LENGTH)
      : (v ?? '');
  }
  return out;
}
