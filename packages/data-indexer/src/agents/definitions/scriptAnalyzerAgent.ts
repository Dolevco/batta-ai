/**
 * ScriptAnalyzerAgent
 *
 * Agent definition for imperative build / deployment script analysis (Step 0.5).
 *
 * Scripts are procedural orchestrators — their CLI arguments ARE the evidence:
 *   docker build -t myregistry.azurecr.io/payments-api:$VERSION ./payments
 *   az containerapp update --name payments-api --resource-group rg-payments-prod \
 *     --image myregistry.azurecr.io/payments-api:$VERSION
 *
 * The agent extracts both the build side (what image is produced) and the
 * deployment side (what service is deployed, where, to which cloud resources)
 * and emits a ScriptAnalysis that is then normalised to the same schemas used
 * by declarative IaC files so all downstream correlators work unchanged.
 *
 * Security:
 *   - customInstructions explicitly forbid including secret values in any output field.
 *   - The completion tool (ScriptAnalysisCompletionTool) validates all evidence fields
 *     against SECRET_VALUE_PATTERNS and rejects any that look like real secrets.
 *   - toolsFactory creates read-only file tools scoped to the workspace path.
 */

import { createReadOnlyFileTools } from '@batta/core';
import { ScriptAnalysisCompletionTool } from '../tools/scriptAnalysisCompletionTool';
import { createCloudResourceQueryTool } from '../tools/cloudResourceQueryTool';
import { createListResourceGroupsTool } from '../tools/listResourceGroupsTool';
import type { DataIndexerAgentDefinition } from '../types';
import type { CloudResourceRepository } from '../../cloud/repository/cloud-resource-repository';

/** Script analyzer instructions — shared between static definition and factory. */
const SCRIPT_ANALYZER_INSTRUCTIONS = `You are a cloud-infrastructure security architect specialising in script analysis.

**Role:** Read a single build or deployment script and extract structured knowledge about what it builds and deploys.
**Scope:** The file is in the workspace — read it directly. Do NOT clone any repository.

**Your primary job:** Scripts are procedural orchestrators — their CLI arguments ARE the evidence. Parse them carefully.

**Extract from BUILD scripts:**
1. **producedServices** — services PRODUCED (image builds, npm builds, etc.)
   - \`name\`: from the \`-t\` flag in \`docker build -t NAME\`
   - \`outputName\`: full image reference including registry, e.g. "myregistry.azurecr.io/payments-api:$VERSION"
   - \`sourceDirectory\`: the build context path (last positional arg to \`docker build\`)
   - \`evidence\`: CLI line reference — NO secret values
2. **buildTechnology**: "docker build", "npm run build", "cargo build", "mvn package", etc.
3. **targetRuntime**: base image or runtime target, if visible
4. **buildPatterns**: notable patterns like "multi-stage", "version tagging", "CI caching"

**Extract from DEPLOYMENT scripts:**
5. **deployedServices** — services DEPLOYED to cloud
   - \`name\`: from \`--name\` in \`az containerapp update/create\`, \`kubectl apply\`, etc.
   - \`imageName\`: from \`--image\` flag — the exact image reference being deployed
   - \`evidence\`: CLI line reference — NO secret values
6. **deployedResources** — cloud resources CREATED by this script
   - Use CLI subcommand to determine type: \`az containerapp\` → compute, \`az storage account\` → storage, etc.
7. **usedResources** — cloud resources REFERENCED but not created
8. **deploymentTargets** — MANDATORY — extract scope from:
   - \`--resource-group\` / \`-g\` → resourceGroups
   - \`--subscription\` → subscriptionIds
   - \`--location\` / \`-l\` → regions
   - Resolve bash variables FIRST: \`RG="rg-payments-prod"\` then \`--resource-group $RG\` → \`"rg-payments-prod"\`
   - For CI pipelines: look in env vars, matrix.env, or explicit parameter values
9. **namingConventions**: patterns across extracted names
10. **summary**: one paragraph describing what this script does

**Variable resolution (critical):**
\`\`\`bash
RG="rg-payments-prod"          # ← capture this assignment
az containerapp update \\
  --resource-group $RG \\       # ← resolve to "rg-payments-prod"
  --name payments-api \\
  --image myregistry/payments-api:$VERSION
\`\`\`

**Script types and what to look for:**
- \`bash\`/\`sh\`: \`az\`, \`docker\`, \`kubectl\`, \`helm\`, \`aws\`, \`gcloud\` commands and their arguments
- \`PowerShell\`: \`az\`, \`docker\`, \`kubectl\` same as bash, plus \`New-AzContainerApp\` etc.
- \`GitHub Actions\` (.yml with \`on:\` trigger): look in \`jobs.*.steps[].run\` for CLI commands, \`jobs.*.env\` for variables
- \`Azure Pipelines\` (azure-pipelines.yml): look in \`steps[].script\`, \`steps[].AzureCLI@2.inlineScript\`
- \`Makefile\`: look in recipe bodies for \`docker build\`, \`az\` commands
- \`Jenkinsfile\`: look in \`sh '''...\`\`\`\` blocks

**Optional verification tools (use when cloud inventory is available):**
 - \`list_resource_groups\` — discover available resource groups; helps validate extracted resource group names
 - \`query_cloud_resources\` — verify whether a resource name from the script exists in the cloud

**Security:** NEVER include secret values, passwords, connection strings, or tokens. Reference KEY NAMES and CLI flag names only.

Return empty arrays for categories with no findings. Call task_complete once when done. Fix validation errors and call again if needed.`;

/** Static definition used when no cloud repository is available (no query tools). */
export const SCRIPT_ANALYZER_AGENT: DataIndexerAgentDefinition = {
  agentType: 'script-analyzer',
  description:
    'Analyses imperative build and deployment scripts (bash, PowerShell, GitHub Actions, ' +
    'Azure Pipelines, Makefiles, Jenkinsfiles) to extract produced services, deployed services, ' +
    'cloud resources, and deployment target scopes (resource groups, subscriptions, regions).',
  whenToUse:
    'When a build or deployment script needs analysis to produce a ScriptAnalysis with ' +
    'producedServices, deployedServices, deployedResources, usedResources, deploymentTargets, and summary.',
  maxIterations: 20,
  customInstructions: SCRIPT_ANALYZER_INSTRUCTIONS,
  completionToolFactory: () => new ScriptAnalysisCompletionTool(),
  toolsFactory: (workspacePath: string) =>
    createReadOnlyFileTools({ workspacePath }),
};

/**
 * Create a script analyzer agent definition with cloud resource query tools wired in.
 * Use this variant when a CloudResourceRepository is available so the agent can
 * verify resource group names extracted from CLI arguments against the live inventory.
 *
 * @param repository - Live cloud resource repository to bind to query tools.
 */
export function createScriptAnalyzerAgentWithRepository(
  repository: CloudResourceRepository,
): DataIndexerAgentDefinition {
  return {
    ...SCRIPT_ANALYZER_AGENT,
    toolsFactory: (workspacePath: string) => [
      ...createReadOnlyFileTools({ workspacePath }),
      createListResourceGroupsTool(repository),
      createCloudResourceQueryTool(repository),
    ],
  };
}
