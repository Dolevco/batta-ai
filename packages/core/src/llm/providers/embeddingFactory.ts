import { IEmbeddingHandler } from '..';
import { AzureOpenAIEmbeddingClient } from './azureOpenAIEmbeddingClient';
import { NoopEmbeddingClient } from './noopEmbeddingClient';
import { OllamaEmbeddingClient } from './ollamaEmbeddingClient';

export type EmbeddingsProvider = 'azure-openai' | 'ollama';

export function isEmbeddingsConfiguredFromEnv(): boolean {
  if (process.env.EMBEDDINGS_ENABLED !== 'true') return false;

  const provider = getEmbeddingsProvider();
  if (!provider) return false;

  if (provider === 'ollama') {
    return Boolean(process.env.OLLAMA_BASE_URL) &&
      Boolean(process.env.OLLAMA_EMBEDDING_MODEL) &&
      Boolean(parsePositiveInteger(process.env.OLLAMA_EMBEDDING_DIMENSION));
  }

  return isAzureEmbeddingsConfigured();
}

export function createEmbeddingClientFromEnv(): IEmbeddingHandler {
  if (process.env.EMBEDDINGS_ENABLED !== 'true') {
    return new NoopEmbeddingClient();
  }

  const provider = getEmbeddingsProvider();
  if (!provider || !isEmbeddingsConfiguredFromEnv()) {
    console.warn('[embeddings] EMBEDDINGS_ENABLED=true but embedding provider config is incomplete; embeddings are disabled.');
    return new NoopEmbeddingClient();
  }

  try {
    if (provider === 'ollama') {
      return new OllamaEmbeddingClient({
        baseUrl: process.env.OLLAMA_BASE_URL!,
        model: process.env.OLLAMA_EMBEDDING_MODEL!,
        dimension: parsePositiveInteger(process.env.OLLAMA_EMBEDDING_DIMENSION)!,
        timeoutMs: parsePositiveInteger(process.env.OLLAMA_EMBEDDING_TIMEOUT_MS || process.env.OLLAMA_TIMEOUT_MS),
      });
    }

    const useManagedIdentity = process.env.AZURE_OPENAI_AUTH !== 'use_llm_provider_key';
    return new AzureOpenAIEmbeddingClient({
      endpoint: getAzureEmbeddingEndpoint()!,
      apiKey: useManagedIdentity ? undefined : getAzureEmbeddingApiKey(),
      deploymentName: getAzureEmbeddingDeployment()!,
      apiVersion: process.env.AZURE_OPENAI_EMBEDDING_API_VERSION ||
        process.env.AZURE_OPENAI_API_VERSION ||
        '2024-12-01-preview',
      useManagedIdentity,
    });
  } catch (error) {
    console.warn('[embeddings] Embedding client disabled:', (error as Error).message);
    return new NoopEmbeddingClient();
  }
}

function getEmbeddingsProvider(): EmbeddingsProvider | undefined {
  const provider = process.env.EMBEDDINGS_PROVIDER?.trim().toLowerCase();
  if (provider === 'ollama' || provider === 'azure-openai') return provider;
  if (provider) {
    console.warn(`[embeddings] Unsupported EMBEDDINGS_PROVIDER "${provider}"`);
    return undefined;
  }

  return isAzureEmbeddingsConfigured() ? 'azure-openai' : undefined;
}

function isAzureEmbeddingsConfigured(): boolean {
  const useManagedIdentity = process.env.AZURE_OPENAI_AUTH !== 'use_llm_provider_key';
  return Boolean(getAzureEmbeddingEndpoint()) &&
    Boolean(getAzureEmbeddingDeployment()) &&
    (useManagedIdentity || Boolean(getAzureEmbeddingApiKey()));
}

function getAzureEmbeddingEndpoint(): string | undefined {
  return process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT;
}

function getAzureEmbeddingDeployment(): string | undefined {
  return process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT ||
    process.env.AZURE_OPENAI_DEPLOYMENT ||
    process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
}

function getAzureEmbeddingApiKey(): string | undefined {
  return process.env.AZURE_OPENAI_EMBEDDING_API_KEY || process.env.AZURE_OPENAI_API_KEY;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
