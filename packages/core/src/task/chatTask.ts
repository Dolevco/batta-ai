import { Task } from './task';
import { TaskConfig, Message, TaskResult } from './types';
import { ILLMApiHandler, IEmbeddingHandler, StreamChunk } from '../api';
import { Mode } from '../context/prompts/modes';
import { Tool, ToolResult } from '../tools';
import { GraphToolResult, TableToolResult } from '../tools/graph/graph.types';
import { ChatCompletionToolName } from '../tools/interactions/chatCompletionTool';

export class ChatTask extends Task {
  private latestGraphResult?: GraphToolResult;
  private latestTableResult?: TableToolResult;

  /**
   * @param api  LLM API handler
   * @param mode  Agent mode — pass via config.mode so the base Task builds the system prompt correctly
   * @param config  Task configuration; set config.mode, config.customInstructions, config.workspace
   *                to control prompt generation. Do NOT pass a raw systemPrompt — the Task module
   *                always generates the prompt internally with all built-in tool definitions included.
   */
  constructor(api: ILLMApiHandler, mode: Mode, config: TaskConfig, embeddingHandler?: IEmbeddingHandler) {
    // Inject mode into config so the base Task generates the correct system prompt with all tools.
    super(api, { ...config, mode: config.mode ?? mode }, embeddingHandler);

    // Track graph tool results from tools with isGraphTool = true
    this.events.on('toolResult', (result: any) => {
      if (result.graph && result.name) {
        const tool = this.toolRegistry.getTool(result.name);
        if (tool && result.success && (tool as any).isGraphTool) {
          this.latestGraphResult = result as GraphToolResult;
        }
      }
      // Track table tool results from tools with isTableTool = true
      if (result.table && result.name) {
        const tool = this.toolRegistry.getTool(result.name);
        if (tool && result.success && (tool as any).isTableTool) {
          this.latestTableResult = result as TableToolResult;
        }
      }
    });
  }

  protected getTaskCompletionResult<T>(toolResult: ToolResult, tool: Tool | undefined): TaskResult<T> {
    const baseResult = super.getTaskCompletionResult<T>(toolResult, tool);

    if (tool?.name === ChatCompletionToolName) {
      // If includeGraph requested, attach the latest graph
      if (toolResult.result?.includeGraph && this.latestGraphResult?.graph) {
        return {
          ...baseResult,
          result: {
            ...toolResult.result,
            graph: this.latestGraphResult.graph,
          } as T,
        };
      }
      // If includeTable requested, attach the latest table (mutually exclusive with graph)
      if (toolResult.result?.includeTable && this.latestTableResult?.table) {
        return {
          ...baseResult,
          result: {
            ...toolResult.result,
            table: this.latestTableResult.table,
          } as T,
        };
      }
    }

    return baseResult;
  }

  protected async callCompletion(messages: Message[]) {
    // If streaming supported, stream and assemble final content while emitting chunks
    if (this.api.createStreamingCompletion) {
      let fullMessage = '';
      let inSendMessage = false;
      let messageStartEscapedIndex = -1; // index in fullMessage where the JSON-escaped message string starts (first char, after opening ")
      let lastEmittedEscapedLength = 0;

      const unescapeFragment = (frag: string) => {
        // lightweight unescape for common sequences; keep it simple and robust for streaming
        return frag
          .replace(/\\\\/g, '\\')
          .replace(/\\"/g, '"')
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t');
      };

      try {
        const stream = this.api.createStreamingCompletion(messages) as AsyncIterable<StreamChunk>;
        for await (const chunk of stream) {
          if (this.aborted) throw new Error('Task aborted');
          fullMessage += chunk.content;

          // Detect start of a send_message or chat_complete tool response and begin streaming only its "message" value as it arrives
          if (!inSendMessage) {
            const toolMatchIndex = fullMessage.search(/"tool"\s*:\s*"(send_message|chat_complete)"/);
            if (toolMatchIndex !== -1 && fullMessage.includes('reason')) {
              // find the "message" key after the tool occurrence
              const msgKeyIndex = fullMessage.indexOf('"message"', toolMatchIndex);
              if (msgKeyIndex !== -1) {
                // find the opening quote for the message value
                const colonIndex = fullMessage.indexOf(':', msgKeyIndex);
                if (colonIndex !== -1) {
                  let q = -1;
                  for (let i = colonIndex + 1; i < fullMessage.length; i++) {
                    if (fullMessage[i] === '"') { q = i; break; }
                    if (!/\s/.test(fullMessage[i])) break; // not a quote and not whitespace
                  }
                  if (q !== -1) {
                    messageStartEscapedIndex = q + 1; // start of escaped message content
                    inSendMessage = true;
                    lastEmittedEscapedLength = 0;
                  }
                }
              }
            }
          }

          // If we're inside a send_message response, stream only the message's decoded content progressively
          if (inSendMessage && messageStartEscapedIndex !== -1) {
            const escapedSubstring = fullMessage.slice(messageStartEscapedIndex);
            const currentLen = escapedSubstring.length;
            if (currentLen > lastEmittedEscapedLength) {
              const newEscaped = escapedSubstring.slice(lastEmittedEscapedLength);
              // avoid emitting a dangling backslash at the end which might indicate an incomplete escape
              let emitEscaped = newEscaped;
              if (emitEscaped.length > 0 && emitEscaped.endsWith('\\')) {
                emitEscaped = emitEscaped.slice(0, -1);
                // leave the trailing backslash for next chunk
                lastEmittedEscapedLength = currentLen - 1;
              } else {
                lastEmittedEscapedLength = currentLen;
              }
              const unescaped = unescapeFragment(emitEscaped);
              if (unescaped.length > 0) this.events.emit('streamChunk', unescaped);
            }
          }

          if (chunk.isComplete) {
            return { content: fullMessage, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
          }
        }
      } catch (error) {
        console.error('Streaming error:', error);
        // fall back to non-streaming
      }
    }

    // Default behavior
    return super.callCompletion(messages);
  }
}
