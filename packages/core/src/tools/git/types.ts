import { SimpleGit } from "simple-git";
import { ToolCategory, ToolConfig } from "../types";
import { BaseTool } from "../baseTool";

export interface GitToolConfig extends ToolConfig {
  gitProviderUrl: string; // e.g. https://github.com
  accessToken: string;
  repository: string; // e.g. your-org/sample-repo
  mainBranch: string;
  currentBranch: string;
}

export const GitCategory: ToolCategory = {
  name: 'git',
  description: 'Interact with local git repositories',
  keywords: ['git', 'version control', 'repository', 'commit', 'branch', 'clone']
};

export abstract class GitBaseTool<T extends Record<string, unknown>> extends BaseTool<T> {
  protected git: SimpleGit;
  protected gitConfig: GitToolConfig;

  constructor(config: GitToolConfig, git: SimpleGit) {
    super(config);
    this.gitConfig = config;
    this.git = git;
  }
}