import { QdrantAdapter } from '../persistence/qdrantDataAdapter';
import { AzureOpenAIEmbeddingClient, IEmbeddingHandler } from '@ai-agent/core';

/**
 * Create a single embedding client to be shared across all services.
 * Call once at server startup and pass the result to createQdrantDataAdapter.
 */
export function createEmbeddingClient(): IEmbeddingHandler {
  const useManagedIdentity = process.env.AZURE_OPENAI_AUTH !== 'use_llm_provider_key';

  return new AzureOpenAIEmbeddingClient({
    endpoint: process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT || '',
    apiKey: useManagedIdentity ? undefined : (process.env.AZURE_OPENAI_EMBEDDING_API_KEY || process.env.AZURE_OPENAI_API_KEY),
    deploymentName: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || 'text-embedding-3-small',
    apiVersion: process.env.AZURE_OPENAI_EMBEDDING_API_VERSION || process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview',
    useManagedIdentity,
  });
}

/**
 * Factory function to create a QdrantAdapter instance with proper configuration.
 * Accepts a shared embedding client created via createEmbeddingClient().
 */
export function createQdrantDataAdapter(embeddingClient: IEmbeddingHandler): QdrantAdapter {
  const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
  const qdrantApiKey = process.env.QDRANT_API_KEY;
  const collectionPrefix = 'code_indexer';

  return new QdrantAdapter(
    {
      url: qdrantUrl,
      apiKey: qdrantApiKey,
      collectionPrefix,
    },
    embeddingClient
  );
}
