import { TaskConfig, Message, TaskEventMap, TaskResult, Role, ToolActivity, SubAgentProgress } from './types';
import { TypedEventEmitter } from './eventEmitter';
import { ILLMApiHandler, IEmbeddingHandler, CompletionResponse } from '../api';
import { ToolRegistry, Tool, ToolResult, ToolUse, ToolParseUtils, ToolResultPager, DataAccessTool, DataAccessToolName } from '../tools';
import { ShortTermMemory, LongTermMemoryManager } from '../context/memory';
import { TaskCompletionCategory, TaskCompletionTool } from '../tools/task/taskCompletionTool';
import { extractToolsDescriptions, getFullSystemPrompt } from '../context/prompts/system';
import { MODES } from '../context/prompts/modes';
import { AgentTool, AgentToolName, FORK_BOILERPLATE_TAG } from '../tools/delegation/agentTool';
import { SubAgentExecutor } from '../tools/delegation/subAgentExecutor';
import { defaultAgentRegistry } from './agentRegistry';

// Token budget defaults
const DEFAULT_TOKEN_WARNING_THRESHOLD = 100_000; //160_000;
const DEFAULT_TOKEN_ERROR_THRESHOLD = 120_000; //190_000;

export class Task {
  // public emitter instance to be shared/passed to sub-tasks / tools
  public readonly events: TypedEventEmitter<TaskEventMap>;
  // Indicates whether this Task instance has been requested to abort
  protected aborted: boolean = false;

  protected api: ILLMApiHandler;
  protected toolRegistry: ToolRegistry;
  protected shortTermMemory: ShortTermMemory;
  protected longTermMemoryManager?: LongTermMemoryManager;
  protected systemMessage: Message;
  protected maxIterations?: number;
  protected toolResultPager: ToolResultPager;
  protected conversationHistory: Message[] = [];
  protected iterationCount: number = 0;
  /** Workspace path passed to sub-agents so file tools resolve correctly */
  protected workspace?: string;
  private tokenWarningThreshold: number;
  private tokenErrorThreshold: number;
  private tokenWarningEmitted: boolean = false;

  // Sub-agent progress tracking
  private subAgentToolUseCount: number = 0;
  private subAgentEstimatedTokens: number = 0;
  private recentActivities: ToolActivity[] = [];
  private static readonly MAX_RECENT_ACTIVITIES = 5;

  constructor(api: ILLMApiHandler, config: TaskConfig, embeddingHandler?: IEmbeddingHandler) {
    // use provided shared emitter or create a new one
    this.events = config?.events ?? new TypedEventEmitter<TaskEventMap>();

    // If this Task shares an external events emitter, listen for abort to mark this instance as aborted.
    // This allows a parent PlannedTask to emit 'abort' and have sub-agent tasks stop promptly.
    try {
      this.events.on('abort', () => {
        // Do not re-emit here to avoid loops; just set the internal flag so execute() will stop.
        this.aborted = true;
      });
    } catch (e) {
      // ignore if listener cannot be attached for some reason
    }

    this.api = api;
    this.toolResultPager = new ToolResultPager();

    // Auto-build the system prompt when not explicitly provided.
    // Pre-populate tools so the prompt lists them; builtin tools are injected below.
    const registry = config.agentRegistry ?? defaultAgentRegistry;

    // Determine whether we need to auto-create a SubAgentExecutor.
    // This ensures every Task can spawn sub-agents without requiring callers to wire one up.
    let effectiveConfig = { ...config };
    if (!effectiveConfig.agentExecutor) {
      const executor = new SubAgentExecutor(
        api,
        effectiveConfig.maxSubAgentIterations ?? 20,
        effectiveConfig.codeIntegrationProvider,
        undefined,
        registry
      );
      effectiveConfig = { ...effectiveConfig, agentExecutor: executor, agentRegistry: registry };
    }

    // Build the full tool list (including builtins) before generating the system prompt so the
    // prompt accurately lists all available tools (including agent, todo_write, todo_read, task_complete).
    const toolsForPrompt = this.ensureBuiltinTools(effectiveConfig.tools || [], effectiveConfig);

    // Always build the system prompt internally so it always includes the full built-in tool
    // definitions. Specialised subclasses within the core package may pass a pre-built prompt
    // via `_systemPrompt` (internal-only field); all other callers use mode/customInstructions/workspace.
    const systemPrompt = effectiveConfig._systemPrompt ?? getFullSystemPrompt(
      toolsForPrompt,
      effectiveConfig.mode ?? MODES.DELEGATING_TASK,
      effectiveConfig.customInstructions,
      effectiveConfig.workspace
    );

    this.systemMessage = { role: 'system', content: systemPrompt };
    this.toolRegistry = new ToolRegistry(toolsForPrompt);
    this.shortTermMemory = new ShortTermMemory(this.api, effectiveConfig.memory || {}, (summary) => this.events.emit('memorySummary', summary));
    this.maxIterations = effectiveConfig.maxIterations;
    this.workspace = effectiveConfig.workspace;

    // token budget thresholds
    this.tokenWarningThreshold = effectiveConfig.tokenWarningThreshold ?? DEFAULT_TOKEN_WARNING_THRESHOLD;
    this.tokenErrorThreshold = effectiveConfig.tokenErrorThreshold ?? DEFAULT_TOKEN_ERROR_THRESHOLD;

    // Initialize long-term memory manager if enabled
    const enableLongTermMemory = effectiveConfig.enableLongTermMemory ?? false;
    if (enableLongTermMemory && embeddingHandler) {
      this.longTermMemoryManager = new LongTermMemoryManager(api, embeddingHandler, effectiveConfig.longTermMemory);
    }

    // Seed conversation history if provided
    if (effectiveConfig.conversationHistory && effectiveConfig.conversationHistory.length > 0) {
      for (const msg of effectiveConfig.conversationHistory) {
        this.shortTermMemory.addMessage(msg);
        this.conversationHistory.push(msg);
      }
    }
  }

