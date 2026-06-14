import { Message } from '../../task/types';
import { CompletionResponse, ILLMApiHandler, StreamChunk } from '..';

interface AnthropicSDK {
  Anthropic: new (opts: { apiKey: string }) => AnthropicInstance;
}

interface AnthropicInstance {
  messages: {
    create(params: AnthropicCreateParams): Promise<AnthropicMessage>;
    stream(params: AnthropicCreateParams): AnthropicStream;
  };
}

interface AnthropicCreateParams {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

interface AnthropicMessage {
  content: Array<{ type: string; [key: string]: unknown }>;
  usage: { input_tokens: number; output_tokens: number };
}

interface AnthropicStreamEvent {
  type: string;
  delta?: { type: string; text: string };
}

interface AnthropicStream extends AsyncIterable<AnthropicStreamEvent> {}

function requireAnthropic(): AnthropicSDK {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@anthropic-ai/sdk') as AnthropicSDK;
  } catch {
    throw new Error(
      '@anthropic-ai/sdk is an optional dependency required for the Anthropic provider. Install it with: npm install @anthropic-ai/sdk'
    );
  }
}

export interface AnthropicConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

const DEFAULT_MODEL = 'claude-opus-4-8';
const DEFAULT_MAX_TOKENS = 16000;

export class AnthropicClient implements ILLMApiHandler {
  private client: AnthropicInstance;
  private model: string;
  private maxTokens: number;

  constructor(config: AnthropicConfig) {
    const { Anthropic } = requireAnthropic();
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model ?? DEFAULT_MODEL;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async createCompletion(messages: Message[]): Promise<CompletionResponse> {
    const { system, userMessages } = this.splitMessages(messages);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      ...(system ? { system } : {}),
      messages: userMessages,
    });

    const textBlock = response.content.find(
      (b): b is { type: 'text'; text: string } => b.type === 'text'
    ) as { type: 'text'; text: string } | undefined;

    return {
      content: textBlock?.text ?? '',
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    };
  }

  async *createStreamingCompletion(messages: Message[]): AsyncIterable<StreamChunk> {
    const { system, userMessages } = this.splitMessages(messages);

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: this.maxTokens,
      ...(system ? { system } : {}),
      messages: userMessages,
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta?.type === 'text_delta'
      ) {
        yield { content: event.delta.text, isComplete: false };
      } else if (event.type === 'message_stop') {
        yield { content: '', isComplete: true };
      }
    }
  }

  private splitMessages(messages: Message[]): {
    system: string | undefined;
    userMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
  } {
    const systemMessages = messages.filter(m => m.role === 'system');
    const system = systemMessages.length > 0
      ? systemMessages.map(m => m.content).join('\n')
      : undefined;

    const userMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    return { system, userMessages };
  }
}
