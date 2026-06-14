import type { AzureOpenAI } from 'openai';
import { Message } from '../../task/types';
import { CompletionResponse, ILLMApiHandler, StreamChunk } from '..';

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

export interface AzureConfig {
  /**
   * One or more Azure OpenAI endpoint URLs. Multiple endpoints can be supplied as a
   * semicolon-delimited string (e.g. "https://a.openai.azure.com;https://b.openai.azure.com").
   * On HTTP 429 the client will automatically rotate to the next endpoint.
   * Each value must be a valid https:// URL.
   */
  endpoint: string;
  /** Required when useManagedIdentity is false (API key mode). */
  apiKey?: string;
  deploymentName: string;
  highReasoningEffort?: boolean;
  apiVersion?: string;
  /**
   * When true (default), authenticate via Azure Managed Identity using DefaultAzureCredential.
   * Set to false to authenticate with an API key (apiKey must be provided).
   */
  useManagedIdentity?: boolean;
}

// Models that only support the Responses API (not Chat Completions)
const RESPONSES_API_MODELS = ['codex-mini', 'gpt-5.1', 'gpt-5.3'];

function requiresResponsesApi(deploymentName: string): boolean {
  const name = deploymentName.toLowerCase();
  return RESPONSES_API_MODELS.some(m => name.includes(m));
}

function parseEndpoints(raw: string): string[] {
  const endpoints = raw
    .split(';')
    .map(e => e.trim())
    .filter(e => e.length > 0);

  if (endpoints.length === 0) {
    throw new Error('AZURE_OPENAI_ENDPOINT must contain at least one endpoint URL');
  }

  for (let i = 0; i < endpoints.length; i++) {
    let url: URL;
    try {
      url = new URL(endpoints[i]);
    } catch {
      throw new Error(`Invalid endpoint URL at index ${i}`);
    }
    if (url.protocol !== 'https:') {
      throw new Error(`Endpoint at index ${i} must use https:// protocol`);
    }
  }

  return endpoints;
}

function buildClient(endpoint: string, config: AzureConfig): AzureOpenAI {
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
    return new AzureOpenAI({
      azureADTokenProvider,
      apiKey: '',
      endpoint,
      apiVersion: config.apiVersion,
    });
  }

  if (!config.apiKey) {
    throw new Error('apiKey is required when useManagedIdentity is false');
  }
  return new AzureOpenAI({
    apiKey: config.apiKey,
    endpoint,
    apiVersion: config.apiVersion,
  });
}

export class AzureOpenAIClient implements ILLMApiHandler {
  private clients: AzureOpenAI[];
  private currentIndex: number = 0;
  private deploymentName: string;
  private completionRequestOptions: any;
  private useResponsesApi: boolean;

  constructor(config: AzureConfig) {
    this.deploymentName = config.deploymentName;
    this.useResponsesApi = requiresResponsesApi(config.deploymentName);
    this.completionRequestOptions = this.getRequestOptions(config.deploymentName, !!config.highReasoningEffort);

    const endpoints = parseEndpoints(config.endpoint);
    this.clients = endpoints.map(ep => buildClient(ep, config));
  }

  private get client(): AzureOpenAI {
    return this.clients[this.currentIndex];
  }

  private rotateEndpoint(): boolean {
    if (this.clients.length <= 1) return false;
    this.currentIndex = (this.currentIndex + 1) % this.clients.length;
    return true;
  }