  /**
   * Call the underlying completion API. Subclasses can override to provide streaming behavior.
   */
  protected async callCompletion(messages: Message[]): Promise<CompletionResponse> {
    return this.api.createCompletion(messages);
  }

  protected isTaskCompleted(toolResult: ToolResult, tool: Tool | undefined): boolean {
    return tool?.category === TaskCompletionCategory && !toolResult?.error;
  }

  protected getTaskCompletionResult<T>(toolResult: ToolResult, tool: Tool | undefined): TaskResult<T> {
    return {
      success: toolResult.success,
      completed: true,
      summary: toolResult.message,
      result: toolResult.result,
      requiredOutput: toolResult.requiredOutput
    };
  }

  async execute<T = unknown>(input: string): Promise<TaskResult<T>> {
    try {
      // Respect cancellation requests
      if (this.aborted) {
        throw new Error('Task aborted');
      }
      // Check max iterations
      this.iterationCount++;
      if (this.maxIterations && this.iterationCount > this.maxIterations) {
        return {
          success: false,
          completed: true,
          summary: `Task stopped: max iterations (${this.maxIterations}) reached`
        };
      }

      // On first message, try to retrieve relevant memories
      if (this.conversationHistory.length === 0 && this.longTermMemoryManager) {
        await this.injectRelevantMemories(input);
      }

      this.addMessageToHistory('user', input);
      const contextMessages = await this.shortTermMemory.getContextMessagesWithPossibleSummarization();
      const messages: Message[] = [this.systemMessage, ...contextMessages];

      // check token budget before calling the LLM
      this.checkTokenBudget(messages);

      const completion = await this.callCompletion(messages);
      const currentMessage = completion.content;
      this.addMessageToHistory('assistant', currentMessage);

      // update running token estimate after receiving the response
      this.subAgentEstimatedTokens = this.estimateTokens(messages) + Math.ceil(currentMessage.length / 4);

      // parse multi-tool turn — only concurrent-safe tools may appear together.
      // Pass the set of concurrency-safe tool names so the parser can enforce the rule.
      const concurrencySafeNames = new Set(
        this.toolRegistry.getTools()
          .filter((t: Tool) => t.isConcurrencySafe === true)
          .map((t: Tool) => t.name)
      );
      const parsedTurn = ToolParseUtils.parseAssistantTurn(currentMessage, concurrencySafeNames);

      if (parsedTurn.toolUses.length > 0) {
        if (this.aborted) throw new Error('Task aborted');

        // execute tools concurrently where safe
        const toolResults = await this.executeTools(parsedTurn.toolUses, parsedTurn.concurrencySafeToolNames);

        // Check if any tool completed the task
        for (let i = 0; i < parsedTurn.toolUses.length; i++) {
          const tool = this.toolRegistry.getTool(parsedTurn.toolUses[i].name);
          const result = toolResults[i];
          if (this.isTaskCompleted(result, tool)) {
            return this.getTaskCompletionResult<T>(result, tool);
          }
          if (!!tool?.isInteractionTool) {
            return { success: result.success, completed: false, summary: result.result, result: result.result as T };
          }
        }

        // Build combined result message for next turn
        const combinedResult = toolResults.length === 1
          ? JSON.stringify(toolResults[0])
          : JSON.stringify(toolResults);

        return this.execute(combinedResult);
      }

      return this.execute(`invalid tool use: ${parsedTurn.text ?? 'no tool call found'}`);
    } catch (error: any) {
      this.events.emit('error', error);
      throw error;
    }
  }

