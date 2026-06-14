import { ToolConfig } from "../types";
import { ExecuteCommandTool } from "./commandTools";

export const createCommandTools = (config: ToolConfig) => {
  return [
    new ExecuteCommandTool(config)
  ];
};