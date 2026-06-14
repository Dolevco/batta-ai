import { EmbeddingResponse, IEmbeddingHandler } from '..';

export interface OllamaEmbeddingConfig {
  baseUrl: string;
  model: string;
  dimension: number;
  timeoutMs?: number;
}

type OllamaEmbeddingResponse = {
  embedding?: number[];
  embeddings?: number[][];
  prompt_eval_count?: number;
};

export class OllamaEmbeddingClient implements IEmbeddingHandler {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly dimension: number;
  private readonly timeoutMs: number;

  constructor(config: OllamaEmbeddingConfig) {
    if (!Number.isInteger(config.dimension) || config.dimension <= 0) {
      throw new Error('Ollama embedding dimension must be a positive integer');
    }

    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.model = config.model;
    this.dimension = config.dimension;
    this.timeoutMs = config.timeoutMs ?? 300_000;
  }

  async createEmbedding(text: string): Promise<EmbeddingResponse> {
    const response = await this.postEmbedding(text);
    const embedding = this.extractSingleEmbedding(response);
    this.validateDimension(embedding);

    return {
      embedding,
      usage: {
        promptTokens: response.prompt_eval_count ?? 0,
        totalTokens: response.prompt_eval_count ?? 0,
      },
    };
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];

    const batchResponse = await this.tryBatchEmbedding(texts);
    if (batchResponse) {
      const embeddings = batchResponse.embeddings ?? [];
      embeddings.forEach(embedding => this.validateDimension(embedding));
      return embeddings;
    }

    const embeddings: number[][] = [];
    for (const text of texts) {
      embeddings.push((await this.createEmbedding(text)).embedding);
    }
    return embeddings;
  }

  getDimension(): number {
    return this.dimension;
  }

  private async tryBatchEmbedding(texts: string[]): Promise<OllamaEmbeddingResponse | undefined> {
    try {
      const response = await this.postEmbedding(texts);
      if (response.embeddings && response.embeddings.length === texts.length) {
        return response;
      }
    } catch (error) {
      console.warn(
        `[Ollama] batch embeddings failed for model "${this.model}" at ${this.baseUrl}; falling back to sequential embedding: ` +
        `${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return undefined;
  }

  private async postEmbedding(input: string | string[]): Promise<OllamaEmbeddingResponse> {
    const response = await this.fetchWithTimeout('/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        input,
      }),
    });

    if (!response.ok) {
      throw await this.toError(response, 'embedding');
    }

    return response.json() as Promise<OllamaEmbeddingResponse>;
  }

  private extractSingleEmbedding(response: OllamaEmbeddingResponse): number[] {
    if (response.embedding) return response.embedding;
    if (response.embeddings?.[0]) return response.embeddings[0];
    throw new Error(`[Ollama] embedding response for model "${this.model}" did not include an embedding`);
  }

  private validateDimension(embedding: number[]): void {
    if (embedding.length !== this.dimension) {
      throw new Error(
        `[Ollama] embedding dimension mismatch for model "${this.model}": ` +
        `expected ${this.dimension}, received ${embedding.length}`,
      );
    }
  }

  private async fetchWithTimeout(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await fetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `[Ollama] embedding request timed out after ${this.timeoutMs}ms for model "${this.model}" at ${this.baseUrl}`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async toError(response: Response, operation: string): Promise<Error> {
    let detail = '';
    try {
      detail = await response.text();
    } catch {
      detail = '';
    }

    const suffix = detail ? `: ${detail.slice(0, 300)}` : '';
    return new Error(
      `[Ollama] ${operation} failed for model "${this.model}" at ${this.baseUrl} ` +
      `(HTTP ${response.status})${suffix}`,
    );
  }
}