  // Retry config
  private readonly MAX_RETRIES = 5;
  private readonly DEFAULT_RETRY_AFTER_MS = 5000; // 5s fallback

  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getRetryAfterMs(error: any): number | null {
    try {
      // Try common locations for headers
      const headers = error?.response?.headers || error?.headers || (error?.response && error.response.headers) || null;
      let raw: any = null;

      if (headers) {
        // axios-style headers (lowercase keys)
        raw = headers['retry-after'] || headers['Retry-After'] || null;
      } else if (error?.headers && typeof error.headers.get === 'function') {
        // fetch-style Headers
        raw = error.headers.get('retry-after') || null;
      }

      if (!raw) return null;

      // If numeric seconds
      const asInt = parseInt(raw, 10);
      if (!Number.isNaN(asInt)) {
        return asInt * 1000;
      }

      // Otherwise, it might be an HTTP date
      const date = Date.parse(raw);
      if (!Number.isNaN(date)) {
        const diff = date - Date.now();
        return diff > 0 ? diff : 0;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Handle a 429 response during a retry loop.
   *
   * Strategy:
   *  - First, rotate to the next endpoint immediately (no sleep) — it may have quota.
   *  - Once we have cycled through ALL endpoints without success, that completes one
   *    "cycle". We then sleep before starting the next cycle.
   *  - cycleAttempt counts completed cycles; we give up after MAX_RETRIES cycles.
   *
   * Returns the wait duration that was applied (0 if we just rotated, >0 if we slept),
   * or null if retries are exhausted.
   */
  private async handle429(
    error: any,
    cycleAttempt: { value: number },
    consecutiveThrottled: { value: number },
    context: string
  ): Promise<number | null> {
    consecutiveThrottled.value++;

    // Rotate to the next endpoint first — no sleep needed if quota is available there.
    const rotated = this.rotateEndpoint();
    const prevIndex = rotated
      ? (this.currentIndex - 1 + this.clients.length) % this.clients.length
      : this.currentIndex;

    if (rotated && consecutiveThrottled.value < this.clients.length) {
      // Haven't tried all endpoints in this cycle yet — switch and retry immediately.
      console.warn(
        `[AzureOpenAI] 429 on endpoint ${prevIndex + 1}/${this.clients.length} (${context}), ` +
        `rotating to endpoint ${this.currentIndex + 1}`
      );
      return 0;
    }

    // We've now tried every endpoint in this cycle — time to sleep.
    cycleAttempt.value++;
    consecutiveThrottled.value = 0;

    if (cycleAttempt.value > this.MAX_RETRIES) {
      return null; // exhausted
    }

    const retryAfter =
      this.getRetryAfterMs(error) ??
      Math.min(this.DEFAULT_RETRY_AFTER_MS * Math.pow(2, cycleAttempt.value - 1), 60000);

    console.warn(
      `[AzureOpenAI] All ${this.clients.length} endpoint(s) returned 429 (${context}). ` +
      `Cycle ${cycleAttempt.value}/${this.MAX_RETRIES} — waiting ${retryAfter}ms before retrying.`
    );
    await this.sleep(retryAfter);
    return retryAfter;
  }

  async createCompletion(messages: Message[]): Promise<CompletionResponse> {
    const cycleAttempt = { value: 0 };
    const consecutiveThrottled = { value: 0 };

    while (true) {
      try {
        if (this.useResponsesApi) {
          const response = await (this.client as any).responses.create({
            model: this.deploymentName,
            input: this.formatMessagesForResponsesApi(messages),
            ...this.completionRequestOptions
          });

          return {
            content: response.output_text || '',
            usage: {
              promptTokens: response.usage?.input_tokens || 0,
              completionTokens: response.usage?.output_tokens || 0,
              totalTokens: response.usage?.total_tokens || 0
            }
          };
        }

        const response = await this.client.chat.completions.create({
          model: this.deploymentName,
          messages: this.formatMessages(messages),
          stream: false,
          ...this.completionRequestOptions
        });

        return {
          content: response.choices[0].message.content || '',
          usage: {
            promptTokens: response.usage?.prompt_tokens || 0,
            completionTokens: response.usage?.completion_tokens || 0,
            totalTokens: response.usage?.total_tokens || 0
          }
        };
      } catch (error: any) {
        const status = error?.status || error?.statusCode || error?.response?.status;

        if (status === 429) {
          const waited = await this.handle429(error, cycleAttempt, consecutiveThrottled, 'completion');
          if (waited !== null) continue;
        }

        console.error('Error creating completion:', error);
        throw error;
      }
    }
  }

  async *createStreamingCompletion(messages: Message[]): AsyncIterable<StreamChunk> {
    const cycleAttempt = { value: 0 };
    const consecutiveThrottled = { value: 0 };

    while (true) {
      try {
        if (this.useResponsesApi) {
          const stream = await (this.client as any).responses.create({
            ...this.completionRequestOptions,
            model: this.deploymentName,
            input: this.formatMessagesForResponsesApi(messages),
            stream: true
          });

          for await (const event of stream) {
            if (event.type === 'response.output_text.delta') {
              yield { content: event.delta || '', isComplete: false };
            } else if (event.type === 'response.completed') {
              yield { content: '', isComplete: true };
            }
          }

          return;
        }

        const stream = await this.client.chat.completions.create({
          ...this.completionRequestOptions,
          model: this.deploymentName,
          messages: this.formatMessages(messages),
          stream: true
        }) as any;

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          const isComplete = chunk.choices[0]?.finish_reason !== undefined && chunk.choices[0]?.finish_reason !== null;

          if (content || isComplete) {
            yield { content, isComplete };
          }
        }

        return;
      } catch (error: any) {
        const status = error?.status || error?.statusCode || error?.response?.status;

        if (status === 429) {
          const waited = await this.handle429(error, cycleAttempt, consecutiveThrottled, 'streaming');
          if (waited !== null) continue;
        }

        console.error('Error creating streaming completion:', error);
        throw error;
      }
    }
  }

  private getRequestOptions(deploymentName: string, useHighReasoning: boolean): any {
    const deployment = deploymentName.toLowerCase();
    if (deployment.includes('gpt') && deployment.includes('4')) {
      return {
        temperature: 0,
        top_p: 1
      };
    }

    if (useHighReasoning && ((deployment.includes('gpt') && deployment.includes('5'))  || deployment.includes('o4'))) {
      return {
        reasoning_effort: 'high'
      };
    }

    if (deployment.includes('gpt-5.4-mini')) {
      return {
        reasoning_effort: 'xhigh'
      };
    }

    if (deployment.includes('gpt-5.1-codex-mini')) {
      return {
        reasoning: {
          effort: 'high' }
      };
    }

    return {};
  }

  private formatMessages(messages: Message[]): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    return messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
  }

  private formatMessagesForResponsesApi(messages: Message[]): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    return messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
  }
}
