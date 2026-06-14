import { ToolParameter, ToolResult } from "../types";
import { BaseTool } from "../baseTool";
import { TaskCompletionCategory } from "../task/taskCompletionTool";

export const ChatCompletionToolName = 'chat_complete';

export type ChatCompletionToolParams = {
  message: string;
  includeGraph?: boolean;
  includeTable?: boolean;
};

export class ChatCompletionTool extends BaseTool<ChatCompletionToolParams> {
  name = ChatCompletionToolName;
  category = TaskCompletionCategory;
  description =
    'Complete chat response with a message to the user. ' +
    'Set includeGraph=true when the most relevant tool returned a relationship or DFD graph. ' +
    'Set includeTable=true when the most relevant tool returned a list of entities (features, security reviews, services) — the UI will render them as a professional clickable table. ' +
    'Use at most one of includeGraph or includeTable per response (they are mutually exclusive).';
  
  parameters: ToolParameter[] = [
    {
      name: 'message',
      description: 'The response message to send to the user. DO NOT include graph or table payload in the message — they are rendered separately.',
      required: true,
      type: 'string'
    },
    {
      name: 'includeGraph',
      description: 'Boolean (true / false) — set true to attach the graph visualization from the most recent graph-returning tool call.',
      required: false,
      type: 'boolean'
    },
    {
      name: 'includeTable',
      description: 'Boolean (true / false) — set true to attach the table visualization from the most recent table-returning tool call (lists of features, security reviews, or services).',
      required: false,
      type: 'boolean'
    }
  ];

  async execute(params: ChatCompletionToolParams): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      const { message, includeGraph, includeTable } = params;
      
      if (!message) {
        return {
          success: false,
          message: 'Message cannot be empty',
          error: 'Message cannot be empty'
        };
      }

      return {
        success: true,
        message: 'Chat response completed',
        result: {
          message,
          includeGraph: !!includeGraph,
          includeTable: !!includeTable,
        }
      };
    });
  }
}
