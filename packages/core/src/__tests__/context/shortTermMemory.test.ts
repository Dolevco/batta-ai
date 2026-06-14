import { ShortTermMemory } from '../../context/memory/shortTerm/shortTermMemory';
import { ILLMApiHandler } from '../../llm';
import { Message } from '../../task/types';

function makeApi(summaryText = 'summary'): ILLMApiHandler {
  return {
    createCompletion: jest.fn().mockResolvedValue({
      content: summaryText,
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 }
    })
  };
}

const msg = (role: 'system' | 'user' | 'assistant', content: string): Message => ({ role, content });

describe('ShortTermMemory', () => {
  describe('addMessage / getContextMessagesWithPossibleSummarization', () => {
    it('returns all messages when under the max', async () => {
      const api = makeApi();
      const mem = new ShortTermMemory(api, { maxMessages: 10, summarizationDisabled: true });
      mem.addMessage(msg('user', 'hello'));
      mem.addMessage(msg('assistant', 'hi'));
      const ctx = await mem.getContextMessagesWithPossibleSummarization();
      expect(ctx).toHaveLength(2);
    });

    it('does not summarize when summarizationDisabled is true', async () => {
      const api = makeApi();
      const mem = new ShortTermMemory(api, { maxMessages: 2, summarizationDisabled: true });
      for (let i = 0; i < 5; i++) mem.addMessage(msg('user', `msg ${i}`));
      await mem.getContextMessagesWithPossibleSummarization();
      expect(api.createCompletion).not.toHaveBeenCalled();
    });
  });

  describe('compaction by message count', () => {
    it('triggers summarization when message count reaches maxMessages', async () => {
      const api = makeApi('a concise summary');
      const summaries: Message[] = [];
      // preserved=2 (hardcoded), preserveLastNMessages=1
      // 6 messages: summarizable=[m2..m5], cutoff=3 → summarizes m2,m3,m4
      const mem = new ShortTermMemory(
        api,
        { maxMessages: 5, preserveLastNMessages: 1 },
        (s) => summaries.push(s)
      );

      for (let i = 0; i < 6; i++) mem.addMessage(msg('user', `message ${i}`));
      await mem.getContextMessagesWithPossibleSummarization();

      expect(api.createCompletion).toHaveBeenCalled();
      expect(summaries).toHaveLength(1);
      expect(summaries[0].content).toContain('a concise summary');
    });

    it('reduces message count after compaction', async () => {
      const api = makeApi('summary');
      // preserved=2 (algorithm hardcoded), preserveLastNMessages=1
      // With 6 messages: [m0,m1] kept + summarizable=[m2,m3,m4,m5], cutoff=max(0,4-1)=3
      // → [m0,m1] stay + [m5] stays → 2 messages + summary injected in output
      const mem = new ShortTermMemory(api, { maxMessages: 5, preserveLastNMessages: 1 });
      for (let i = 0; i < 6; i++) mem.addMessage(msg('user', `m${i}`));
      const before = (mem as any).messages.length;
      await mem.getContextMessagesWithPossibleSummarization();
      const after = (mem as any).messages.length;
      expect(after).toBeLessThan(before);
    });

    it('injects the summary as a system message in the context output', async () => {
      const api = makeApi('the summary text');
      const mem = new ShortTermMemory(api, { maxMessages: 5, preserveLastNMessages: 1 });
      for (let i = 0; i < 6; i++) mem.addMessage(msg('user', `m${i}`));
      const ctx = await mem.getContextMessagesWithPossibleSummarization();
      const summaryMsg = ctx.find(m => m.content.includes('the summary text'));
      expect(summaryMsg).toBeDefined();
      expect(summaryMsg?.role).toBe('system');
    });
  });

  describe('compaction by token count', () => {
    it('triggers summarization when estimated tokens exceed maxTokens', async () => {
      const api = makeApi('token summary');
      const mem = new ShortTermMemory(api, { maxTokens: 10, preserveLastNMessages: 1 });
      // Each char is ~0.25 tokens with default 4 chars/token.
      // 5 messages of 10 chars each = 50 chars ≈ 13 tokens → exceeds 10
      for (let i = 0; i < 5; i++) mem.addMessage(msg('user', '0123456789'));
      await mem.getContextMessagesWithPossibleSummarization();
      expect(api.createCompletion).toHaveBeenCalled();
    });
  });

  describe('estimateTokenCount', () => {
    it('returns 0 for empty memory', () => {
      const mem = new ShortTermMemory(makeApi());
      expect(mem.estimateTokenCount()).toBe(0);
    });

    it('uses character length / 4 as the estimate', () => {
      const mem = new ShortTermMemory(makeApi(), { tokenEstimateCharsPerToken: 4 });
      mem.addMessage(msg('user', '1234')); // 4 chars → 1 token
      mem.addMessage(msg('assistant', '12345678')); // 8 chars → 2 tokens
      expect(mem.estimateTokenCount()).toBe(3);
    });
  });

  describe('clear', () => {
    it('resets messages and summary', async () => {
      const api = makeApi('s');
      const mem = new ShortTermMemory(api, { maxMessages: 4, preserveLastNMessages: 1 });
      for (let i = 0; i < 6; i++) mem.addMessage(msg('user', `m${i}`));
      await mem.getContextMessagesWithPossibleSummarization(); // triggers summary
      mem.clear();
      expect(mem.estimateTokenCount()).toBe(0);
      const ctx = await mem.getContextMessagesWithPossibleSummarization();
      expect(ctx).toHaveLength(0);
    });
  });

  describe('summarization failure resilience', () => {
    it('does not throw when the API call fails during summarization', async () => {
      const api: ILLMApiHandler = {
        createCompletion: jest.fn().mockRejectedValue(new Error('network failure'))
      };
      const mem = new ShortTermMemory(api, { maxMessages: 3, preserveLastNMessages: 1 });
      for (let i = 0; i < 3; i++) mem.addMessage(msg('user', `m${i}`));
      await expect(mem.getContextMessagesWithPossibleSummarization()).resolves.toBeDefined();
    });
  });
});
