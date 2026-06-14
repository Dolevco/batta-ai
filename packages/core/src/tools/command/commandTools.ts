import { ToolCategory, ToolParameter, ToolResult } from '../types';
import { BaseTool } from '../baseTool';
import { executeCommand, isCommandValid, sanitizeCommand } from './shell';
import { pathExists, validatePath } from '../files/fs';

const CommandsCategory: ToolCategory = {
  name: 'commands',
  description: 'Execute shell commands and scripts',
  keywords: ['command', 'execute', 'shell', 'run', 'script', 'terminal', 'bash']
};

export class ExecuteCommandTool extends BaseTool<{
  command: string;
  cwd?: string;
}> {
  name = 'execute_command';
  category = CommandsCategory;

  description = 'Execute a shell/CLI command. Use for CLI tool that has no dedicated tool. Do NOT use for reading files, searching code, or git operations — dedicated tools exist for those.';

  whenToUse = 'Use when you need to run a CLI command for package manager operations (install, audit, run scripts), security scanners, build tools, test runners, and any CLI tool that has no dedicated tool';

  // Commands can have side-effects (install, write) — not concurrency-safe by default.
  isConcurrencySafe = false;

  parameters: ToolParameter[] = [
    {
      name: 'command',
      description: 'The shell command to execute',
      required: true,
      type: 'string'
    },
    {
      name: 'cwd',
      description: 'Working directory for command execution',
      required: false,
      type: 'string'
    }
  ];

  getActivityDescription(params: Record<string, unknown>): string {
    const cmd = typeof params.command === 'string' ? params.command : '';
    const short = cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
    return `Running: ${short}`;
  }

  async execute(params: { command: string; cwd?: string }): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      let { command, cwd } = params;
      cwd = validatePath(cwd || '', this.workspacePath);

      if (!pathExists(cwd)) {
        return {
          success: false,
          message: `Invalid cwd: ${cwd}`,
          error: 'Invalid path'
        };
      }

      if (!isCommandValid(command)) {
        return {
          success: false,
          message: `Invalid command: ${command}`,
          error: 'Invalid or potentially harmful command'
        };
      }

      const result = await executeCommand(sanitizeCommand(command), { cwd });

      if (result.code !== 0) {
        // Surface a rich error that includes both stdout and stderr so the agent
        // can diagnose the root cause (e.g. wrong package manager, missing tool) and retry.
        const hint = buildRetryHint(command, result.stderr + result.stdout);
        return {
          success: false,
          message: `Command "${command}" failed with exit code ${result.code}${hint ? `\n\nHint: ${hint}` : ''}`,
          result: {
            stdout: this.sanitizeWorkspacePathFromMessage(result.stdout),
            stderr: this.sanitizeWorkspacePathFromMessage(result.stderr),
            code: result.code
          }
        };
      }

      return {
        success: true,
        message: `Command executed successfully: ${command}`,
        result: {
          stdout: this.sanitizeWorkspacePathFromMessage(result.stdout),
          stderr: this.sanitizeWorkspacePathFromMessage(result.stderr),
          code: result.code
        }
      };
    });
  }
}

/**
 * Build a contextual retry hint for common command failure patterns.
 */
function buildRetryHint(command: string, output: string): string | null {
  const out = output.toLowerCase();
  const cmd = command.toLowerCase().trim();

  // Wrong package manager — a known PM was invoked but may not be the workspace's PM
  const packageManagers = ['npm', 'npx', 'yarn', 'pnpm', 'bun'];
  const usedPm = packageManagers.find(pm => cmd.startsWith(pm + ' '));
  if (usedPm && (out.includes('could not find') || out.includes('not found') || out.includes('no such file') || out.includes('enoent'))) {
    return `The command failed, possibly due to using the wrong package manager. Check the "Workspace environment" section of the system prompt for the correct one and retry.`;
  }

  // Audit sub-command not recognised
  if (cmd.includes('audit') && (out.includes('no such command') || out.includes('unknown command') || out.includes('is not a known command'))) {
    return 'The audit command was not recognised. Check the "Workspace environment" section to confirm the correct package manager and its audit syntax.';
  }

  // Generic command not found
  if (out.includes('command not found') || out.includes('not recognized') || out.includes('is not a command')) {
    return 'The command was not found. Verify the tool is installed and available in PATH, or check the "Workspace environment" section for the correct package manager and toolchain.';
  }

  return null;
}
