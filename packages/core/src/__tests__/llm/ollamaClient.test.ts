import { OllamaClient } from '../../llm/providers/ollamaClient';

describe('OllamaClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('maps non-streaming chat responses into completion responses', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: 'hello' },
        prompt_eval_count: 12,
        eval_count: 5,
      }),
    } as Response);

    const client = new OllamaClient({
      baseUrl: 'http://localhost:11434/',
      model: 'qwen2.5-coder:14b',
    });

    const response = await client.createCompletion([{ role: 'user', content: 'Hi' }]);

    expect(response).toEqual({
      content: 'hello',
      usage: {
        promptTokens: 12,
        completionTokens: 5,
        totalTokens: 17,
      },
    });
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/chat',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"stream":false'),
      }),
    );
  });

  it('maps streaming chat chunks into stream chunks', async () => {
    const payload = [
      JSON.stringify({ message: { content: 'hel' }, done: false }),
      JSON.stringify({ message: { content: 'lo' }, done: false }),
      JSON.stringify({ done: true }),
      '',
    ].join('\n');

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: new Response(payload).body,
    } as Response);

    const client = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      model: 'qwen2.5-coder:14b',
    });

    const chunks = [];
    for await (const chunk of client.createStreamingCompletion([{ role: 'user', content: 'Hi' }])) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: 'hel', isComplete: false },
      { content: 'lo', isComplete: false },
      { content: '', isComplete: true },
    ]);
  });
});
