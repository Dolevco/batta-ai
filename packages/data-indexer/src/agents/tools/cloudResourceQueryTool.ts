/**
 * CloudResourceQueryTool
 *
 * An LLM-callable tool that lets IaC and script analysis agents query the
 * CloudResourceRepository during analysis. Agents can use this to verify
 * whether a resource name they found in a script actually exists in the
 * live cloud environment and retrieve its ID.
 *
 * Security:
 *   - All filter parameters are validated and length-capped before use.
 *   - maxResults is capped at MAX_RESULTS_PER_CALL to prevent agents from
 *     requesting unbounded result sets.
 *   - The tool only returns CloudResource fields — no secrets are stored
 *     in CloudResource objects.
 *   - subscriptionId, resourceGroup, nameContains are normalised to
 *     lowercase and capped before passing to CloudResourceRepository.query(),
 *     which itself enforces MAX_FILTER_STRING_LENGTH.
 */

import { BaseTool } from '@batta/core';
import type { ToolCategory, ToolParameter, ToolResult } from '@batta/core';

/** Tool category for cloud resource discovery queries */
const CloudQueryCategory: ToolCategory = {
  name: 'cloud_query',
  description: 'Query the live cloud resource inventory to verify resource names and IDs.',
  keywords: ['cloud', 'resource', 'query', 'azure', 'lookup'],
};
import type { CloudResourceRepository } from '../../cloud/repository/cloud-resource-repository';
import type { CloudResourceFilter } from '../../cloud/repository/cloud-resource-repository';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum results an agent may request per call (prevents unbounded context). */
const MAX_RESULTS_PER_CALL = 30;

/** Maximum filter string lengths (security: prevent excessive substring searches). */
const MAX_FILTER_LEN = 90;

// ─── Input type ───────────────────────────────────────────────────────────────

export interface CloudResourceQueryInput extends Record<string, unknown> {
  subscriptionId?: string;
  resourceGroup?: string;
  resourceType?: string;
  nameContains?: string;
  maxResults?: number;
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

export class CloudResourceQueryTool extends BaseTool<CloudResourceQueryInput> {
  name = 'query_cloud_resources';
  category: ToolCategory = CloudQueryCategory;
  description =
    'Query the live cloud resource inventory. Returns resources matching the ' +
    'provided filters. Use this to verify whether a resource name found in the ' +
    'script/IaC file actually exists in the cloud and to retrieve its canonical ID. ' +
    'All filters are optional — omit a filter to match all values for that dimension. ' +
    'Prefer narrow filters (resourceGroup + nameContains) for best results.';

  parameters: ToolParameter[] = [
    {
      name: 'subscriptionId',
      description: 'Azure subscription ID to filter by (optional).',
      required: false,
      type: 'string',
    },
    {
      name: 'resourceGroup',
      description:
        'Exact resource group name to filter by (case-insensitive). ' +
        'Use list_resource_groups first to discover available resource groups.',
      required: false,
      type: 'string',
    },
    {
      name: 'resourceType',
      description:
        'Resource type to filter by. One of: compute, database, storage, cache, queue, network, identity, registry, other.',
      required: false,
      type: 'string',
    },
    {
      name: 'nameContains',
      description:
        'Case-insensitive substring to match against the resource name. ' +
        'E.g. "payments-api" will match "rg-payments-api-prod". Use a distinctive part of the name.',
      required: false,
      type: 'string',
    },
    {
      name: 'maxResults',
      description:
        `Maximum number of results to return (default 10, max ${MAX_RESULTS_PER_CALL}).`,
      required: false,
      type: 'number',
    },
  ];

  constructor(private readonly repository: CloudResourceRepository) {
    super();
  }

  async execute(input: CloudResourceQueryInput): Promise<ToolResult> {
    return this.wrapExecution(input, async () => {
      const errors = this.validate(input);
      if (errors.length) {
        return {
          success: false,
          message: `Invalid query: ${errors.join('; ')}`,
          error: 'VALIDATION_ERROR',
        };
      }

      const limit = Math.min(
        Math.max(1, typeof input.maxResults === 'number' ? input.maxResults : 10),
        MAX_RESULTS_PER_CALL,
      );

      const filter: CloudResourceFilter = {};
      if (input.subscriptionId) {
        filter.subscriptionId = String(input.subscriptionId).toLowerCase().slice(0, MAX_FILTER_LEN);
      }
      if (input.resourceGroup) {
        filter.resourceGroup = String(input.resourceGroup).toLowerCase().slice(0, MAX_FILTER_LEN);
      }
      if (input.resourceType) {
        filter.resourceType = String(input.resourceType) as CloudResourceFilter['resourceType'];
      }
      if (input.nameContains) {
        filter.nameContains = String(input.nameContains).slice(0, MAX_FILTER_LEN);
      }

      const resources = this.repository.query(filter, limit);
      const truncated = resources.length >= limit && this.repository.totalCount > limit;

      const payload = {
        resources: resources.map(r => ({
          id: r.id,
          name: r.name,
          resourceType: r.resourceType,
          cloudProvider: r.cloudProvider,
          region: r.region,
          resourceGroup: r.resourceGroup,
          subscriptionId: r.subscriptionId,
          environment: r.environment,
          appTag: r.appTag,
          responsibility: r.responsibility,
        })),
        totalMatched: resources.length,
        truncated,
      };

      await this.notify(
        `🔍 Cloud query: ${resources.length} resource(s) matched` +
        (truncated ? ' (truncated)' : ''),
      );

      return {
        success: true,
        message: JSON.stringify(payload, null, 2),
      };
    });
  }

  private validate(input: CloudResourceQueryInput): string[] {
    const errors: string[] = [];

    for (const field of ['subscriptionId', 'resourceGroup', 'nameContains']) {
      const v = (input as Record<string, unknown>)[field];
      if (v !== undefined && v !== null) {
        if (typeof v !== 'string') {
          errors.push(`\`${field}\` must be a string.`);
        } else if (v.length > MAX_FILTER_LEN) {
          errors.push(`\`${field}\` exceeds maximum length (${MAX_FILTER_LEN}).`);
        }
      }
    }

    if (input.maxResults !== undefined) {
      if (typeof input.maxResults !== 'number' || input.maxResults < 1) {
        errors.push('`maxResults` must be a positive number.');
      }
    }

    return errors;
  }
}

/**
 * Factory function that creates a CloudResourceQueryTool bound to a specific repository.
 * Wire into IaCAnalyzerAgent.toolsFactory() and ScriptAnalyzerAgent.toolsFactory().
 */
export function createCloudResourceQueryTool(
  repository: CloudResourceRepository,
): CloudResourceQueryTool {
  return new CloudResourceQueryTool(repository);
}
