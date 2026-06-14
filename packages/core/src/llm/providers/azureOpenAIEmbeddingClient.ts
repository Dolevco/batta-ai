import type { AzureOpenAI } from 'openai';
import { EmbeddingResponse, IEmbeddingHandler } from '..';

function requireOpenAI(): typeof import('openai') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('openai');
  } catch {
    throw new Error(
      'openai is an optional dependency required for Azure OpenAI. Install it with: npm install openai'
    );
  }
}

function requireAzureIdentity(): typeof import('@azure/identity') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@azure/identity');
  } catch {
    throw new Error(
      '@azure/identity is an optional dependency required for Azure Managed Identity auth. Install it with: npm install @azure/identity'
    );
  }
}

export interface AzureEmbeddingConfig {
  endpoint: string;
  /** Required when useManagedIdentity is false (API key mode). */
  apiKey?: string;
  deploymentName: string;
  apiVersion?: string;
  dimension?: number;
  /**
   * When true (default), authenticate via Azure Managed Identity using DefaultAzureCredential.
   * Set to false to authenticate with an API key (apiKey must be provided).
   */
  useManagedIdentity?: boolean;
}

export class AzureOpenAIEmbeddingClient implements IEmbeddingHandler {
  private client: AzureOpenAI;
  private deploymentName: string;
  private dimension: number;

  constructor(config: AzureEmbeddingConfig) {
    this.deploymentName = config.deploymentName;
    this.dimension = config.dimension || 1536;

    const { AzureOpenAI } = requireOpenAI();
    const useManagedIdentity = config.useManagedIdentity ?? true;

    if (useManagedIdentity) {
      const { DefaultAzureCredential, getBearerTokenProvider } = requireAzureIdentity();
      const credential = new DefaultAzureCredential();
      const azureADTokenProvider = getBearerTokenProvider(
        credential,
        'https://cognitiveservices.azure.com/.default'
      );
      // Pass apiKey: '' to suppress the SDK's automatic AZURE_OPENAI_API_KEY env-var default,
      // which would otherwise conflict with azureADTokenProvider (they are mutually exclusive).
      this.client = new AzureOpenAI({
        azureADTokenProvider,
        apiKey: '',
        endpoint: config.endpoint,
        apiVersion: config.apiVersion,
      });
    } else {
      if (!config.apiKey) {
        throw new Error('apiKey is required when useManagedIdentity is false');
      }
      this.client = new AzureOpenAI({
        apiKey: config.apiKey,
        endpoint: config.endpoint,
        apiVersion: config.apiVersion,
      });
    }
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
