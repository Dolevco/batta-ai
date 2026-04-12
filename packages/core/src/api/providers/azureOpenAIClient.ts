import { AzureOpenAI } from 'openai';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { Message } from '../../task/types';
import { CompletionResponse, ILLMApiHandler, StreamChunk } from '..';

export interface AzureConfig {
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

export class AzureOpenAIClient implements ILLMApiHandler {
  private client: AzureOpenAI;
  private deploymentName: string;
  private completionRequestOptions: any;
  private useResponsesApi: boolean;

  constructor(config: AzureConfig) {
    this.deploymentName = config.deploymentName;
    this.useResponsesApi = requiresResponsesApi(config.deploymentName);
    this.completionRequestOptions = this.getRequestOptions(config.deploymentName, !!config.highReasoningEffort);

    const useManagedIdentity = config.useManagedIdentity ?? true;

    if (useManagedIdentity) {
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

  // Retry config
  private readonly MAX_RETRIES = 5;
  private readonly DEFAULT_RETRY_AFTER_MS = 5000; // 5s fallback
  private readonly BASE_BACKOFF_MS = 1000;

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
    } catch (e) {
      return null;
    }
  }

  async createCompletion(messages: Message[]): Promise<CompletionResponse> {
    let attempt = 0;

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
        const status = error?.status || error?.statusCode || error?.response?.status || (error?.status && Number(error.status));

        if (status === 429 && attempt < this.MAX_RETRIES) {
          attempt++;
          const retryAfter = this.getRetryAfterMs(error) ?? Math.min(this.DEFAULT_RETRY_AFTER_MS * Math.pow(2, attempt - 1), 60000);
          console.warn(`Received 429 from Azure OpenAI, retrying attempt ${attempt}/${this.MAX_RETRIES} after ${retryAfter}ms`);
          await this.sleep(retryAfter);
          continue;
        }

        console.error('Error creating completion:', error);
        throw error;
      }
    }
  }

  async *createStreamingCompletion(messages: Message[]): AsyncIterable<StreamChunk> {
    let attempt = 0;

    // We will attempt to recreate the stream on 429s (or certain transient errors) up to MAX_RETRIES.
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

        // If the stream ends normally, break out (no more retries needed)
        return;
      } catch (error: any) {
        const status = error?.status || error?.statusCode || error?.response?.status || (error?.status && Number(error.status));

        if (status === 429 && attempt < this.MAX_RETRIES) {
          attempt++;
          const retryAfter = this.getRetryAfterMs(error) ?? Math.min(this.DEFAULT_RETRY_AFTER_MS * Math.pow(2, attempt - 1), 60000);
          console.warn(`Received 429 while streaming from Azure OpenAI, retrying attempt ${attempt}/${this.MAX_RETRIES} after ${retryAfter}ms`);
          await this.sleep(retryAfter);
          // On retry, recreate the stream and continue yielding any further chunks
          continue;
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
