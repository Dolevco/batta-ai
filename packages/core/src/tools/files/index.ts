import { ToolConfig } from "../types";
import { DeleteFileTool, InsertContentTool, ListFilesTool, PreviewFileTool, ReadFileTool, ReplaceInFileTool, SearchAndReplaceTool, SearchFilesTool, WriteFileTool } from "./fileTools";

export const createFileTools = (config: ToolConfig) => {
  return [
    new PreviewFileTool(config),
    new ReadFileTool(config),
    new WriteFileTool(config),
    new SearchFilesTool(config),
    new ListFilesTool(config),
    new InsertContentTool(config),
    new SearchAndReplaceTool(config),
    new ReplaceInFileTool(config),
    new DeleteFileTool(config)
  ];
};

export const createReadOnlyFileTools = (config: ToolConfig) => {
  return [
    new PreviewFileTool(config),
    new ReadFileTool(config),
    new SearchFilesTool(config),
    new ListFilesTool(config),
  ];
};
