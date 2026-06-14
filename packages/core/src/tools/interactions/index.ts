import { ToolConfig } from "../types";
import { AskFollowupQuestionTool } from "./chatTools";
import { ChatCompletionTool } from "./chatCompletionTool";

export const createChatInteractionTools = (config: ToolConfig) => {
  return [
    new AskFollowupQuestionTool({ ...config, isInteractionTool: true }),
  ];
};

export const createChatCompletionTool = (config?: ToolConfig) => {
  return new ChatCompletionTool(config);
};

export { ChatCompletionTool, ChatCompletionToolName } from "./chatCompletionTool";