import type { IEmbeddingHandler, EmbeddingResponse } from '../index';

/**
 * No-op embedding client used when embeddings are disabled or not configured.
 * Satisfies IEmbeddingHandler but throws a clear error if vector search is attempted.
 */
export class NoopEmbeddingClient implements IEmbeddingHandler {
  createEmbedding(_text: string): Promise<EmbeddingResponse> {
    throw new Error(
      'Embeddings are disabled or not configured. ' +
      'Set EMBEDDINGS_ENABLED=true and configure an embedding provider to use vector search.',
    );
  }

  embedBatch(_texts: string[]): Promise<number[][]> {
    throw new Error(
      'Embeddings are disabled or not configured. ' +
      'Set EMBEDDINGS_ENABLED=true and configure an embedding provider to use vector search.',
    );
  }

  getDimension(): number {
    return 0;
  }
}
