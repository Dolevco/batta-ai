import {
  GitDiffTool,
  GitStageCommitPushTool
} from "./gitTools";
import { getInitializedGitClient } from "./gitUtils";
import { GitToolConfig } from "./types";
import { Tool } from "../types";

export const createGitTools = async (config: GitToolConfig) => {
  const git = await getInitializedGitClient(config);

  const tools: Tool[] = [
    new GitDiffTool(config, git),
    new GitStageCommitPushTool(config, git)
  ];

  return tools;
};

export * from './types';
