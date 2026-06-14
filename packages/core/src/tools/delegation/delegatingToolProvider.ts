import { ILLMApiHandler } from '../../llm';
import { Tool } from '../types';
import { DelegateTool } from './delegateTool';
import { BaseToolProvider } from '../toolSelection/baseToolProvider';
import { SubAgentExecutor } from './subAgentExecutor';
import { DelegationLimits } from './types';
import { CodeIntegrationProvider } from '..';

/**
 * Tool provider that uses delegate_task for sub-agent execution.
 * 
 * Instead of calling tools directly, the model delegates to a sub-agent
 * that executes tools and returns only the final result.
 */
export class DelegatingToolProvider extends BaseToolProvider {
  private readonly delegateTool: DelegateTool;

  constructor(
    tools: Tool[],
    api: ILLMApiHandler,
    maxIterations: number = 20,
    codeIntegrationProvider?: CodeIntegrationProvider
  ) {
    super(tools);

    // Create the delegate_task meta-tool
    const executor = new SubAgentExecutor(api, maxIterations, codeIntegrationProvider);
    this.delegateTool = new DelegateTool(executor, tools);
  }

  /**
   * Get the delegate_task meta-tool.
   */
  override getMetaTool(): Tool {
    return this.delegateTool;
  }

  /**
   * Generate the tools section with delegation instructions.
   */
  override generateToolsPromptSection(): string {
    return `## Available Tools (via delegation)
    IMPORTANT: you can use this tools only via delegation. use the delegate_task tool with the relevant tools array.

${this.generateToolsByCategoryPromptLines()}

## Task Execution Guidelines

You have two ways to complete tasks:

### 1. Use task_complete DIRECTLY when:
- You already have all needed information (from previous delegations or context)
- You just need to summarize, analyze, or format existing data
- You can answer the user's question from what you already know

### 2. Use delegate_task ONLY when:
- You don't have all the information to complete the task
- The task requires actual tool operations (read data, call api, etc.)

REMEMBER: when you delegate a task, you have to provide the full context needed to complete it as needed, as the delegated task has clean context.

** if delegated task did not succeed because it missed information or tool you can provide, you MUST TRY AGAIN. **


IMPORTANT: After receiving results from delegate_task, if you have all the information needed, use task_complete directly. Do NOT delegate again just to summarize or format data.

Each delegate_task call should accomplish ONE logical goal with minimal tools.

GOOD sub-tasks (goal-oriented, includes analysis):
- "Read package.json and tsconfig.json, analyze the project structure and dependencies"
- "Find all TypeScript files in src/, count lines, and summarize code distribution"
- "Run tests, capture output, and identify failing test patterns"

BAD sub-tasks (too granular, requires follow-up):
- "Read package.json" → then "Analyze the contents" (combine these!)
- "List files in src" → then "Summarize files" (one sub-task should do both)
- "Run command" → then "Parse the output" (include parsing in expectedOutput)
- "Analyze files" → then "write summary to a file" (combine these!)

### Delegation Constraints:
- Maximum ${DelegationLimits.MAX_TOOLS_PER_SUBTASK} tools per sub-task
- Maximum ${DelegationLimits.MAX_ANTICIPATED_STEPS} anticipated steps per sub-task
- Break complex operations into sequential sub-tasks`;
  }

  /**
   * Get the delegate tool.
   */
  getDelegateTool(): DelegateTool {
    return this.delegateTool;
  }
}
