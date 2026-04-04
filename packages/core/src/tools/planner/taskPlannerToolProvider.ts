import { ILLMApiHandler } from '../../api';
import { Tool } from '../types';
import { BaseToolProvider } from '../toolSelection/baseToolProvider';
import { ListToolDetailsTool } from '../toolSelection/listToolDetailsTool';
import { CodeIntegrationInfo, CodeIntegrationProvider, DelegateTool, DelegationLimits } from '../delegation';
import { GeneratePlanTool } from './generatePlanTool';
import { ValidatePlanTool } from './validatePlanTool';
import { ExecutePlanTool } from './executePlanTool';
import { PlanMemory } from '../../task/planner/planMemory';
import { TaskStepLongTermMemory } from '../../context/memory/longTerm/taskStepMemory';
import { SubAgentExecutor } from '../delegation/subAgentExecutor';
import { InteractionsCategory } from '../interactions/chatTools';

/**
 * Tool provider for PlannedTask that provides:
 * 1. list_tool_details - to discover available tools for sub-tasks
 * 2. generate_plan - to create a validated plan
 * 3. execute_plan - to execute a plan
 * 4. delegate_task - to execute individual sub-tasks
 * 
 * The planner uses list_tool_details to understand what tools are available,
 * then uses generate_plan to create a plan, and execute_plan to run it.
 */
export class TaskPlannerToolProvider extends BaseToolProvider {
  private readonly listToolDetailsTool: ListToolDetailsTool;
  private readonly delegateTool: DelegateTool;
  private readonly generatePlanTool: GeneratePlanTool;
  private readonly validatePlanTool: ValidatePlanTool;
  private readonly executePlanTool: ExecutePlanTool;
  private readonly codeIntegrations: CodeIntegrationInfo[];

  constructor(
    tools: Tool[],
    api: ILLMApiHandler,
    planMemory: PlanMemory,
    maxIterations: number = 10,
    maxSubTasks: number = 10,
    codeIntegrationProvider?: CodeIntegrationProvider,
    taskStepMemory?: TaskStepLongTermMemory
  ) {
    super(tools);

    this.codeIntegrations = codeIntegrationProvider?.getCodeIntegrationsInfo() ?? [];

    // Create list_tool_details meta-tool
    this.listToolDetailsTool = new ListToolDetailsTool(
      (name) => this.getTool(name)
    );

    // Create delegate_task meta-tool with task run memory and task step memory
    const executor = new SubAgentExecutor(api, maxIterations, codeIntegrationProvider, taskStepMemory);
    this.delegateTool = new DelegateTool(executor, tools);

    // Create planning tools
    this.generatePlanTool = new GeneratePlanTool(planMemory, tools, maxSubTasks, this.codeIntegrations);
    this.validatePlanTool = new ValidatePlanTool();
    this.executePlanTool = new ExecutePlanTool(this.delegateTool);
  }

  /**
   * Get the list_tool_details meta-tool (primary meta-tool for planning).
   */
  override getMetaTool(): Tool {
    return this.listToolDetailsTool;
  }

  /**
   * Get the delegate_task tool for sub-task execution.
   */
  getDelegateTool(): DelegateTool {
    return this.delegateTool;
  }

  /**
   * Get the generate_plan tool.
   */
  getGeneratePlanTool(): GeneratePlanTool {
    return this.generatePlanTool;
  }

  /**
   * Get the validate_plan tool.
   */
  getValidatePlanTool(): ValidatePlanTool {
    return this.validatePlanTool;
  }

  /**
   * Get the execute_plan tool.
   */
  getExecutePlanTool(): ExecutePlanTool {
    return this.executePlanTool;
  }

  /**
   * Get tools available for the planner:
   * - generate_plan: to create a validated plan
   * - task_complete: to complete the overall task
   */
  getPlannerTools(includeInteractionTools: boolean): Tool[] {
    return [
      this.generatePlanTool,
      ...(!includeInteractionTools ? [] : this.getAllTools().filter(t => t.category === InteractionsCategory))
    ];
  }

  /**
   * Generate the tools section for the planner prompt.
   */
  override generateToolsPromptSection(): string {
    const codeIntegrationsSection = this.codeIntegrations.length > 0
      ? `\n\n### Available Code Integrations

    The following code integrations are available for tasks that require coding, git operations, or repository analysis:

    ${this.codeIntegrations.map(ci => `- **${ci.name}** (id: \`${ci.id}\`) ${ci.repoUrl} - ${ci.description ?? ''}`).join('\n')}

