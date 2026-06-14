import { ToolParameter, ToolResult } from '../types';
import { GitBaseTool, GitCategory } from './types';
export class GitDiffTool extends GitBaseTool<{
  files?: string;
  staged?: boolean;
}> {
  name = 'git_diff';
  category = GitCategory;
  description = 'Show changes between commits, commit and working tree, etc';
  parameters: ToolParameter[] = [];

  async execute(params: any): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      try {
        const git = this.git.cwd(this.workspacePath);
        const diff = await git.diff();

        return {
          success: true,
          message: 'Git diff retrieved successfully',
          result: { diff }
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to get diff',
          error: error instanceof Error ? error.message : 'Diff operation failed'
        };
      }
    });
  }
}


export class GitStageCommitPushTool extends GitBaseTool<{
  message: string;
  branch?: string;
}> {
  name = 'git_stage_commit_push';
  category = GitCategory;
  description = 'Stage all changes, commit with a message, and push to remote feature branch';
  parameters: ToolParameter[] = [
    {
      name: 'message',
      description: 'Commit message',
      required: true,
      type: 'string'
    }
  ];

  async execute(params: { message: string; }): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      const { message } = params;

      const git = this.git.cwd(this.workspacePath);
      
      // Stage all changes
      await git.add('.');
      
      // Commit
      const commitResult = await git.commit(message);
      
      // Push
      await git.push('origin', this.gitConfig.currentBranch);

      return {
        success: true,
        message: 'Successfully staged, committed, and pushed changes',
        result: {
          commit: commitResult.commit,
          summary: commitResult.summary,
          branch: this.gitConfig.currentBranch
        }
      };
    });
  }
}
