import { OllamaEmbeddingClient } from '../../llm/providers/ollamaEmbeddingClient';

describe('OllamaEmbeddingClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('maps single embedding responses', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        embeddings: [[0.1, 0.2, 0.3]],
        prompt_eval_count: 9,
      }),
    } as Response);

    const client = new OllamaEmbeddingClient({
      baseUrl: 'http://localhost:11434',
      model: 'nomic-embed-text',
      dimension: 3,
    });

    await expect(client.createEmbedding('hello')).resolves.toEqual({
      embedding: [0.1, 0.2, 0.3],
      usage: {
        promptTokens: 9,
        totalTokens: 9,
      },
    });
  });

  it('maps batch embedding responses', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        embeddings: [[0.1, 0.2], [0.3, 0.4]],
      }),
    } as Response);

    const client = new OllamaEmbeddingClient({
      baseUrl: 'http://localhost:11434',
      model: 'nomic-embed-text',
      dimension: 2,
    });

    await expect(client.embedBatch(['one', 'two'])).resolves.toEqual([[0.1, 0.2], [0.3, 0.4]]);
  });

  it('rejects dimension mismatches', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        embeddings: [[0.1, 0.2]],
      }),
    } as Response);

    const client = new OllamaEmbeddingClient({
      baseUrl: 'http://localhost:11434',
      model: 'nomic-embed-text',
      dimension: 3,
    });

    await expect(client.createEmbedding('hello')).rejects.toThrow('dimension mismatch');
  });
});
