import { ToolResult, ToolParameter } from '../types';
import { BaseTool } from '../baseTool';
import { Tool } from '../types';
import { DelegateToolParams, DelegationCategory, DelegationLimits, ISubAgentExecutor, SubAgentRequest } from './types';

export const DelegateToolName = 'delegate_task';

/**
 * Tool that delegates execution to a sub-agent.
 * The sub-agent handles all tool calls and returns only the final result.
 */
export class DelegateTool extends BaseTool<DelegateToolParams> {
  name = DelegateToolName;
  category = DelegationCategory;
  description: string;
  parameters: ToolParameter[];

  private readonly executor: ISubAgentExecutor;
  private readonly availableTools: Map<string, Tool>;

  constructor(executor: ISubAgentExecutor, delegatableTools: Tool[]) {
    super();
    this.executor = executor;
    this.availableTools = new Map(delegatableTools.map(t => [t.name, t]));

    this.description = `Execute a single, focused sub-task using tools.`;

    this.parameters = [
      {
        name: 'tools',
        description: `Array of tool names to use (max ${DelegationLimits.MAX_TOOLS_PER_SUBTASK}). Choose only the tools that could be needed for this specific sub-task. preffer to list more tools then needed since if a needed tool is missing the sub task will fail. for example: ['toolA', 'toolB']`,
        required: true,
        type: 'array' // array of strings
      },
      {
        name: 'intent',
        description: 'Single, specific goal. Example: "Read the package.json file" or "List files in src/"',
        required: true,
        type: 'string'
      },
      {
        name: 'context',
        description: 'The context of the task. include all the data needed to use the tools and complete the sub task',
        required: true,
        type: 'string'
      },
      {
        name: 'expectedOutput',
        description: 'Expected result. Be specific about what success looks like. should be self-contained, fully detailed result that another agent can use without prior context.',
        required: true,
        type: 'string'
      },
      {
        name: 'anticipatedSteps',
        description: `Estimated steps to complete (1-${DelegationLimits.MAX_ANTICIPATED_STEPS}). If more, consider breaking into smaller sub-tasks.`,
        required: false,
        type: 'number'
      },
      {
        name: 'requiredOutputs',
        description: `Mapping of output keys to descriptions that MUST be provided by this task (e.g., {"fileName": "the file name that affected" })`,
        required: true,
        type: 'object'
      },
      {
        name: 'requiredInputs',
        description: `Mapping of input keys to values that MUST be provided to this task to be able to complete it successfuly (e.g., {"fileName": "package.json", "taskDetails": "the actual details" }). MUST not be empty.`,
        required: true,
        type: 'object'
      }
    ];
  }

  async execute(params: DelegateToolParams): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      const { tools: toolNames, toolsCategories, taskType, intent, context, expectedOutput, anticipatedSteps, codeIntegrationId, requiredOutputs, requiredInputs } = params;

      // Validate tool count limit
      if (toolNames.length > DelegationLimits.MAX_TOOLS_PER_SUBTASK) {
        return {
          success: false,
          error: `Too many tools requested (${toolNames.length}). Maximum is ${DelegationLimits.MAX_TOOLS_PER_SUBTASK}.`,
          message: `Break this into smaller sub-tasks. Each sub-task should use at most ${DelegationLimits.MAX_TOOLS_PER_SUBTASK} tools. Consider what can be accomplished independently and delegate those as separate sub-tasks.`
        };
      }

      // Warn if anticipated steps exceed limit (soft validation - still execute)
      if (anticipatedSteps && anticipatedSteps > DelegationLimits.MAX_ANTICIPATED_STEPS) {
        console.warn(`Sub-task anticipated ${anticipatedSteps} steps, which exceeds recommended max of ${DelegationLimits.MAX_ANTICIPATED_STEPS}. Consider breaking into smaller tasks.`);
      }

      // Resolve tool names to actual tools
      const selectedTools: Tool[] = [];
      for (const name of toolNames) {
        let tool: Tool | undefined;
        if (name.includes('.')) {
            const [category, tool_name] = name.split('.');
            tool = this.availableTools.get(tool_name);
        } else {
            tool = this.availableTools.get(name);
        }

        if (tool) {
          selectedTools.push(tool);
        }
      }

      const availableTools = Array.from(this.availableTools.values());

      // If any selected tool's category requires including all tools from that category,
      // add the rest of the tools from the same category.
      const categoriesToExpand = new Set<string>();
      for (const t of selectedTools) {
        if ((t.category as any)?.requireAllTools) {
          categoriesToExpand.add(t.category.name.toLowerCase());
        }
      }

      if (categoriesToExpand.size > 0) {
        for (const t of availableTools) {
          if (categoriesToExpand.has(t.category.name.toLowerCase()) &&
              selectedTools.every(st => st.name !== t.name)) {
            selectedTools.push(t);
          }
        }
      }

      // Also include any tools from categories explicitly requested via toolsCategories
      availableTools.forEach(t => {
        if (toolsCategories?.some(tc => tc.toLowerCase() === t.category.name.toLowerCase()) &&
            selectedTools.every(st => st.name !== t.name)) {
          selectedTools.push(t);
        }
      })

      /*if (selectedTools.length === 0 && !codeIntegrationId) {
        return {
          success: false,
          error: 'No valid tools selected',
          message: `Available: ${Array.from(this.availableTools.keys()).join(', ')}`
        };
      }*/

      const request: SubAgentRequest = {
        intent,
        context,
        expectedOutput,
        taskType,
        tools: selectedTools,
        anticipatedSteps: Math.max(anticipatedSteps ?? 0, 5),
        events: params.events,
        dependencyResults: params.requiredInputs,
        codeIntegrationId,
        requiredOutputs,
      };

      const result = await this.executor.execute(request);

      return {
        success: result.success,
        result: result.result,
        message: result.success ? result.result : `Failed: ${result.error}`,
        error: result.error,
        requiredOutput: result.requiredOutput
      };
    });
  }
}
