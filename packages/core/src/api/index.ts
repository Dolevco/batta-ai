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