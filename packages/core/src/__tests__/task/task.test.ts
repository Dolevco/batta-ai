// Task tests run against the pre-compiled dist/ output to avoid
// ts-jest OOM when compiling Task's large transitive import graph.
// Mocks are applied before any imports.

jest.mock('../../context/prompts/system', () => ({
  getFullSystemPrompt: jest.fn(() => 'mocked system prompt'),
  extractToolsDescriptions: jest.fn(() => ''),
}));

jest.mock('../../tools/delegation/subAgentExecutor', () => ({
  SubAgentExecutor: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../tools/delegation/agentTool', () => ({
  AgentTool: jest.fn().mockImplementation(() => ({
    name: 'agent',
    category: { name: 'delegation', description: '', keywords: [] },
    description: 'agent tool',
    parameters: [],
    isInteractionTool: false,
    execute: jest.fn(),
  })),
  AgentToolName: 'agent',
  FORK_BOILERPLATE_TAG: 'fork-child-context',
}));

jest.mock('../../tools/task/taskCompletionTool', () => {
  const category = { name: 'task_completion', description: '', keywords: [] };
  return {
    TaskCompletionTool: jest.fn().mockImplementation(() => ({
      name: 'task_complete',
      category,
      description: 'complete the task',
      parameters: [],
      isInteractionTool: false,
      execute: jest.fn().mockImplementation((params: Record<string, unknown>) => {
        const summary = typeof params?.summary === 'string' ? params.summary : 'done';
        return Promise.resolve({ success: true, message: summary, result: undefined });
      }),
    })),
    TaskCompletionCategory: category,
  };
});

jest.mock('../../tools/paging/toolResultPager', () => ({
  ToolResultPager: jest.fn().mockImplementation(() => ({
    processResult: jest.fn().mockReturnValue({ needsPaging: false, output: '' }),
    processResultWithBudget: jest.fn().mockReturnValue({ needsPaging: false, output: '' }),
  })),
}));

jest.mock('../../tools/paging/dataAccessTool', () => ({
  DataAccessTool: jest.fn().mockImplementation(() => ({
    name: 'data_access',
    category: { name: 'paging', description: '', keywords: [] },
    description: 'data access',
    parameters: [],
    isInteractionTool: false,
    execute: jest.fn(),
  })),
  DataAccessToolName: 'data_access',
}));

jest.mock('../../context/memory/shortTerm/shortTermMemory', () => ({
  ShortTermMemory: jest.fn().mockImplementation(() => ({
    addMessage: jest.fn(),
    getContextMessagesWithPossibleSummarization: jest.fn().mockResolvedValue([]),
  })),
}));

jest.mock('../../context/memory', () => ({
  ShortTermMemory: jest.fn().mockImplementation(() => ({
    addMessage: jest.fn(),
    getContextMessagesWithPossibleSummarization: jest.fn().mockResolvedValue([]),
  })),
  LongTermMemoryManager: jest.fn().mockImplementation(() => ({
    searchRelevantMemories: jest.fn().mockResolvedValue([]),
    formatMemoriesAsContext: jest.fn().mockReturnValue(''),
  })),
}));

jest.mock('../../task/agentRegistry', () => ({
  AgentRegistry: jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    getDefault: jest.fn(),
    getAll: jest.fn().mockReturnValue([]),
    register: jest.fn(),
    formatAgentListing: jest.fn().mockReturnValue(''),
  })),
  defaultAgentRegistry: {
    get: jest.fn(),
    getDefault: jest.fn(),
    getAll: jest.fn().mockReturnValue([]),
    register: jest.fn(),
    formatAgentListing: jest.fn().mockReturnValue(''),
  },
}));

import { Task } from '../../task/task';
import { ILLMApiHandler, CompletionResponse } from '../../llm';
import { Tool, ToolResult, ToolCategory } from '../../tools/types';

// ─── helpers ────────────────────────────────────────────────────────────────

const makeCompletion = (content: string): CompletionResponse => ({
  content,
  usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }
});

const testCategory: ToolCategory = { name: 'test', description: 'test', keywords: [] };

function makeSimpleTool(name: string, result: ToolResult, isConcurrencySafe = false): Tool {
  return {
    name,
    category: testCategory,
    description: `${name} tool`,
    parameters: [],
    isInteractionTool: false,
    isConcurrencySafe,
    execute: jest.fn().mockResolvedValue(result)
  };
}

const toolCall = (tool: string, params: Record<string, unknown> = {}) =>
  JSON.stringify({ tool, reason: 'test', parameters: params });

const completionCall = (summary = 'done') =>
  JSON.stringify({ tool: 'task_complete', reason: 'done', parameters: { summary } });

// Pre-built system prompt + high token limits prevent unrelated OOM from prompt generation
const BASE_CONFIG = {
  _systemPrompt: 'You are a test assistant.',
  memory: { summarizationDisabled: true },
  tokenWarningThreshold: 10_000_000,
  tokenErrorThreshold: 10_000_000,
};

