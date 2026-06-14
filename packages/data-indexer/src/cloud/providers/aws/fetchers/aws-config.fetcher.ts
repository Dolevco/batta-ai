/**
 * AWS Config Fetcher — Primary Resource Inventory (ARG equivalent)
 *
 * Uses AWS Config Advanced Query (SelectResourceConfig /
 * SelectAggregateResourceConfig) to enumerate all resource types across all
 * configured accounts and regions in a single SQL-like query.
 *
 * Two modes:
 *   - Aggregator mode  — single cross-account/cross-region query via a Config
 *                        Aggregator. Requires the aggregator to exist and the
 *                        caller to have config:SelectAggregateResourceConfig.
 *   - Per-account mode — one query per account per region. Used when no
 *                        aggregator is configured or when the aggregator query
 *                        fails.
 *
 * Fallback:
 *   If Config is not enabled in a region, or the query returns an error, a
 *   warning is logged and that account/region is skipped — discovery continues
 *   for all remaining combinations.
 *
 * Security:
 *   - Credentials are passed in; this fetcher never requests credentials.
 *   - Raw AWS error bodies are never propagated — only error codes.
 *   - configuration JSON from Config may contain resource metadata; it is
 *     stored as-is and classified at the transformer layer.
 */

import pLimit from 'p-limit';
import {
  ConfigServiceClient,
  SelectResourceConfigCommand,
  SelectAggregateResourceConfigCommand,
} from '@aws-sdk/client-config-service';
import type { Provider } from '@aws-sdk/types';
import type { AwsCredentialIdentity } from '@aws-sdk/types';
import type { RawConfigResource, RawConfigResourceBatch } from '@batta/shared';

type CredentialProviderFn = (accountId: string) => Provider<AwsCredentialIdentity>;

// All resource types that do not represent Config internal bookkeeping
const CONFIG_QUERY = `
  SELECT
    resourceId,
    resourceType,
    resourceName,
    accountId,
    awsRegion,
    arn,
    tags,
    configuration,
    supplementaryConfiguration
  WHERE
    resourceType NOT IN (
      'AWS::Config::ResourceCompliance',
      'AWS::Config::ConformancePackCompliance',
      'AWS::Config::ConfigurationRecorder'
    )
`.trim();

// ============================================================================
// Public surface
// ============================================================================

export async function fetchAWSConfigResources(
  accountIds: string[],
  regions: string[],
  getCredentials: CredentialProviderFn,
  aggregatorName?: string,
): Promise<RawConfigResourceBatch> {
  if (aggregatorName) {
    return fetchViaAggregator(accountIds[0], aggregatorName, getCredentials, accountIds, regions);
  }
  return fetchPerAccount(accountIds, regions, getCredentials);
}

// ============================================================================
// Aggregator mode — single cross-account query
// ============================================================================

async function fetchViaAggregator(
  primaryAccountId: string,
  aggregatorName: string,
  getCredentials: CredentialProviderFn,
  accountIds: string[],
  regions: string[],
): Promise<RawConfigResourceBatch> {
  const client = new ConfigServiceClient({
    region: 'us-east-1',
    credentials: getCredentials(primaryAccountId),
  });

  const resources: RawConfigResource[] = [];
  let nextToken: string | undefined;

  do {
    let response;
    try {
      response = await client.send(new SelectAggregateResourceConfigCommand({
        ConfigurationAggregatorName: aggregatorName,
        Expression: CONFIG_QUERY,
        Limit: 100,
        NextToken: nextToken,
      }));
    } catch (err: any) {
      const code = err.name ?? err.$metadata?.httpStatusCode ?? 'UNKNOWN';
      console.warn(`[AWS Config] Aggregator query failed (${code}), falling back to per-account mode`);
      return fetchPerAccount(accountIds, regions, getCredentials);
    }

    for (const result of response.Results ?? []) {
      const parsed = safeParseConfigResult(result);
      if (parsed) resources.push(parsed);
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return resources;
}

// ============================================================================
// Per-account mode — one query per account per region
// ============================================================================

async function fetchPerAccount(
  accountIds: string[],
  regions: string[],
  getCredentials: CredentialProviderFn,
): Promise<RawConfigResourceBatch> {
  const accountLimit = pLimit(5);

  const perAccount = await Promise.all(
    accountIds.map(accountId =>
      accountLimit(() => fetchForAccount(accountId, regions, getCredentials(accountId))),
    ),
  );

  return perAccount.flat();
}

async function fetchForAccount(
  accountId: string,
  regions: string[],
  credentials: Provider<AwsCredentialIdentity>,
): Promise<RawConfigResourceBatch> {
  const regionLimit = pLimit(5);

  const perRegion = await Promise.all(
    regions.map(region =>
      regionLimit(() => fetchForRegion(accountId, region, credentials)),
    ),
  );

  return perRegion.flat();
}

async function fetchForRegion(
  accountId: string,
  region: string,
  credentials: Provider<AwsCredentialIdentity>,
): Promise<RawConfigResourceBatch> {
  const client = new ConfigServiceClient({ region, credentials });
  const resources: RawConfigResource[] = [];
  let nextToken: string | undefined;

  do {
    let response;
    try {
      response = await client.send(new SelectResourceConfigCommand({
        Expression: CONFIG_QUERY,
        Limit: 100,
        NextToken: nextToken,
      }));
    } catch (err: any) {
      const code = err.name ?? err.$metadata?.httpStatusCode ?? 'UNKNOWN';
      // Config not enabled, or no resources — skip silently
      if (code === 'NoSuchConfigurationRecorderException' || code === 'ConfigServiceNotEnabledException') {
        console.warn(`[AWS Config] Config not enabled in ${accountId}/${region} — skipping`);
      } else {
        console.warn(`[AWS Config] Query failed in ${accountId}/${region}: ${code}`);
      }
      return [];
    }

    for (const result of response.Results ?? []) {
      const parsed = safeParseConfigResult(result);
      if (parsed) resources.push(parsed);
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return resources;
}

// ============================================================================
// Parse helpers
// ============================================================================

/**
 * Each Config result is a JSON string.  Parse it and map to RawConfigResource.
 * Returns null if the result cannot be parsed — never throws.
 */
function safeParseConfigResult(raw: string): RawConfigResource | null {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }

  const resourceType = (obj.resourceType as string) ?? '';
  const resourceId = (obj.resourceId as string) ?? '';
  if (!resourceType || !resourceId) return null;

  // Config returns tags as an array of { key, value } objects or a map
  const rawTags = obj.tags;
  let tags: Record<string, string> = {};
  if (Array.isArray(rawTags)) {
    for (const t of rawTags as { key?: string; value?: string }[]) {
      if (t.key) tags[t.key] = t.value ?? '';
    }
  } else if (rawTags && typeof rawTags === 'object') {
    tags = rawTags as Record<string, string>;
  }

  return {
    resourceId,
    resourceType,
    resourceName: (obj.resourceName as string) ?? resourceId,
    accountId: (obj.accountId as string) ?? '',
    region: (obj.awsRegion as string) ?? 'global',
    arn: (obj.arn as string) ?? '',
    tags,
    configuration: (obj.configuration as Record<string, unknown>) ?? {},
    supplementaryConfiguration: (obj.supplementaryConfiguration as Record<string, unknown>) ?? {},
  };
}