  /**
   * Execute multiple tool uses from a single assistant turn.
   * Runs concurrently when ALL tools are concurrency-safe; otherwise sequentially.
   *
   * Security note: Tool names are validated against the registry before execution.
   * Unknown tools return a safe error result rather than throwing.
   */
  protected async executeTools(toolUses: ToolUse[], concurrencySafeToolNames?: ReadonlySet<string>): Promise<ToolResult[]> {
    if (toolUses.length <= 1) {
      const results: ToolResult[] = [];
      for (const tu of toolUses) {
        if (this.aborted) break;
        results.push(await this.executeTool(tu));
      }
      return results;
    }

    // Determine safe set: prefer the parsed turn's set, fall back to registry
    const safeNames = concurrencySafeToolNames ?? new Set(
      this.toolRegistry.getTools()
        .filter((t: Tool) => t.isConcurrencySafe === true)
        .map((t: Tool) => t.name)
    );

    const safeUses = toolUses.filter(tu => safeNames.has(tu.name));
    const unsafeUses = toolUses.filter(tu => !safeNames.has(tu.name));

    // Run safe tools in parallel; return synthetic failures for unsafe ones
    const safeResults = await Promise.all(safeUses.map(tu => this.executeTool(tu)));
    const unsafeResults: ToolResult[] = unsafeUses.map(tu => ({
      success: false,
      message: `Tool '${tu.name}' is not concurrency-safe and cannot run in a parallel batch`,
      error: `Tool '${tu.name}' is not concurrency-safe and cannot run in a parallel batch`
    }));

    // Reconstruct results in original order
    const safeIter = safeResults[Symbol.iterator]();
    const unsafeIter = unsafeResults[Symbol.iterator]();
    return toolUses.map(tu =>
      safeNames.has(tu.name) ? safeIter.next().value! : unsafeIter.next().value!
    );
  }

  /**
   * Request cancellation of this Task. This will set an internal flag and emit an 'abort' event.
   * Long-running operations check this flag and will stop by throwing an error.
   */
  public cancel(): void {
    if (this.aborted) return;
    this.aborted = true;
    try {
      this.events.emit('abort', { message: 'Task aborted' } as any);
    } catch (e) {
      // ignore
    }
  }

  /**
   * Retrieve relevant memories from long-term storage and inject into context.
   */
  private async injectRelevantMemories(userInput: string): Promise<void> {
    if (!this.longTermMemoryManager) return;

    try {
      const memories = await this.longTermMemoryManager.searchRelevantMemories(userInput);

      if (memories.length > 0) {
        const memorySummaries = memories.map(m => m.summary);
        this.events.emit('memoryRetrieved', memorySummaries);

        // Inject memories as a system message at the start
        const memoryContext = this.longTermMemoryManager.formatMemoriesAsContext(memories);
        this.shortTermMemory.addMessage({
          role: 'system',
          content: memoryContext
        });
      }
    } catch (error) {
      console.error('Task: Failed to retrieve memories', error);
      // Don't fail the task if memory retrieval fails
    }
  }

  /**
   * Evaluate the conversation and store in long-term memory if valuable.
   */
  private async evaluateAndStoreMemory(): Promise<void> {
    if (!this.longTermMemoryManager) return;

    try {
      const result = await this.longTermMemoryManager.evaluateAndStore(this.conversationHistory);

      if (result.isValuable && result.summary) {
        this.events.emit('memoryStored', result.summary);
      }
    } catch (error) {
      console.error('Task: Failed to evaluate/store memory', error);
      // Don't fail the task if memory storage fails
    }
  }

  public updateNotificationCallback(callback: (message: string) => Promise<void>): void {
    this.toolRegistry.updateNotificationCallback(callback);
  }

  private addMessageToHistory(role: Role, content: string) {
    const message = { role, content };
    this.shortTermMemory.addMessage(message);
    this.conversationHistory.push(message); // Keep full history for memory evaluation
    this.events.emit('message', message);
  }