    To use a code integration in a sub-task, specify the \`codeIntegrationId\` field with the integration's ID.
    Each step can use one code integration. When a code integration is used, the execution environment will clone the repository and provide the planner/delegate with an accessible repository path. 
    IMPORTANT: the planner MUST NOT include or plan low-level git operations such as cloning, creating branches, checking out branches. The planner should assume the repository is already cloned and available.

    If the FIRST step uses code tools, it MUST specify a concrete repository (a non-"dynamic" \`codeIntegrationId\`). Otherwise (if code is used in a later step) you MUST use \`codeIntegrationId: "dynamic"\` and the previous step MUST provide \`repositoryName\` in its requiredOutputs so the integration can be resolved.
    Code integration MUST be the single tool category in a step if it is in use. You cannot use any other integration with code; create separate steps if needed.

    Once you use a code integration, you will get the path to the repository and the relevant tools for reading or modifying files. Use code integrations when the task involves:
    - Reading, writing, or analyzing code files
    - Repository exploration or dependency analysis
    - Code review or refactoring tasks
    - Preparing changes as patches or describing required edits (the actual branch/PR operations will be handled outside planner-level planning)`
      : '';

    return `
${this.generateToolsByCategoryPromptLines()}${codeIntegrationsSection}

### If a sub-task requires code changes

IMPORTANT: If any sub-task uses code integration (tools category \`code\`) DO NOT instruct the executor to clone the repository, create or check out branches, or perform other low-level repository setup — the code integration will provide a cloned repository workspace for you. Instead, plan only the logical code changes and follow the required execution/validation flow below.

For coding/fix sub-tasks you MUST include explicit validation and push steps in the plan. Use the following flow as part of the sub-task design and include the named expectedOutputs (examples shown) so downstream steps can depend on them:
Flow: Have a plan for the fix → apply fix using file tools → validate fix using git_iff → run build / tests if possible → repeat fix and validate as needed → use git_stage_commit_push to push changes to fix branch → create pull request

1) If validation or tests fail: iterate — update the fix, re-apply, and re-run validation/tests until passing or until a reasonable iteration limit is reached. Document iteration count and results.
2) Create a pull request describing the fix and attach validation/build/test evidence.

Make these validation and push steps explicit in the plan for any coding sub-task. Each validation or test step should return actionable diagnostics (not raw logs) so later steps can decide whether to iterate or finalize.

### Plan Generation Workflow

IMPORTANT: Follow this exact workflow when planning:

1. **Generate Plan**: Use the \`generate_plan\` tool to create a plan with sub-tasks
2. **Handle Validation Results**:
   - If the plan is valid: the task will be completed.
   - If validation fails: Generate a NEW plan using the detailed feedback from validation errors
4. **Retry if Needed**: You may regenerate and revalidate to fix issues
5. Once you have a valid plan, the generate_plan will complete the task

DO NOT execute the plan yourself. Just generate and validate it.

IMPORTANT: if you can't find sufficient tools to complete a task, DO NOT create sub-tasks that lack the tools to complete them. Instead:

- If a concise follow-up is needed, use the 'send_message' tool to ask for the missing integration or permission (one short question). Do not proceed to create sub-tasks that would require that missing capability.

### Sub-Task Design Guidelines

**CRITICAL: Create the FEWEST sub-tasks possible by merging operations that use similar tool categories.**

#### When to CREATE SEPARATE sub-tasks:
- **ONLY** when tool categories are COMPLETELY different
- Example: "Check weather in NY and send email to X"
  → Sub-task 1: Use web/search tools to get weather  
  → Sub-task 2: Use messaging tools to send email

#### When to MERGE into ONE sub-task:
- **ALWAYS** merge when 2+ consecutive steps use the same or overlapping tool categories
- Example: "Read files, analyze code, and generate report"
  → ONE sub-task using file/search tools for everything

IMPORTANT: you CANNOT create 2 consecutive steps with the same tools. combine them if needed.  

#### Best Practices:

Each sub-task should:
- Have ONE comprehensive goal that combines multiple related operations
- Use tools to gather data AND analyze/summarize results
- Return an analyzed, actionable response (not raw data)
- DO NOT ask delegate task to call a tool and return raw data. delegate task with maximum instructions possible with the given tools so we can reduce the number of delegated task to complete the flow.

**GOOD sub-tasks (properly merged):**
- "Read package.json, tsconfig.json, analyze dependencies, check for conflicts, and generate compatibility report"
- "Find all TypeScript files, extract imports, map dependency relationships, and create visualization"
- "search for authentication code, review security patterns, and suggest improvements"
- "Run all tests, parse failures, group by module, identify patterns, and summarize root causes"

**BAD sub-tasks (too granular - should be merged):**
- ❌ "Read package.json" → "Analyze dependencies" → "Check conflicts" (MERGE into ONE!)
- ❌ "List TypeScript files" → "Read each file" → "Extract imports" (MERGE into ONE!)
- ❌ "Run tests" → "Parse output" → "Summarize" (MERGE into ONE!)
- ❌ "Search for function X" → "Read implementation" (MERGE into ONE!)

### Handling missing tools or insufficient capabilities

If a sub-task requires a tool or integration that is not available, DO NOT assume it exists. Be explicit about what you can and cannot do with the available tools. Follow these rules:

- If a required capability is missing, first ask a concise follow-up question requesting the missing integration or permission. use the 'send_message'.

Requirements for sub-tasks when tools are limited:
- Be specific: list which available tool(s) will be used (by name or category), the exact sequence of actions, and the expected output format.
- If you stop short because of missing capabilities, include an explicit follow-up question or a clear instruction for the user about what to enable or do next.

To create valid plan You MUST:
1) Inspect the generated plan and decide whether the plan as a whole can complete the original task.
2) For each sub-task, decide whether that step can be completed with the provided tools and context.
Validation criteria to consider (use these to form your explanations):
- Intent: is the step's intent actionable and specific enough to perform the work?
- Tools: do the step's tool categories cover the operations required by the intent? For coding work, ensure a code integration is provided and the 'code' tool category is present.
- ExpectedOutput: is the step's expectedOutput detailed enough to be used by dependent steps? (should provide the exact data/formats required by dependents)
- Dependencies: dependent steps must reference earlier steps and those earlier steps must provide sufficient expectedOutput/context.
- Context: the step must include all data needed to complete it (credentials, repo path, target files, etc.).
- Finalization: the plan should include final step(s) that analyze, summarize, or present the answer to the original task.
- Code integration repository validation: IF ANY sub-task uses a code integration (has a \`codeIntegrationId\` other than omitted), the validator MUST verify that:
  - the chosen \`codeIntegrationId\` exists in the "Available Code Integrations" section above, and the integration listed matches the repository or repoUrl referenced by the sub-task. dynamic is valid integration id, as long as the thr required input includes repositoryName.
  - there is an explicit, documented reason for choosing that repository (e.g., the repository was returned by a prior step, the user explicitly specified it, or other concrete evidence). Do NOT assume defaults, pick placeholder repo names, or guess repository locations.
  - the repository selected MUST come be infered from the context (user prompt / other data), or provided by previous step. if a repository selected (not dynamic) as yourself why, and make sure it's not guessed.
  - explicit repository name should be used only if the first step contains code integration, otherwise you MUST use dynamic code integration with the previous step provide the repositoryName in its requiredOutputs. in general, preffer to extract the repository name dynamically from previous steps and use dynamic repository.

The task will be completed once generate_plan will be called with a valid plan.

Example for a valid plan with first step of code integration (repository must be specified):
task: "Check for CVEs in ai-agent repository and send a slack message with a summary to Jhon",
subTasks: [ { "name": "Analyze ai-agent repository for CVEs", "toolsCategories": [ "code" ], "intent": "Analyze the ai-agent repository for any known CVEs or vulnerabilities in dependencies or code", "expectedOutput": "A detailed summary of CVEs or vulnerabilities found in the ai-agent repository including affected components and severity", "anticipatedSteps": 5, "requiredOutputs": { "cveSummary": "Detailed CVE and vulnerability summary report for ai-agent repository" }, "requiredInputs": {}, "codeIntegrationId": "github(ai-agent)" }, { "name": "Send Slack message to Jhon with CVE summary", "toolsCategories": [ "slack" ], "intent": "Send a Slack message to user Jhon with the CVE summary from the ai-agent repository analysis", "expectedOutput": "Confirmation that a Slack message with the CVE summary was sent to user Jhon", "anticipatedSteps": 2, "dependsOn": [ 0 ], "requiredOutputs": {}, "requiredInputs": { "cveSummary": "Detailed CVE and vulnerability summary report for ai-agent repository" } } ]

Example for a valid plan with code integration not in the first step (must use dynamic):
task: "Check in MDC for vulnerability scanning findings, create fixes if any, and send a pull request link to Jhon for review.",
subTasks: [ { "id": "Check_MDC_for_vulnerability_findings_and_identify_repository", "name": "Check MDC for vulnerability findings and identify repository", "toolsCategories": [ "microsoft-defender" ], "tools": [], "taskType": "delegating", "expectedOutput": "A detailed report of current vulnerability scanning findings from MDC and the repository name to be used for fixes.", "anticipatedSteps": 4, "dependsOn": [], "requiredOutputs": { "mdcFindings": "Detailed vulnerability findings from MDC", "repositoryName": "The repository name relevant for applying fixes" }, "requiredInputs": {} }, { "id": "Create_fixes_for_identified_vulnerabilities", "name": "Create fixes for identified vulnerabilities", "toolsCategories": [ "code" ], "tools": [], "taskType": "delegating", "expectedOutput": "Code changes or configuration updates that address the vulnerabilities, ready for a pull request.", "anticipatedSteps": 5, "dependsOn": [ 0 ], "codeIntegrationId": "dynamic", "requiredOutputs": { "fixBranchName": "Name of the branch with fixes", "pullRequestLink": "Link to the created pull request with fixes" }, "requiredInputs": { "mdcFindings": "Detailed vulnerability findings from MDC", "repositoryName": "The repository name relevant for applying fixes" } } ]

### Constraints:
- Maximum ${DelegationLimits.MAX_TOOLS_PER_SUBTASK} tools per sub-task
- Maximum ${DelegationLimits.MAX_ANTICIPATED_STEPS} steps per sub-task`;
  }
}
