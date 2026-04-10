import { ToolConfig } from "../types";
import { DeleteFileTool, InsertContentTool, ListFilesTool, PreviewFileTool, ReadFileTool, ReplaceContentTool, ReplaceInFileTool, SearchAndReplaceTool, SearchFilesTool, WriteFileTool } from "./fileTools";
import {
  GitChangedFilesTool,
  GrepInFilesTool,
  ParsePackageManifestTool,
  ReadSchemaFileTool,
  ResolveEnvVariableTool,
  ExtractTypeDefinitionTool,
  FindUsagesOfSymbolTool,
} from "./usageExtractorTools";

export * from "./usageExtractorTools";

export const createFileTools = (config: ToolConfig) => {
  return [
    new PreviewFileTool(config),
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
    new PreviewFileTool(config),
    new ReadFileTool(config),
    new SearchFilesTool(config),
    new ListFilesTool(config),
  ];
};

/**
 * Create the full set of usage-extractor tools: all read-only file tools plus the
 * seven specialised analysis tools needed by the UsageExtractor agent.
 */
export const createUsageExtractorTools = (config: ToolConfig) => {
  return [
    // Read-only base set
    new PreviewFileTool(config),
    new ReadFileTool(config),
    new SearchFilesTool(config),
    new ListFilesTool(config),
    // New usage-extractor tools
    new GitChangedFilesTool(config),
    new GrepInFilesTool(config),
    new ParsePackageManifestTool(config),
    new ReadSchemaFileTool(config),
    new ResolveEnvVariableTool(config),
    new ExtractTypeDefinitionTool(config),
    new FindUsagesOfSymbolTool(config),
  ];
};