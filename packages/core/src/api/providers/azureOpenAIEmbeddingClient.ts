import { AzureOpenAI } from 'openai';
import { EmbeddingResponse, IEmbeddingHandler } from '..';

export interface AzureEmbeddingConfig {
  endpoint: string;
  apiKey: string;
  deploymentName: string;
  apiVersion?: string;
  dimension?: number;
}

export class AzureOpenAIEmbeddingClient implements IEmbeddingHandler {
  private client: AzureOpenAI;
  private deploymentName: string;
  private dimension: number;

  constructor(config: AzureEmbeddingConfig) {
    this.deploymentName = config.deploymentName;
    this.dimension = config.dimension || 1536;

    this.client = new AzureOpenAI({
      apiKey: config.apiKey,
      endpoint: config.endpoint,
      apiVersion: config.apiVersion,
    });
  }

  async createEmbedding(text: string): Promise<EmbeddingResponse> {
    try {
      const response = await this.client.embeddings.create({
        model: this.deploymentName,
        input: text,
      });

      return {
        embedding: response.data[0].embedding,
        usage: {
          promptTokens: response.usage?.prompt_tokens || 0,
          totalTokens: response.usage?.total_tokens || 0,
        },
      };
    } catch (error) {
      console.error('Error creating embedding:', error);
      throw error;
    }
  }

  // Batch embedding support
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];

    try {
      const response = await this.client.embeddings.create({
        model: this.deploymentName,
        input: texts,
      });

      return response.data.map((d: any) => d.embedding);
    } catch (error) {
      console.error('Error creating batch embeddings:', error);
      throw error;
    }
  }

  getDimension(): number {
    return this.dimension;
  }
}
