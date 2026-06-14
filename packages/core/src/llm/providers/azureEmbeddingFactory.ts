import type { IEmbeddingHandler } from '../index';
import { createEmbeddingClientFromEnv } from './embeddingFactory';

export function createAzureEmbeddingClient(): IEmbeddingHandler {
  return createEmbeddingClientFromEnv();
}