  private async executeTool(toolUse: ToolUse): Promise<ToolResult> {
    const tool = this.toolRegistry.getTool(toolUse.name);

    if (!tool) {
      const availableTools = this.toolRegistry.getTools().map((t: Tool) => t.name).join(', ');
      const error = `Tool '${toolUse.name}' not found in available tools: [${availableTools}]`;
      return { success: false, error, message: `Tool not found: ${toolUse.name}` };
    }

    try {
      if (this.aborted) throw new Error('Task aborted');
      this.events.emit('toolUse', toolUse);

      // track activity description for sub-agent progress
      const activityDescription = tool.getActivityDescription?.(toolUse.parameters);
      const activity: ToolActivity = {
        toolName: toolUse.name,
        parameters: toolUse.parameters,
        activityDescription,
        timestamp: Date.now()
      };
      this.subAgentToolUseCount++;
      this.recentActivities = [activity, ...this.recentActivities].slice(0, Task.MAX_RECENT_ACTIVITIES);

      // emit sub-agent progress on each tool use
      const progress: SubAgentProgress = {
        subTaskIndex: 0,
        subTaskName: toolUse.name,
        toolUseCount: this.subAgentToolUseCount,
        estimatedTokens: this.subAgentEstimatedTokens,
        lastActivity: activity,
        recentActivities: [...this.recentActivities]
      };
      this.events.emit('subAgentProgress', progress);

      // for the `agent` tool with fork=true, inject the current conversation
      // history so the child agent starts with the parent's full context.
      //
      // The fork boilerplate tag is prepended to the injected history so the child agent's
      // AgentTool.execute() can detect it (via isAlreadyForkChild) and reject nested forks.
      let execParams: Record<string, unknown> = { ...toolUse.parameters, events: this.events };
      if (toolUse.name === AgentToolName) {
        // Always forward the parent's workspace so the sub-agent's file tools resolve
        // paths correctly, unless the caller already supplied an explicit workspace.
        if (this.workspace && execParams.workspace === undefined) {
          execParams = { ...execParams, workspace: this.workspace };
        }
      }
      if (toolUse.name === AgentToolName && toolUse.parameters.fork === true) {
        // Stamp the fork-child boilerplate into the injected history so nested fork
        // attempts are detected and rejected in AgentTool.execute().
        const forkBoilerplate: Message = {
          role: 'system',
          content:
            `<${FORK_BOILERPLATE_TAG}>\n` +
            `You are a forked worker. Do NOT spawn further sub-agents via the \`agent\` tool — ` +
            `use your tools directly to complete the task.\n` +
            `</${FORK_BOILERPLATE_TAG}>`
        };
        execParams = {
          ...execParams,
          parentHistory: [forkBoilerplate, ...this.conversationHistory]
        };
      }

      const result = await tool.execute(execParams);

      // Apply paging to large results (skip for data_access tool itself)
      if (result.success && result.result && toolUse.name !== DataAccessToolName) {
        const resultStr = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);

        // respect per-tool maxResultSizeChars budget
        if (!this.processFileResultIfLarge(result, tool, resultStr)) {
          this.applyPagingIfNeeded(result, resultStr, tool.maxResultSizeChars);
        }
      }

      this.events.emit('toolResult', { name: toolUse.name, ...result });
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.events.emit('error', new Error(`Tool execution failed: ${errorMessage}`));

      return {
        success: false,
        message: `Tool execution failed: ${toolUse.name}`,
        error: errorMessage
      };
    }
  }

  /**
   * Handle very large file tool results by replacing the content with a paged preview.
   *
   * char-based threshold (50 000 chars ≈ ~1 000 lines of typical code) fed through the
   * ToolResultPager, so the agent gets a structured preview with `_dataId` and can use
   * `data_access` or `read_file` with fromLine/toLine for subsequent fetches.
   *
   * The line-count hint is still included in the preview message so the agent knows
   * to use `read_file` with a range rather than `data_access` for files (files are on
   * disk; `read_file` is more appropriate than the in-memory OData pager for them).
   */
  private processFileResultIfLarge(result: ToolResult, tool: Tool | undefined, resultStr: string): boolean {
    if (tool?.category?.name !== 'files' || typeof result.result !== 'string') return false;

    // Char-based threshold — consistent with how all other tools are evaluated.
    // 50 000 chars ≈ ~12 500 tokens, a meaningful but not overwhelming chunk.
    const FILE_CHAR_THRESHOLD = 50_000;
    if (resultStr.length <= FILE_CHAR_THRESHOLD) return false;

    this.ensureDataAccessToolRegistered();

    const lines = resultStr.split('\n');
    const lineCount = lines.length;

    // Newline-aware preview
    const PREVIEW_CHARS = 3_000;
    const raw = resultStr.slice(0, PREVIEW_CHARS);
    const lastNewline = raw.lastIndexOf('\n');
    const cutPoint = lastNewline > PREVIEW_CHARS * 0.5 ? lastNewline : PREVIEW_CHARS;
    const preview = resultStr.slice(0, cutPoint);

    const message =
      `File content is too long (${lineCount} lines / ${resultStr.length} chars). ` +
      `Showing a preview of the first ${preview.split('\n').length} lines. ` +
      `Use 'read_file' with fromLine/toLine to fetch a specific range, or ` +
      `'search_files_content' with a regex to locate the block related to your query.\n\n` +
      `Preview:\n${preview}`;

    result.result = message;
    result.message = message;
    (result as any).metadata = { lines: lineCount, chars: resultStr.length, truncated: true };
    (result as any).preview = preview;

    return true;
  }

  /**
   * Apply generic paging behavior and ensure data access tool is available when paging is used.
   * Respects per-tool maxResultSizeChars budget if set; otherwise uses default threshold.
   */
  private applyPagingIfNeeded(result: ToolResult, resultStr: string, maxResultSizeChars?: number): void {
    // Override pager threshold if the tool specifies a budget
    const paged = maxResultSizeChars != null
      ? this.toolResultPager.processResultWithBudget(resultStr, maxResultSizeChars)
      : this.toolResultPager.processResult(resultStr);
    if (paged.needsPaging) {
      result.result = paged.output;
      this.ensureDataAccessToolRegistered();
    }
  }

  // Ensure DataAccessTool is registered and advertise it in the short-term memory
  private ensureDataAccessToolRegistered(): void {
    if (!this.toolRegistry.getTool(DataAccessToolName)) {
      const dataAccessTool = new DataAccessTool(this.toolResultPager);
      this.toolRegistry.register(dataAccessTool);
      // Inject tool description into context so model knows about it
      this.shortTermMemory.addMessage({
        role: 'system',
        content: `NEW TOOL AVAILABLE - ${extractToolsDescriptions([dataAccessTool])}`
      });
    }
  }

  /**
   * Check current token budget and emit warning/error events.
   *
   * Security note: Only token counts are tracked here (message lengths / 4).
   * No message content is emitted in the tokenBudgetWarning event.
   */
  private checkTokenBudget(messages: Message[]): void {
    const estimatedTokens = this.estimateTokens(messages);
    this.subAgentEstimatedTokens = estimatedTokens;

    if (estimatedTokens >= this.tokenErrorThreshold) {
      this.events.emit('tokenBudgetExceeded', {
        estimatedTokens,
        threshold: this.tokenErrorThreshold
      });
      // Hard limit: abort execution to avoid context overflow
      throw new Error(
        `Token budget exceeded: estimated ${estimatedTokens} tokens exceeds limit of ${this.tokenErrorThreshold}. ` +
        `Consider enabling summarization or reducing context.`
      );
    }

    if (!this.tokenWarningEmitted && estimatedTokens >= this.tokenWarningThreshold) {
      this.tokenWarningEmitted = true;
      const percentUsed = Math.round((estimatedTokens / this.tokenErrorThreshold) * 100);
      this.events.emit('tokenBudgetWarning', {
        estimatedTokens,
        threshold: this.tokenWarningThreshold,
        percentUsed
      });
    }
  }

  /**
   * Rough token estimation using character count heuristic.
   */
  private estimateTokens(messages: Message[]): number {
    const charsPerToken = 4;
    return messages.reduce((sum, m) => sum + Math.ceil(m.content.length / charsPerToken), 0);
  }

  /**
   * Ensure all built-in tools are present in the tool list.
   *
   * Built-in tools are always injected regardless of what the caller provides:
   *   1. task_complete  — every task needs a way to signal completion.
   *   2. agent — spawns sub-agents; backed by the provided or
   *      auto-created agentExecutor. Every Task has agent-spawning capability.
   *
   * Callers that already include any of these tools keep their own version
   * (deduplication is by tool name).
   */
  private ensureBuiltinTools(tools: Tool[], config: TaskConfig): Tool[] {
    let result = [...tools];

    // 1. task_complete
    if (!result.some(t => t.category === TaskCompletionCategory)) {
      result = [new TaskCompletionTool(), ...result];
    }

    // 2. agent tool  — inject when executor available and not already present
    if (config.agentExecutor && !result.some(t => t.name === AgentToolName)) {
      const registry = config.agentRegistry ?? defaultAgentRegistry;
      // Sub-agents receive all non-interaction tools from the parent
      const delegatableTools = result.filter(t => !t.isInteractionTool);
      result.push(new AgentTool(config.agentExecutor, delegatableTools, registry));
    }

    return result;
  }
}
