import { Message } from "../task/types";

export interface ILLMApiHandler {
    createCompletion(message: Message[]): Promise<CompletionResponse>;
    createStreamingCompletion?(messages: Message[]): AsyncIterable<StreamChunk>;
}

export interface IEmbeddingHandler {
  createEmbedding(text: string): Promise<EmbeddingResponse>;
  embedBatch(texts: string[]): Promise<number[][]>;
  getDimension(): number;
}

export interface CompletionResponse {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface StreamChunk {
  content: string;
  isComplete: boolean;
}

export interface EmbeddingResponse {
  embedding: number[];
  usage: {
    promptTokens: number;
    totalTokens: number;
  };
}

export { AzureOpenAIClient } from './providers/azureOpenAIClient';
export type { AzureEmbeddingConfig } from './providers/azureOpenAIEmbeddingClient';
export { AzureOpenAIEmbeddingClient } from './providers/azureOpenAIEmbeddingClient';
export { createAzureEmbeddingClient } from './providers/azureEmbeddingFactory';
export type { LlmFactoryOptions, LlmModelRole, LlmProvider } from './providers/llmFactory';
export { createLlmClientFromEnv, isLlmConfiguredFromEnv } from './providers/llmFactory';
export type { EmbeddingsProvider } from './providers/embeddingFactory';
export { createEmbeddingClientFromEnv, isEmbeddingsConfiguredFromEnv } from './providers/embeddingFactory';
export type { OllamaConfig } from './providers/ollamaClient';
export { OllamaClient } from './providers/ollamaClient';
export type { OllamaEmbeddingConfig } from './providers/ollamaEmbeddingClient';
export { OllamaEmbeddingClient } from './providers/ollamaEmbeddingClient';
export { NoopEmbeddingClient } from './providers/noopEmbeddingClient';
export { AnthropicClient } from './providers/anthropicClient';
export type { AnthropicConfig } from './providers/anthropicClient';