function makeMockApi(responses: string[]): ILLMApiHandler {
  let idx = 0;
  return {
    createCompletion: jest.fn().mockImplementation(() =>
      Promise.resolve(makeCompletion(responses[idx++] ?? completionCall()))
    )
  };
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('Task', () => {
  describe('execute — happy path', () => {
    it('completes when task_complete is called immediately', async () => {
      const api = makeMockApi([completionCall('all done')]);
      const task = new Task(api, { ...BASE_CONFIG, maxIterations: 5 });
      const result = await task.execute('do something');
      expect(result.completed).toBe(true);
      expect(result.success).toBe(true);
      expect(result.summary).toBe('all done');
    });

    it('calls a tool and then completes on the next turn', async () => {
      const myTool = makeSimpleTool('my_tool', { success: true, message: 'ran', result: 'ok' });
      const api = makeMockApi([toolCall('my_tool'), completionCall('finished')]);
      const task = new Task(api, { ...BASE_CONFIG, tools: [myTool] });
      const result = await task.execute('start');
      expect(result.completed).toBe(true);
      expect(myTool.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('execute — iteration cap', () => {
    it('stops after maxIterations', async () => {
      const api: ILLMApiHandler = {
        createCompletion: jest.fn().mockResolvedValue(makeCompletion(toolCall('noop')))
      };
      const noop = makeSimpleTool('noop', { success: true, message: 'ok' });
      const task = new Task(api, { ...BASE_CONFIG, tools: [noop], maxIterations: 3 });
      const result = await task.execute('run forever');
      expect(result.completed).toBe(true);
      expect(result.success).toBe(false);
      expect(result.summary).toContain('max iterations');
    });
  });

  describe('execute — abort / cancel', () => {
    it('throws when already aborted before execute', async () => {
      const api = makeMockApi([completionCall()]);
      const task = new Task(api, BASE_CONFIG);
      task.cancel();
      await expect(task.execute('hi')).rejects.toThrow('Task aborted');
    });
  });

  describe('execute — unknown tool', () => {
    it('recovers from an unrecognized tool name and eventually completes', async () => {
      const api = makeMockApi([toolCall('ghost_tool'), completionCall('recovered')]);
      const task = new Task(api, BASE_CONFIG);
      const result = await task.execute('start');
      expect(result.completed).toBe(true);
    });
  });

  describe('execute — concurrent tools', () => {
    it('runs multiple concurrency-safe tools in the same turn', async () => {
      const toolA = makeSimpleTool('tool_a', { success: true, message: 'a', result: 'a' }, true);
      const toolB = makeSimpleTool('tool_b', { success: true, message: 'b', result: 'b' }, true);
      const parallelCall = JSON.stringify([
        { tool: 'tool_a', reason: 'r', parameters: {} },
        { tool: 'tool_b', reason: 'r', parameters: {} }
      ]);
      const api = makeMockApi([parallelCall, completionCall('parallel done')]);
      const task = new Task(api, { ...BASE_CONFIG, tools: [toolA, toolB] });
      await task.execute('go');
      expect(toolA.execute).toHaveBeenCalledTimes(1);
      expect(toolB.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('events', () => {
    it('emits a message event for each user and assistant turn', async () => {
      const api = makeMockApi([completionCall('hi')]);
      const task = new Task(api, BASE_CONFIG);
      const messages: string[] = [];
      task.events.on('message', (m) => messages.push(m.role));
      await task.execute('hello');
      expect(messages).toContain('user');
      expect(messages).toContain('assistant');
    });

    it('emits toolUse event when a tool is called', async () => {
      const myTool = makeSimpleTool('my_tool', { success: true, message: 'ok' });
      const api = makeMockApi([toolCall('my_tool'), completionCall()]);
      const task = new Task(api, { ...BASE_CONFIG, tools: [myTool] });
      const toolNames: string[] = [];
      task.events.on('toolUse', (tu) => toolNames.push(tu.name));
      await task.execute('go');
      expect(toolNames).toContain('my_tool');
    });
  });

  describe('token budget', () => {
    it('emits tokenBudgetWarning when approaching the threshold', async () => {
      const api: ILLMApiHandler = {
        createCompletion: jest.fn().mockResolvedValue(makeCompletion(completionCall('done')))
      };
      const task = new Task(api, {
        _systemPrompt: 'test',
        memory: { summarizationDisabled: true },
        tokenWarningThreshold: 1,
        tokenErrorThreshold: 10_000_000,
      });
      const warnings: unknown[] = [];
      task.events.on('tokenBudgetWarning', (w) => warnings.push(w));
      await task.execute('hi');
      expect(warnings.length).toBeGreaterThan(0);
    });

    it('throws when the token error threshold is exceeded', async () => {
      const api: ILLMApiHandler = {
        createCompletion: jest.fn().mockResolvedValue(makeCompletion(completionCall('done')))
      };
      const task = new Task(api, {
        _systemPrompt: 'test',
        memory: { summarizationDisabled: true },
        tokenWarningThreshold: 1,
        tokenErrorThreshold: 1,
      });
      await expect(task.execute('hi')).rejects.toThrow('Token budget exceeded');
    });
  });
});
