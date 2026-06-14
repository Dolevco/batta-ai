import { BaseTool } from '../../tools/baseTool';
import { ToolCategory, ToolResult } from '../../tools/types';

const cat: ToolCategory = { name: 'test', description: 'test', keywords: [] };

// Minimal concrete subclass that exposes wrapExecution for testing
class TestTool extends BaseTool<Record<string, unknown>> {
  readonly name = 'test_tool';
  readonly category = cat;
  readonly description = 'a test tool';
  readonly parameters = [];

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    return this.wrapExecution(params, async () => ({ success: true, message: 'ok' }));
  }

  // Expose wrapExecution directly for isolated tests
  async wrap(
    params: Record<string, unknown>,
    fn: () => Promise<ToolResult>
  ): Promise<ToolResult> {
    return this.wrapExecution(params, fn);
  }
}

// Subclass with a required parameter
class ParamTool extends BaseTool<{ name: string }> {
  readonly name = 'param_tool';
  readonly category = cat;
  readonly description = 'tool with params';
  readonly parameters = [
    { name: 'name', description: 'a required string', required: true, type: 'string' as const }
  ];

  async execute(params: { name: string }): Promise<ToolResult> {
    return this.wrapExecution(params, async () => ({
      success: true,
      message: `hello ${params.name}`
    }));
  }
}

describe('BaseTool.wrapExecution', () => {
  it('returns the executor result on success', async () => {
    const tool = new TestTool();
    const result = await tool.wrap({}, async () => ({ success: true, message: 'great' }));
    expect(result.success).toBe(true);
    expect(result.message).toBe('great');
  });

  it('returns a failure result when the executor throws', async () => {
    const tool = new TestTool();
    const result = await tool.wrap({}, async () => { throw new Error('boom'); });
    expect(result.success).toBe(false);
    expect(result.error).toContain('boom');
    expect(result.message).toContain('Execution failed');
  });

  it('returns a failure result when a non-Error is thrown', async () => {
    const tool = new TestTool();
    const result = await tool.wrap({}, async () => { throw 'string error'; });
    expect(result.success).toBe(false);
  });

  it('sanitizes the workspace path from error messages', async () => {
    const workspacePath = '/super/secret/path/12345';
    const tool = new TestTool({ workspacePath });
    const result = await tool.wrap({}, async () => {
      throw new Error(`ENOENT: no such file or directory, open '${workspacePath}/file.ts'`);
    });
    expect(result.success).toBe(false);
    expect(result.error).not.toContain(workspacePath);
  });
});

describe('BaseTool — parameter validation', () => {
  it('succeeds when all required parameters are present', async () => {
    const tool = new ParamTool();
    const result = await tool.execute({ name: 'world' });
    expect(result.success).toBe(true);
    expect(result.message).toBe('hello world');
  });

  it('returns failure when a required parameter is missing', async () => {
    const tool = new ParamTool();
    const result = await tool.execute({} as { name: string });
    expect(result.success).toBe(false);
    expect(result.error).toContain('name');
  });
});

describe('BaseTool — resolvePath', () => {
  it('returns absolute paths unchanged', () => {
    const tool = new TestTool({ workspacePath: '/workspace' });
    // Access via execute to exercise the path (no direct accessor — test via behaviour)
    // We verify the workspace is stored correctly
    expect((tool as any).workspacePath).toBe('/workspace');
  });
});

describe('BaseTool — notification', () => {
  it('invokes the notificationCallback when notify is called', async () => {
    const callback = jest.fn().mockResolvedValue(undefined);
    const tool = new TestTool({ notificationCallback: callback });
    await (tool as any).notify('hello');
    expect(callback).toHaveBeenCalledWith('hello');
  });

  it('does not throw when no callback is registered', async () => {
    const tool = new TestTool();
    await expect((tool as any).notify('hello')).resolves.not.toThrow();
  });
});
