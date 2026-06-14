import { NoopEmbeddingClient } from '../../llm/providers/noopEmbeddingClient';
import { OllamaClient } from '../../llm/providers/ollamaClient';
import { OllamaEmbeddingClient } from '../../llm/providers/ollamaEmbeddingClient';
import { createEmbeddingClientFromEnv, isEmbeddingsConfiguredFromEnv } from '../../llm/providers/embeddingFactory';
import { createLlmClientFromEnv, isLlmConfiguredFromEnv } from '../../llm/providers/llmFactory';

describe('provider factories', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {};
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('creates Ollama LLM clients from env', () => {
    process.env.LLM_PROVIDER = 'ollama';
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434';
    process.env.OLLAMA_CHAT_MODEL = 'qwen2.5-coder:14b';
    process.env.OLLAMA_SMALL_CHAT_MODEL = 'qwen2.5-coder:7b';

    expect(isLlmConfiguredFromEnv()).toBe(true);
    expect(createLlmClientFromEnv()).toBeInstanceOf(OllamaClient);
    expect(createLlmClientFromEnv({ modelRole: 'small' })).toBeInstanceOf(OllamaClient);
  });

  it('falls back to the main Ollama chat model for small clients', () => {
    process.env.LLM_PROVIDER = 'ollama';
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434';
    process.env.OLLAMA_CHAT_MODEL = 'qwen2.5-coder:14b';

    expect(isLlmConfiguredFromEnv({ modelRole: 'small' })).toBe(true);
    expect(createLlmClientFromEnv({ modelRole: 'small' })).toBeInstanceOf(OllamaClient);
  });

  it('creates Ollama embedding clients from env', () => {
    process.env.EMBEDDINGS_ENABLED = 'true';
    process.env.EMBEDDINGS_PROVIDER = 'ollama';
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434';
    process.env.OLLAMA_EMBEDDING_MODEL = 'nomic-embed-text';
    process.env.OLLAMA_EMBEDDING_DIMENSION = '768';

    expect(isEmbeddingsConfiguredFromEnv()).toBe(true);
    expect(createEmbeddingClientFromEnv()).toBeInstanceOf(OllamaEmbeddingClient);
  });

  it('uses noop embeddings when embeddings are disabled', () => {
    expect(isEmbeddingsConfiguredFromEnv()).toBe(false);
    expect(createEmbeddingClientFromEnv()).toBeInstanceOf(NoopEmbeddingClient);
  });

  it('requires explicit Ollama embedding dimensions', () => {
    process.env.EMBEDDINGS_ENABLED = 'true';
    process.env.EMBEDDINGS_PROVIDER = 'ollama';
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434';
    process.env.OLLAMA_EMBEDDING_MODEL = 'nomic-embed-text';

    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(isEmbeddingsConfiguredFromEnv()).toBe(false);
    expect(createEmbeddingClientFromEnv()).toBeInstanceOf(NoopEmbeddingClient);
  });
});
