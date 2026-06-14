import { Message } from '../../task/types';
import { CompletionResponse, ILLMApiHandler, StreamChunk } from '..';

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  temperature?: number;
  topP?: number;
  numCtx?: number;
  timeoutMs?: number;
}

type OllamaChatResponse = {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
};

type OllamaChatChunk = {
  message?: { content?: string };
  done?: boolean;
};

export class OllamaClient implements ILLMApiHandler {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly topP?: number;
  private readonly numCtx?: number;
  private readonly timeoutMs: number;

  constructor(config: OllamaConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.model = config.model;
    this.temperature = config.temperature ?? 0;
    this.topP = config.topP;
    this.numCtx = config.numCtx;
    this.timeoutMs = config.timeoutMs ?? 300_000;
  }

  async createCompletion(messages: Message[]): Promise<CompletionResponse> {
    const response = await this.postJson<OllamaChatResponse>('/api/chat', {
      model: this.model,
      messages: this.formatMessages(messages),
      stream: false,
      options: this.buildOptions(),
    });

    const promptTokens = response.prompt_eval_count ?? 0;
    const completionTokens = response.eval_count ?? 0;

    return {
      content: response.message?.content ?? '',
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
    };
  }

  async *createStreamingCompletion(messages: Message[]): AsyncIterable<StreamChunk> {
    const response = await this.fetchWithTimeout('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: this.formatMessages(messages),
        stream: true,
        options: this.buildOptions(),
      }),
    });

    if (!response.ok || !response.body) {
      throw await this.toError(response, 'streaming completion');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const chunk = JSON.parse(trimmed) as OllamaChatChunk;
          const content = chunk.message?.content ?? '';
          const isComplete = chunk.done === true;
          if (content || isComplete) {
            yield { content, isComplete };
          }
        }
      }

      const trailing = buffer.trim();
      if (trailing) {
        const chunk = JSON.parse(trailing) as OllamaChatChunk;
        yield { content: chunk.message?.content ?? '', isComplete: chunk.done === true };
      }
    } catch (error) {
      throw this.wrapError(error, 'streaming completion');
    } finally {
      reader.releaseLock();
    }
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const response = await this.fetchWithTimeout(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw await this.toError(response, 'completion');
    }

    return response.json() as Promise<T>;
  }

  private async fetchWithTimeout(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await fetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
    } catch (error) {
      throw this.wrapError(error, 'request');
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

  private wrapError(error: unknown, operation: string): Error {
    if (error instanceof Error && error.name === 'AbortError') {
      return new Error(
        `[Ollama] ${operation} timed out after ${this.timeoutMs}ms for model "${this.model}" at ${this.baseUrl}`,
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    return new Error(
      `[Ollama] ${operation} failed for model "${this.model}" at ${this.baseUrl}: ${message}`,
    );
  }

  private buildOptions(): Record<string, number> {
    const options: Record<string, number> = { temperature: this.temperature };
    if (this.topP !== undefined) options.top_p = this.topP;
    if (this.numCtx !== undefined) options.num_ctx = this.numCtx;
    return options;
  }

  private formatMessages(messages: Message[]): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    return messages.map(message => ({
      role: message.role,
      content: message.content,
    }));
  }
}
