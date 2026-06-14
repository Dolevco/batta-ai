import { createReadOnlyFileTools } from '@batta/core';
import { IaCAnalysisCompletionTool } from '../tools/iacAnalysisCompletionTool';
import { createCloudResourceQueryTool } from '../tools/cloudResourceQueryTool';
import { createListResourceGroupsTool } from '../tools/listResourceGroupsTool';
import type { DataIndexerAgentDefinition } from '../types';
import type { CloudResourceRepository } from '../../cloud/repository/cloud-resource-repository';

/** IaC agent instructions — shared between the static definition and the factory. */
const IAC_ANALYZER_INSTRUCTIONS = `You are a cloud-infrastructure security architect specialising in IaC analysis.

**Role:** Read a single IaC file and produce structured knowledge correlating deployment artifacts with code services and cloud resources.
**Scope:** The file is in the workspace — read it directly. Do NOT clone any repository.

**Extract:**
1. **deployedServices** — code services this file deploys (container images, Helm releases, function apps)
   - IaCServiceRef.name: service/container name as in the file
   - IaCServiceRef.imageName (optional): Docker image reference
   - IaCServiceRef.evidence (optional): config key or line ref — NO secret values
2. **deployedResources** — cloud resources this file CREATES/PROVISIONS
   - IaCResourceRef.resourceType: \`compute\` | \`database\` | \`storage\` | \`cache\` | \`queue\` | \`network\` | \`identity\` | \`registry\` | \`other\`
   - IaCResourceRef.cloudProvider: \`aws\` | \`azure\` | \`gcp\` | \`other\`
   - IaCResourceRef.namingPattern (optional): e.g. "{env}-api-ca"
   - IaCResourceRef.evidence (optional): key or line ref — NO secret values
3. **usedResources** — cloud resources this file only REFERENCES without creating (reads a Key Vault secret, attaches to existing VNet)
4. **namingConventions** — repeated patterns, prefixes/suffixes, environment tokens across resource names
5. **summary** — one sentence describing what this file does
6. **deploymentTargets** — explicit deployment scope (extract deterministically — no guessing):
   - Terraform: \`resource_group_name\` in azurerm_resource_group or provider block
   - Bicep: \`targetScope = 'resourceGroup'\` + parameter default values
   - ARM templates: \`[resourceGroup().name]\` expressions and parameter defaults
   - Helm/K8s: namespace → treat as resourceGroup equivalent
   - docker-compose: if deploying to Azure via az commands, extract --resource-group
   - If no explicit resource group is found, omit deploymentTargets entirely (do NOT guess)

**Reading guide by file type:**
 - Bicep/ARM: \`resource\` declarations, type strings like "Microsoft.App/containerApps"
 - Terraform/HCL: \`resource {}\` (CREATE) vs \`data {}\` (REFERENCE)
 - docker-compose: services → image, container_name, volumes
 - Kubernetes/Helm: kind: Deployment/StatefulSet → containers.image; Service, PVC
 - Shell scripts: \`az\`, \`aws\`, \`gcloud\` CLI calls

**Optional verification tools (use when cloud inventory is available):**
 - \`list_resource_groups\` — discover available resource groups in the live environment
 - \`query_cloud_resources\` — verify whether a resource name from the file exists in the cloud and retrieve its canonical ID

**CREATE vs REFERENCE:** CREATE = file defines a new resource; REFERENCE = file reads from/connects to an existing resource without creating it.

**Security:** NEVER include secret values, passwords, or connection strings. Reference KEY NAMES only.

Return empty arrays for any category with no findings. Call task_complete once when done. Fix validation errors and call again if needed.`;

/** Static definition used when no cloud repository is available (no query tools). */
export const IAC_ANALYZER_AGENT: DataIndexerAgentDefinition = {
  agentType: 'iac-analyzer',
  description:
    'Analyses Infrastructure-as-Code files (Terraform, CloudFormation, Bicep, CDK, Pulumi, ARM, ' +
    'Ansible, docker-compose, Kubernetes/Helm, shell scripts) to extract deployed services, ' +
    'cloud resources, naming conventions, and deployment target scopes.',
  whenToUse:
    'When a deployment artifact needs semantic analysis to produce an IaCAnalysis with ' +
    'deployedServices, deployedResources, usedResources, namingConventions, deploymentTargets, and summary.',
  maxIterations: 20,
  customInstructions: IAC_ANALYZER_INSTRUCTIONS,
  completionToolFactory: () => new IaCAnalysisCompletionTool(),
  toolsFactory: (workspacePath: string) =>
    createReadOnlyFileTools({ workspacePath }),
};

/**
 * Create an IaC analyzer agent definition with cloud resource query tools wired in.
 * Use this variant when a CloudResourceRepository is available so the agent can
 * verify resource names against the live cloud inventory during analysis.
 *
 * @param repository - Live cloud resource repository to bind to query tools.
 */
export function createIaCAnalyzerAgentWithRepository(
  repository: CloudResourceRepository,
): DataIndexerAgentDefinition {
  return {
    ...IAC_ANALYZER_AGENT,
    toolsFactory: (workspacePath: string) => [
      ...createReadOnlyFileTools({ workspacePath }),
      createListResourceGroupsTool(repository),
      createCloudResourceQueryTool(repository),
    ],
  };
}
