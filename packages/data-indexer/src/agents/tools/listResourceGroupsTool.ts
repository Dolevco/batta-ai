/**
 * ListResourceGroupsTool
 *
 * An LLM-callable tool that lets IaC and script analysis agents discover
 * which Azure resource groups are available in the live cloud inventory.
 * This is typically the first tool an agent calls when it wants to understand
 * the deployment environment before using query_cloud_resources.
 *
 * Security:
 *   - No user-controlled input is involved — the tool just reads from
 *     CloudResourceRepository.listResourceGroupSummaries().
 *   - Resource group names are already lower-cased by the repository;
 *     no additional normalisation is needed.
 *   - The tool returns only metadata (name, resource count), never resource
 *     details, so it is safe to call without narrowing context first.
 */

import { BaseTool } from '@ai-agent/core';
import type { ToolCategory, ToolParameter, ToolResult } from '@ai-agent/core';
import type { CloudResourceRepository } from '../../services/cloud-resource-repository';

// ─── Category ────────────────────────────────────────────────────────────────

const CloudQueryCategory: ToolCategory = {
  name: 'cloud_query',
  description: 'Query the live cloud resource inventory to verify resource names and IDs.',
  keywords: ['cloud', 'resource', 'query', 'azure', 'lookup'],
};

// ─── Tool ─────────────────────────────────────────────────────────────────────

export class ListResourceGroupsTool extends BaseTool<Record<string, never>> {
  name = 'list_resource_groups';
  category: ToolCategory = CloudQueryCategory;
  description =
    'List all Azure resource groups in the cloud inventory, along with a resource count ' +
    'for each group. Call this first to understand the deployment environment before using ' +
    'query_cloud_resources with a specific resource group filter.';

  parameters: ToolParameter[] = [];

  constructor(private readonly repository: CloudResourceRepository) {
    super();
  }

  async execute(_input: Record<string, never>): Promise<ToolResult> {
    return this.wrapExecution(_input, async () => {
      const summaries = this.repository.listResourceGroupSummaries();

      const payload = {
        resourceGroups: summaries,
        totalGroups: summaries.length,
        totalResources: this.repository.totalCount,
      };

      await this.notify(
        `📋 ${summaries.length} resource group(s) available (${this.repository.totalCount} total resources)`,
      );

      return {
        success: true,
        message: JSON.stringify(payload, null, 2),
      };
    });
  }
}

/**
 * Factory function that creates a ListResourceGroupsTool bound to a repository.
 * Wire into IaCAnalyzerAgent.toolsFactory() and ScriptAnalyzerAgent.toolsFactory().
 */
export function createListResourceGroupsTool(
  repository: CloudResourceRepository,
): ListResourceGroupsTool {
  return new ListResourceGroupsTool(repository);
}
