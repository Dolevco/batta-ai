import { ToolParseUtils } from '../../tools/parseUtils';

// Helper: build a valid single-tool JSON string
const single = (tool: string, params: Record<string, unknown> = {}) =>
  JSON.stringify({ tool, reason: 'because', parameters: params });

// Helper: build a valid array JSON string
const multi = (...tools: string[]) =>
  JSON.stringify(tools.map(t => ({ tool: t, reason: 'r', parameters: {} })));

describe('ToolParseUtils.parseAssistantTurn', () => {
  describe('single tool call', () => {
    it('parses a clean JSON tool call', () => {
      const result = ToolParseUtils.parseAssistantTurn(single('my_tool', { key: 'val' }));
      expect(result.toolUses).toHaveLength(1);
      expect(result.toolUses[0].name).toBe('my_tool');
      expect(result.toolUses[0].parameters).toEqual({ key: 'val' });
      expect(result.toolUses[0].reason).toBe('because');
    });

    it('strips markdown code fences', () => {
      const fenced = '```json\n' + single('fenced_tool') + '\n```';
      const result = ToolParseUtils.parseAssistantTurn(fenced);
      expect(result.toolUses).toHaveLength(1);
      expect(result.toolUses[0].name).toBe('fenced_tool');
    });

    it('returns text when no tool call is found', () => {
      const result = ToolParseUtils.parseAssistantTurn('just some plain text');
      expect(result.toolUses).toHaveLength(0);
      expect(result.text).toBe('just some plain text');
    });

    it('truncates reason beyond 1024 chars', () => {
      const longReason = 'r'.repeat(2000);
      const msg = JSON.stringify({ tool: 'my_tool', reason: longReason, parameters: {} });
      const result = ToolParseUtils.parseAssistantTurn(msg);
      expect(result.toolUses[0].reason.length).toBeLessThanOrEqual(1024);
    });

    it('accepts tool names up to 127 chars', () => {
      const validName = 'a'.repeat(127);
      const msg = JSON.stringify({ tool: validName, reason: 'r', parameters: {} });
      const result = ToolParseUtils.parseAssistantTurn(msg);
      expect(result.toolUses).toHaveLength(1);
      expect(result.toolUses[0].name).toBe(validName);
    });
  });

  describe('multi-tool (array) calls', () => {
    const safeSet = new Set(['tool_a', 'tool_b']);

    it('parses a JSON array of tool calls when all are concurrency-safe', () => {
      const result = ToolParseUtils.parseAssistantTurn(multi('tool_a', 'tool_b'), safeSet);
      expect(result.toolUses).toHaveLength(2);
      expect(result.toolUses.map(t => t.name)).toEqual(['tool_a', 'tool_b']);
    });

    it('returns all tools even when some are unsafe (execution layer rejects unsafe ones)', () => {
      // Only tool_a is in the safe set — tool_b is not
      const result = ToolParseUtils.parseAssistantTurn(multi('tool_a', 'tool_b'), new Set(['tool_a']));
      // Parser returns all; Task.executeTools handles the rejection
      expect(result.toolUses).toHaveLength(2);
    });

    it('returns all tools from a JSON array even with empty safe set', () => {
      const result = ToolParseUtils.parseAssistantTurn(multi('tool_a', 'tool_b'), new Set());
      expect(result.toolUses).toHaveLength(2);
    });
  });

  describe('fallback / repair', () => {
    it('handles slightly malformed JSON via jsonrepair', () => {
      // Missing closing brace — jsonrepair should fix it
      const broken = '{"tool":"fix_me","reason":"r","parameters":{}}';
      const result = ToolParseUtils.parseAssistantTurn(broken);
      expect(result.toolUses).toHaveLength(1);
      expect(result.toolUses[0].name).toBe('fix_me');
    });

    it('strips C0/C1 control characters before parsing', () => {
      const withControl = '\x01\x02' + single('clean_tool') + '\x0F';
      const result = ToolParseUtils.parseAssistantTurn(withControl);
      expect(result.toolUses).toHaveLength(1);
      expect(result.toolUses[0].name).toBe('clean_tool');
    });

    it('extracts tool JSON embedded in prose (legacy fallback)', () => {
      const prose = 'Sure, I will help you. ' + single('prose_tool') + ' Let me do that.';
      const result = ToolParseUtils.parseAssistantTurn(prose);
      expect(result.toolUses).toHaveLength(1);
      expect(result.toolUses[0].name).toBe('prose_tool');
    });
  });
});

describe('ToolParseUtils.tryParseToolUse (legacy)', () => {
  it('parses a valid tool JSON', () => {
    const result = ToolParseUtils.tryParseToolUse(single('legacy_tool', { x: 1 }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.toolUse.name).toBe('legacy_tool');
      expect(result.toolUse.parameters).toEqual({ x: 1 });
    }
  });

  it('fails when tool field is missing', () => {
    const msg = JSON.stringify({ reason: 'r', parameters: {} });
    const result = ToolParseUtils.tryParseToolUse(msg);
    expect(result.success).toBe(false);
  });

  it('fails when parameters field is missing', () => {
    const msg = JSON.stringify({ tool: 'my_tool', reason: 'r' });
    const result = ToolParseUtils.tryParseToolUse(msg);
    expect(result.success).toBe(false);
  });

  it('fails when reason field is missing', () => {
    const msg = JSON.stringify({ tool: 'my_tool', parameters: {} });
    const result = ToolParseUtils.tryParseToolUse(msg);
    expect(result.success).toBe(false);
  });

  it('fails on completely invalid JSON', () => {
    const result = ToolParseUtils.tryParseToolUse('not json at all');
    expect(result.success).toBe(false);
  });
});
