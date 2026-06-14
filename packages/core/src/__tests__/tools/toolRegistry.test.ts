import { ToolRegistry } from '../../tools/toolRegistry';
import { Tool, ToolCategory, ToolResult } from '../../tools/types';

const cat: ToolCategory = { name: 'test', description: 'test', keywords: [] };

function makeTool(name: string, result: ToolResult = { success: true, message: 'ok' }): Tool {
  return {
    name,
    category: cat,
    description: name,
    parameters: [],
    isInteractionTool: false,
    execute: jest.fn().mockResolvedValue(result)
  };
}

describe('ToolRegistry', () => {
  describe('constructor', () => {
    it('is empty when no tools are passed', () => {
      const registry = new ToolRegistry();
      expect(registry.getTools()).toHaveLength(0);
    });

    it('initializes with provided tools', () => {
      const toolA = makeTool('tool_a');
      const toolB = makeTool('tool_b');
      const registry = new ToolRegistry([toolA, toolB]);
      expect(registry.getTools()).toHaveLength(2);
    });
  });

  describe('register', () => {
    it('adds a new tool', () => {
      const registry = new ToolRegistry();
      registry.register(makeTool('my_tool'));
      expect(registry.getTool('my_tool')).toBeDefined();
    });

    it('overwrites a tool with the same name', () => {
      const registry = new ToolRegistry();
      const v1 = makeTool('dup');
      const v2 = makeTool('dup');
      registry.register(v1);
      registry.register(v2);
      expect(registry.getTool('dup')).toBe(v2);
      expect(registry.getTools()).toHaveLength(1);
    });
  });

  describe('getTool', () => {
    it('returns undefined for unknown tool', () => {
      const registry = new ToolRegistry();
      expect(registry.getTool('ghost')).toBeUndefined();
    });

    it('returns the correct tool by name', () => {
      const tool = makeTool('known');
      const registry = new ToolRegistry([tool]);
      expect(registry.getTool('known')).toBe(tool);
    });
  });

  describe('getTools', () => {
    it('returns a snapshot — mutations do not affect the registry', () => {
      const registry = new ToolRegistry([makeTool('t1')]);
      const snap = registry.getTools();
      snap.push(makeTool('injected'));
      expect(registry.getTools()).toHaveLength(1);
    });
  });

  describe('execute', () => {
    it('delegates to the tool and returns its result', async () => {
      const expected: ToolResult = { success: true, message: 'executed', result: 42 };
      const tool = makeTool('runner', expected);
      const registry = new ToolRegistry([tool]);
      const result = await registry.execute('runner', {});
      expect(result).toEqual(expected);
      expect(tool.execute).toHaveBeenCalledWith({});
    });

    it('returns a failure result for an unknown tool', async () => {
      const registry = new ToolRegistry();
      const result = await registry.execute('ghost', {});
      expect(result.success).toBe(false);
      expect(result.message).toContain('ghost');
    });

    it('catches exceptions from tool.execute and returns a failure result', async () => {
      const tool = makeTool('bomb');
      (tool.execute as jest.Mock).mockRejectedValue(new Error('kaboom'));
      const registry = new ToolRegistry([tool]);
      const result = await registry.execute('bomb', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('kaboom');
    });

    it('passes parameters through to the tool', async () => {
      const tool = makeTool('echo');
      const registry = new ToolRegistry([tool]);
      const params = { key: 'value', count: 3 };
      await registry.execute('echo', params);
      expect(tool.execute).toHaveBeenCalledWith(params);
    });
  });
});
