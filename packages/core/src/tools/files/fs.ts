import { Dirent, promises as fs, Stats } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

// Types
export interface FileInfo {
  path: string;
  content: string;
  hash: string;
  lines: number;
}

export interface LineRange {
  start: number;
  end: number;
}

export interface SearchResult {
  file: string;
  line: number;
  content: string;
  context: string[];
}

// Utility functions
export function validatePath(filePath: string, baseDir: string): string {
  filePath = filePath.replace(/^[/\\]+/, '');
  const normalizedPath = path.normalize(path.resolve(baseDir, filePath));
  
  // Ensure the path doesn't escape the base directory
  if (!normalizedPath.startsWith(baseDir)) {
    throw new Error('Invalid path: Attempted to access file outside of workspace');
  }
  
  return normalizedPath;
}

export async function ensureDirectoryExists(filePath: string): Promise<void> {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readFileWithRanges(filePath: string, ranges?: LineRange[]): Promise<string> {
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n');

  if (!ranges || ranges.length === 0) {
    return addLineNumbers(content);
  }

  // Combine content from specified ranges
  const selectedLines = ranges
    .reduce((acc, range) => {
      const start = Math.max(0, range.start - 1);
      const end = Math.min(lines.length, range.end);
      return acc.concat(lines.slice(start, end));
    }, [] as string[]);

  return addLineNumbers(selectedLines.join('\n'));
}

export function addLineNumbers(content: string): string {
  return content
    .split('\n')
    .map((line, index) => `${index + 1} | ${line}`)
    .join('\n');
}

export async function writeFile(filePath: string, content: string): Promise<void> {
  try {
    await fs.writeFile(filePath, content, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to write file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Directories to always exclude from recursive searches — these produce noise
// or are orders-of-magnitude too large for content searches in big repos.
export const SEARCH_EXCLUDED_DIRS = new Set([
  '.git', '.svn', '.hg', '.bzr',
  'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', '.turbo',
  '.cache', 'coverage', '.nyc_output', '__pycache__', '.venv', 'venv',
  '.tox', 'vendor', 'target', '.gradle', '.idea', '.vscode',
]);

// Per-file size cap: files larger than this are skipped (not a hard abort).
const MAX_FILE_SIZE_BYTES = 256_000; // 256 KB

// Maximum characters per matching line to prevent minified / base64 content
const MAX_LINE_CHARS = 500;

// Default result cap when head_limit is not specified.
export const SEARCH_DEFAULT_HEAD_LIMIT = 250;

export interface SearchOptions {
  contextLines?: number;
  workspacePath?: string;
  outputMode?: 'content' | 'files_with_matches';
  caseInsensitive?: boolean;
  headLimit?: number;
  offset?: number;
}

export async function searchFilesRecursive(
  directory: string,
  regex: RegExp,
  filePattern?: string,
  contextLines: number = 2,
  workspacePath?: string,
  options?: SearchOptions
): Promise<SearchResult[]> {
  // Merge legacy positional params with options object
  const effectiveContextLines = options?.contextLines ?? contextLines;
  const effectiveWorkspace = options?.workspacePath ?? workspacePath;
  const outputMode = options?.outputMode ?? 'content';
  const headLimit = options?.headLimit === 0 ? Infinity : (options?.headLimit ?? SEARCH_DEFAULT_HEAD_LIMIT);
  const offset = options?.offset ?? 0;

  const globRegex = filePattern
    ? new RegExp('^' + filePattern.replace(/[-\\^$+?.()|[\]{}]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
    : null;

  // Collect candidate files — skip excluded directories
  const candidateFiles: string[] = [];

  async function collect(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // Permission errors etc — just skip
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SEARCH_EXCLUDED_DIRS.has(entry.name)) {
          await collect(path.join(dir, entry.name));
        }
      } else if (entry.isFile()) {
        if (!globRegex || globRegex.test(entry.name)) {
          candidateFiles.push(path.join(dir, entry.name));
        }
      }
    }
  }

  await collect(directory);

  const results: SearchResult[] = [];
  let filesWithMatches = new Set<string>();

  // Search files sequentially to avoid thrashing the FS with large repos,
  // and to enforce head_limit early so we stop once we have enough results.
  for (const filePath of candidateFiles) {
    if (results.length >= offset + headLimit) break;

    // Per-file size guard: skip giant files instead of aborting everything.
    let stat: Stats;
    try {
      stat = await fs.stat(filePath);
    } catch {
      continue;
    }
    if (stat.size > MAX_FILE_SIZE_BYTES) continue;

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const relFile = effectiveWorkspace ? path.relative(effectiveWorkspace, filePath) : filePath;

      if (outputMode === 'files_with_matches') {
        // Just check if the file has any match
        const freshRegex = new RegExp(regex.source, regex.flags);
        if (freshRegex.test(content)) {
          filesWithMatches.add(relFile);
          results.push({ file: relFile, line: 0, content: '', context: [] });
        }
        continue;
      }

      // Content mode: collect each matching line with context
      const lines = content.split('\n');
      const freshRegex = new RegExp(regex.source, regex.flags);
      let match: RegExpExecArray | null;

      while ((match = freshRegex.exec(content)) !== null) {
        if (results.length >= offset + headLimit) break;

        const lineNumber = content.slice(0, match.index).split('\n').length;
        const start = Math.max(0, lineNumber - effectiveContextLines - 1);
        const end = Math.min(lines.length, lineNumber + effectiveContextLines);
        const context = lines.slice(start, end).map(l =>
          l.length > MAX_LINE_CHARS ? l.slice(0, MAX_LINE_CHARS) + '…' : l
        );

        const matchContent = match[0].length > MAX_LINE_CHARS
          ? match[0].slice(0, MAX_LINE_CHARS) + '…'
          : match[0];

        results.push({ file: relFile, line: lineNumber, content: matchContent, context });
      }
    } catch (error) {
      // Skip unreadable files (binary, permission issues, etc.)
    }
  }

  // Apply offset + head_limit window
  const windowed = results.slice(offset, offset + headLimit);
  return windowed;
}

export async function calculateFileHash(content: string): Promise<string> {
  return createHash('sha256').update(content).digest('hex');
}

export async function getFileInfo(filePath: string): Promise<FileInfo> {
  const content = await fs.readFile(filePath, 'utf-8');
  const hash = await calculateFileHash(content);
  const lines = content.split('\n').length;

  return {
    path: filePath,
    content,
    hash,
    lines
  };
}

export async function insertContentAtLine(
  filePath: string,
  content: string,
  lineNumber: number
): Promise<void> {
  const fileContent = await fs.readFile(filePath, 'utf-8');
  const lines = fileContent.split('\n');

  // Handle append case
  if (lineNumber === 0) {
    lines.push(content);
  } else {
    // Insert before specified line (1-based)
    lines.splice(lineNumber - 1, 0, content);
  }

  await writeFile(filePath, lines.join('\n'));
}

// Utility function to convert absolute paths to relative paths for display
export function getRelativePath(absolutePath: string, workspacePath: string): string {
  try {
    const relativePath = path.relative(workspacePath, absolutePath);
    // Check if the relative path starts with '..' which means it's outside the workspace
    if (relativePath.startsWith('..')) {
      return absolutePath;
    }

    if (relativePath.length === 0) {
      return '\\';
    }

    return relativePath;
  } catch {
    return absolutePath;
  }
}