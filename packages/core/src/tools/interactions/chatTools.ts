import { ToolCategory, ToolConfig, ToolParameter, ToolResult } from "../types";
import { BaseTool } from "../baseTool";

export type AskFollowupQuestionToolParams = {
  message: string;
};

export const InteractionsCategory: ToolCategory = {
  name: 'interaction',
  description: 'User interaction: ask questions and get clarification',
  keywords: ['ask', 'question', 'clarify', 'user', 'input', 'followup'],
};


export class AskFollowupQuestionTool extends BaseTool<AskFollowupQuestionToolParams> {
  name = 'send_message';
  category = InteractionsCategory;
  description = 'Send a message to a user and wait for a response. could be used also for follow up questions and for answering user questions';
  parameters: ToolParameter[] = [
    {
      name: 'message',
      description: 'The message to send',
      required: true,
      type: 'string'
    }
  ];

  async execute(params: AskFollowupQuestionToolParams): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      const { message } = params;
      
      if (!message) {
        return {
          success: false,
          message: 'Message cannot be empty',
          error: 'Message cannot be empty'
        };
      }

      await this.notify(message);

      return {
        success: true,
        message: 'Message sent to the user',
        result: {
          toolUseCompletion: true, 
          result: message,
        }
      };
    });
  }
}
