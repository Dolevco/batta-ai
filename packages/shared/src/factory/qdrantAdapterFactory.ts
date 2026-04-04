import { QdrantAdapter } from '../persistence/qdrantDataAdapter';
import { AzureOpenAIEmbeddingClient } from '@ai-agent/core';

/**
 * Factory function to create a QdrantAdapter instance with proper configuration
 */
export function createQdrantDataAdapter(): QdrantAdapter {
  const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
  const qdrantApiKey = process.env.QDRANT_API_KEY;
  const collectionPrefix = 'code_indexer';

  // Create embedding service for QdrantAdapter
  const embeddingService = new AzureOpenAIEmbeddingClient({
    endpoint: process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT || '',
    apiKey: process.env.AZURE_OPENAI_EMBEDDING_API_KEY || process.env.AZURE_OPENAI_API_KEY || '',
    deploymentName: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || 'text-embedding-3-small',
    apiVersion: process.env.AZURE_OPENAI_EMBEDDING_API_VERSION || process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview',
  });

  const adapter = new QdrantAdapter(
    {
      url: qdrantUrl,
      apiKey: qdrantApiKey,
      collectionPrefix,
    },
    embeddingService
  );

  return adapter;
}
