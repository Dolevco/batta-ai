import { spawn, SpawnOptionsWithoutStdio } from 'child_process';
import * as os from 'os';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  shell?: boolean | string;
  timeout?: number;
}

function getDefaultShell(): string {
  const platform = os.platform();
  
  if (platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  
  return process.env.SHELL || '/bin/bash';
}

function parseCommand(command: string): { executable: string; args: string[] } {
  const platform = os.platform();
  
  if (platform === 'win32') {
    return {
      executable: 'cmd.exe',
      args: ['/C', command]
    };
  }
  
  return {
    executable: getDefaultShell(),
    args: ['-c', command]
  };
}

// New helper: sanitize environment for child processes to avoid inheriting Node inspector flags
function sanitizeEnv(env: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const newEnv: NodeJS.ProcessEnv = { ...env };

  // Remove Node inspector flags from NODE_OPTIONS to avoid child processes starting the inspector
  if (typeof newEnv.NODE_OPTIONS === 'string') {
    const tokens = newEnv.NODE_OPTIONS.split(/\s+/).filter(Boolean);
    const filtered = tokens.filter(t => !/^--inspect/.test(t) && !/^--inspect-brk/.test(t) && !/^--inspect-port/.test(t));
    if (filtered.length > 0) {
      newEnv.NODE_OPTIONS = filtered.join(' ');
    } else {
      delete newEnv.NODE_OPTIONS;
    }
  }

  // Remove common VS Code / Electron inspector env vars that can cause "address already in use"
  delete newEnv.VSCODE_INSPECTOR_OPTIONS;
  delete newEnv.VSCODE_INSPECTOR_PORT;
  delete newEnv.ELECTRON_RUN_AS_NODE;

  return newEnv;
}

export function executeCommand(
  command: string,
  options: CommandOptions = {}
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const { executable, args } = parseCommand(command);
    
    const spawnOptions: SpawnOptionsWithoutStdio = {
      cwd: options.cwd,
      env: sanitizeEnv({
        ...process.env,
        ...options.env
      }),
      shell: options.shell
    };

    const child = spawn(executable, args, spawnOptions);
    
    let stdout = '';
    let stderr = '';
    let killed = false;
    
    // Set timeout if specified
    const timeout = options.timeout ? setTimeout(() => {
      killed = true;
      child.kill();
    }, options.timeout) : null;

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      if (timeout) clearTimeout(timeout);
      reject(new Error(`Failed to execute command: ${error.message}`));
    });

    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      
      if (killed) {
        reject(new Error(`Command timed out after ${options.timeout}ms`));
        return;
      }

      resolve({
        code: code ?? 0,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });
  });
}

export function isCommandValid(command: string): boolean {
  // List of dangerous commands or patterns
  const dangerousPatterns = [
    /rm\s+(-rf?|--force)\s+[\/~]/i,  // Dangerous rm commands
    /mkfs/i,                          // Format drives
    /dd/i,                            // Direct disk operations
    />[>]?\s*\//,                     // Writing to root
    /\|\s*sudo/i,                     // Piping to sudo
    /(^|\s)sudo(\s|$)/i,             // Sudo commands
    /:\(\)\s*{\s*:\|\:&\s*}\s*;:/,   // Fork bomb
    /chmod\s+777/i,                   // Unsafe permissions
    /(^|\s)mv\s+.*\s+\//,            // Moving to root
    />\s*\/dev\//,                    // Writing to devices
    /(^|\s)git(\s|$)/i                // Disallow using git CLI
  ];

  // Check for dangerous patterns
  for (const pattern of dangerousPatterns) {
    if (pattern.test(command)) {
      return false;
    }
  }

  // Basic validation: non-empty and no null bytes
  return command.length > 0 && !command.includes('\0');
}

export function sanitizeCommand(command: string): string {
  // Remove any leading/trailing whitespace
  command = command.trim();
  
  // Remove any ANSI escape sequences
  command = command.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
  
  // Replace multiple spaces with single space
  command = command.replace(/\s+/g, ' ');
  
  // Remove any backticks or $(shell execution)
  command = command.replace(/`|\$\(/g, '');
  
  return command;
}