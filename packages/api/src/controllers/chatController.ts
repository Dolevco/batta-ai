import { Request, Response } from 'express';
import { createChatTask } from '../services/chatTaskFactory';
import { AzureOpenAIClient, IEmbeddingHandler } from '@ai-agent/core';
import type { SecurityReviewService, FeatureService } from '@ai-agent/shared';

interface ChatRequest {
  message: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/** Maximum allowed message length (input validation / security) */
const MAX_MESSAGE_LENGTH = 8_000;

export class ChatController {
  constructor(
    private readonly securityReviewService: SecurityReviewService,
    private readonly featureService: FeatureService,
    private readonly embeddingClient: IEmbeddingHandler,
  ) {}

  /**
   * Handle chat messages with streaming responses
   */
  async chat(req: Request, res: Response): Promise<void> {
    try {
      const { message, conversationHistory = [] }: ChatRequest = req.body;
      const { tenantId } = (req as any).auth || {};

      if (!tenantId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      if (!message || typeof message !== 'string') {
        res.status(400).json({ error: 'Message is required' });
        return;
      }

      // Input validation: enforce max message length to prevent oversized payloads
      if (message.length > MAX_MESSAGE_LENGTH) {
        res.status(400).json({ error: `Message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters` });
        return;
      }

      // Setup SSE for streaming
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      const sendEvent = (event: string, data: unknown) => {
        try {
          const payload = JSON.stringify(data);
          res.write(`event: ${event}\n`);
          res.write(`data: ${payload}\n\n`);
        } catch (e) {
          console.error('SSE send error', e);
        }
      };

      try {
        const useManagedIdentity = process.env.AZURE_OPENAI_AUTH !== 'use_llm_provider_key';

        // Validate Azure OpenAI configuration
        if (!process.env.AZURE_OPENAI_ENDPOINT || !process.env.AZURE_OPENAI_DEPLOYMENT) {
          throw new Error('Missing required Azure OpenAI environment variables');
        }
        if (!useManagedIdentity && !process.env.AZURE_OPENAI_API_KEY) {
          throw new Error('AZURE_OPENAI_API_KEY is required when AZURE_OPENAI_AUTH=use_llm_provider_key');
        }

        const apiClient = new AzureOpenAIClient({
          endpoint: process.env.AZURE_OPENAI_ENDPOINT,
          apiKey: useManagedIdentity ? undefined : process.env.AZURE_OPENAI_API_KEY,
          deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT,
          apiVersion: process.env.AZURE_OPENAI_API_VERSION,
          useManagedIdentity,
        });

        // Create task with security review and feature tools
        const task = await createChatTask({
          apiClient,
          embeddingClient: this.embeddingClient,
          securityReviewService: this.securityReviewService,
          featureService: this.featureService,
          tenantId,
          conversationHistory
        });

        // Stream progress events
        task.events.on('toolUse', (data: any) => {
          sendEvent('tool_use', {
            name: data.name,
            reason: data.reason || `Using ${data.name}...`,
            parameters: data.parameters,
          });
        });

        task.events.on('toolResult', (data: any) => {
          // For chat_complete tool, extract and send graph data if present
          
        });

        task.events.on('streamChunk', (chunk: string) => {
          sendEvent('stream_chunk', { content: chunk });
        });

        // Execute the task
        const result = await task.execute(message);
        if ((result.result as any).graph) {
          sendEvent('graph', (result.result as any).graph);
        }
        if ((result.result as any).table) {
          sendEvent('table', (result.result as any).table);
        }

        // Extract message content from result (handle both string and object formats)
        let finalContent = 'Task completed';
        if (typeof result.result === 'string') {
          finalContent = result.result;
        } else if (result.result && typeof result.result === 'object' && 'message' in result.result) {
          finalContent = (result.result as any).message || 'Task completed';
        } else if (result.result) {
          finalContent = JSON.stringify(result.result);
        }

        // Send final response
        sendEvent('done', {
          content: finalContent,
          conversationHistory: [
            ...conversationHistory,
            { role: 'user', content: message },
            { role: 'assistant', content: finalContent }
          ]
        });

        res.end();
      } catch (error: any) {
        console.error('Chat error:', error);
        sendEvent('error', { message: error.message || 'Unknown error' });
        res.end();
      }
    } catch (error) {
      console.error('Error in chat endpoint:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to process chat message' });
      }
    }
  }
}
