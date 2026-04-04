import { ToolConfig } from "../types";
import { DeleteFileTool, InsertContentTool, ListFilesTool, ReadFileTool, ReplaceContentTool, ReplaceInFileTool, SearchAndReplaceTool, SearchFilesTool, WriteFileTool } from "./fileTools";

export const createFileTools = (config: ToolConfig) => {
  return [
    new ReadFileTool(config),
    new WriteFileTool(config),
    new SearchFilesTool(config),
    new ListFilesTool(config),
    new InsertContentTool(config),
    //new ReplaceContentTool(config),
    new SearchAndReplaceTool(config),
    new ReplaceInFileTool(config),
    new DeleteFileTool(config)
  ];
};

export const createReadOnlyFileTools = (config: ToolConfig) => {
  return [
    new ReadFileTool(config),
    new SearchFilesTool(config),
    new ListFilesTool(config),
  ];
};