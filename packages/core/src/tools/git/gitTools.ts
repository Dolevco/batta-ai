import { ToolParameter, ToolResult } from '../types';
import { GitBaseTool, GitCategory } from './types';

export class GitStatusTool extends GitBaseTool<{}> {
  name = 'git_status';
  category = GitCategory;
  description = 'Get the status of the working directory';
  parameters: ToolParameter[] = [];

  async execute(): Promise<ToolResult> {
    return this.wrapExecution({}, async () => {
      try {
        const git = this.git.cwd(this.workspacePath);
        const status = await git.status();

        return {
          success: true,
          message: 'Git status retrieved successfully',
          result: {
            current: status.current,
            tracking: status.tracking,
            modified: status.modified,
            created: status.created,
            deleted: status.deleted,
            renamed: status.renamed,
            staged: status.staged,
            conflicted: status.conflicted,
            ahead: status.ahead,
            behind: status.behind,
            isClean: status.isClean()
          }
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to get git status',
          error: error instanceof Error ? error.message : 'Status operation failed'
        };
      }
    });
  }
}

export class GitAddTool extends GitBaseTool<{
  files: string;
}> {
  name = 'git_add';
  category = GitCategory;
  description = 'Stage files for commit';
  parameters: ToolParameter[] = [
    {
      name: 'files',
      description: 'Files to stage (e.g., ".", "*.ts", "src/file.ts")',
      required: true,
      type: 'string'
    }
  ];

  async execute(params: { files: string }): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      const { files } = params;

      try {
        const git = this.git.cwd(this.workspacePath);
        await git.add(files);

        return {
          success: true,
          message: `Successfully staged files: ${files}`,
          result: { files }
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to add files: ${files}`,
          error: error instanceof Error ? error.message : 'Add operation failed'
        };
      }
    });
  }
}

export class GitCommitTool extends GitBaseTool<{
  message: string;
}> {
  name = 'git_commit';
  category = GitCategory;
  description = 'Commit staged changes';
  parameters: ToolParameter[] = [
    {
      name: 'message',
      description: 'Commit message',
      required: true,
      type: 'string'
    }
  ];

  async execute(params: { message: string }): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      const { message } = params;

      try {
        const git = this.git.cwd(this.workspacePath);
        const result = await git.commit(message);

        return {
          success: true,
          message: 'Successfully committed changes',
          result: {
            commit: result.commit,
            summary: result.summary,
            branch: result.branch
          }
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to commit changes',
          error: error instanceof Error ? error.message : 'Commit operation failed'
        };
      }
    });
  }
}

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

export class GitCheckoutTool extends GitBaseTool<{
  target: string;
  createBranch?: boolean;
}> {
  name = 'git_checkout';
  category = GitCategory;
  description = 'Switch branches or restore working tree files';
  parameters: ToolParameter[] = [
    {
      name: 'target',
      description: 'Branch name or commit to checkout',
      required: true,
      type: 'string'
    },
    {
      name: 'createBranch',
      description: 'Create a new branch (default: false)',
      required: false,
      type: 'boolean'
    }
  ];

  async execute(params: { target: string; createBranch?: boolean }): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      const { target, createBranch } = params;

      try {
        const git = this.git.cwd(this.workspacePath);
        
        if (createBranch) {
          await git.checkoutLocalBranch(target);
        } else {
          await git.checkout(target);
        }

        return {
          success: true,
          message: `Successfully checked out: ${target}`,
          result: { target, created: createBranch }
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to checkout: ${target}`,
          error: error instanceof Error ? error.message : 'Checkout operation failed'
        };
      }
    });
  }
}

export class GitPushTool extends GitBaseTool<{
  remote?: string;
  branch?: string;
  setUpstream?: boolean;
}> {
  name = 'git_push';
  category = GitCategory;
  description = 'Update remote refs along with associated objects';
  parameters: ToolParameter[] = [
    {
      name: 'branch',
      description: 'Branch name (optional)',
      required: true,
      type: 'string'
    }
  ];

  async execute(params: { branch: string; }): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      try {
        const git = this.git.cwd(this.workspacePath);
        await git.push('origin', params.branch);

        return {
          success: true,
          message: 'Successfully pushed changes',
          result: {
            branch: params.branch || 'current'
          }
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to push changes',
          error: error instanceof Error ? error.message : 'Push operation failed'
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
