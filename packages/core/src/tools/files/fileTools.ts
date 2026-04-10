import { BaseTool } from '../baseTool';
import { validatePath, ensureDirectoryExists, writeFile, searchFilesRecursive, insertContentAtLine, getRelativePath, SEARCH_DEFAULT_HEAD_LIMIT, SEARCH_EXCLUDED_DIRS } from './fs';
import * as path from 'path';
import { promises as fs } from 'fs';
import { ToolCategory, ToolParameter, ToolResult } from '../types';
import { InsertContentParams, ListFilesParams, PreviewFileParams, ReadFileParams, SearchAndReplaceOptions, SearchFilesParams, WriteFileParams } from './types';
import { FileSummarizerFactory, FileSummary } from './summarizers/index';

export const FilesCategory: ToolCategory = {
  name: 'files',
  description: 'File operations: read, write, search, list, and modify files',
  keywords: ['file', 'read', 'write', 'search', 'list', 'delete', 'insert', 'replace', 'content'],
  requireAllTools: true,
};

export class ReadFileTool extends BaseTool<ReadFileParams> {
  name = 'read_file';
  category = FilesCategory;
  description = 'Read the contents of a file';
  isConcurrencySafe = true;
  getActivityDescription(params: ReadFileParams): string {
    return `Reading ${params.path}`;
  }
  parameters: ToolParameter[] = [
    {
      name: 'path',
      description: 'File path',
      required: true,
      type: 'string'
    },
    {
      name: 'fromLine',
      description: 'Starting line number (1-based, optional)',
      required: false,
      type: 'number'
    },
    {
      name: 'toLine',
      description: 'Ending line number (1-based, optional)',
      required: false,
      type: 'number'
    }
  ];

  async execute(params: ReadFileParams): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      try {
        const filePath = validatePath(params.path, this.workspacePath);
        const content = await fs.readFile(filePath, 'utf-8');

        // If no line range requested, return full content
        const from = params.fromLine ?? 1;
        const lines = content.split('\n');
        const to = params.toLine ?? lines.length;

        if (from < 1 || to < 1 || from > to) {
          return {
            success: false,
            message: `Invalid line range from ${from} to ${to}`
          };
        }

        // Clamp end to file length
        const clampedTo = Math.min(to, lines.length);

        const sliced = lines.slice(from - 1, clampedTo).join('\n');

        return {
          success: true,
          message: `File read successfully from ${params.path}${(params.fromLine || params.toLine) ? ` (lines ${from}-${clampedTo})` : ''}`,
          result: sliced
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to read file at ${params.path}`,
          error: error instanceof Error ? this.sanitizeWorkspacePathFromMessage(error.message) : 'Unknown error occurred'
        };
      }
    });
  }
}

export class WriteFileTool extends BaseTool<WriteFileParams> {
  name = 'write_to_file';
  category = FilesCategory;
  description = 'Write content to a file, creating directories if needed. for existing files, it will replace all the file content, make sure the data is not partial';
  parameters: ToolParameter[] = [
    {
      name: 'path',
      description: 'File path to write to',
      required: true,
      type: 'string'
    },
    {
      name: 'content',
      description: 'Content to write',
      required: true,
      type: 'string'
    }
  ];

  async execute(params: WriteFileParams): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      const filePath = validatePath(params.path, this.workspacePath);
      await ensureDirectoryExists(filePath);
      await writeFile(filePath, params.content);

      return {
        success: true,
        message: `File written successfully: ${params.path}`,
        result: `File written successfully: ${params.path}`
      };
    });
  }
}

export class DeleteFileTool extends BaseTool<ReadFileParams> {
  name = 'delete_file';
  category = FilesCategory;
  description = 'Delete a file';
  parameters: ToolParameter[] = [
    {
      name: 'path',
      description: 'Path to the file to delete',
      required: true,
      type: 'string'
    }
  ];
  async execute(params: ReadFileParams): Promise<ToolResult> {
    try {
      const path = validatePath(params.path, this.workspacePath);

      await fs.unlink(path);
      return {
        success: true,
        message: `File deleted successfully at ${params.path}`,
        result: `File deleted successfully at ${params.path}`
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to delete file at ${params.path}`,
        error: error instanceof Error ? this.sanitizeWorkspacePathFromMessage(error.message) : 'Unknown error occurred'
      };
    }
  }
};

export class SearchFilesTool extends BaseTool<SearchFilesParams> {
  name = 'search_files_content';
  category = FilesCategory;
  description =
    'Search file contents using a regex pattern. ' +
    'Large repos are handled safely: files over 256 KB and directories like node_modules/.git/dist are skipped automatically. ' +
    'Use output_mode="files_with_matches" to find which files contain a pattern without reading all content. ' +
    'Use head_limit + offset to paginate through large result sets.';
  isConcurrencySafe = true;
  maxResultSizeChars = 20_000;

  getActivityDescription(params: SearchFilesParams): string {
    const mode = params.output_mode === 'files_with_matches' ? ' (file list)' : '';
    return `Searching "${params.path}" for /${params.regex}/${mode}`;
  }

  parameters: ToolParameter[] = [
    {
      name: 'path',
      description: 'Directory to search in',
      required: true,
      type: 'string'
    },
    {
      name: 'regex',
      description: 'Regular expression pattern to search for in file contents',
      required: true,
      type: 'string'
    },
    {
      name: 'file_pattern',
      description: 'File name pattern to filter (e.g., "*.ts", "*.{ts,tsx}"). Matches only file names, not full paths.',
      required: false,
      type: 'string'
    },
    {
      name: 'output_mode',
      description: '"content" returns matching lines with context (default). "files_with_matches" returns only the file paths that contain at least one match — faster for large repos when you just need to locate files.',
      required: false,
      type: 'string'
    },
    {
      name: 'context_lines',
      description: 'Number of lines to show before and after each match (content mode only). Default: 2.',
      required: false,
      type: 'number'
    },
    {
      name: 'case_insensitive',
      description: 'Case insensitive search. Default: false.',
      required: false,
      type: 'boolean'
    },
    {
      name: 'head_limit',
      description: `Limit results to first N entries. Default: ${SEARCH_DEFAULT_HEAD_LIMIT}. Pass 0 for unlimited (use sparingly — large result sets waste context).`,
      required: false,
      type: 'number'
    },
    {
      name: 'offset',
      description: 'Skip first N entries before applying head_limit. Use with head_limit to paginate. Default: 0.',
      required: false,
      type: 'number'
    }
  ];

  async execute(params: SearchFilesParams): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      const searchPath = validatePath(params.path, this.workspacePath);

      // Build regex flags
      // Always use 'g' (global) so RegExp.exec iterates; add 'm' for multiline anchors, 'i' for case insensitive
      const flags = ['g', 'm', params.case_insensitive ? 'i' : ''].filter(Boolean).join('');
      let regex: RegExp;
      try {
        regex = new RegExp(params.regex, flags);
      } catch (e) {
        return {
          success: false,
          message: `Invalid regex pattern: ${params.regex}`,
          error: e instanceof Error ? e.message : 'Invalid regex'
        };
      }

      const outputMode = params.output_mode === 'files_with_matches' ? 'files_with_matches' : 'content';
      const headLimit = params.head_limit;
      const offset = params.offset ?? 0;
      const contextLines = params.context_lines ?? 2;

      const results = await searchFilesRecursive(
        searchPath,
        regex,
        params.file_pattern,
        contextLines,
        this.workspacePath,
        {
          outputMode,
          headLimit,
          offset,
          contextLines,
          workspacePath: this.workspacePath,
        }
      );

      const searchDir = getRelativePath(searchPath, this.workspacePath);

      if (outputMode === 'files_with_matches') {
        const files = results.map(r => r.file);
        const isTruncated = headLimit !== undefined && headLimit !== 0 && results.length >= (headLimit ?? SEARCH_DEFAULT_HEAD_LIMIT);
        const truncationNote = isTruncated
          ? ` (results truncated at ${headLimit}; use offset=${offset + results.length} to continue)`
          : '';
        return {
          success: true,
          message: `Found ${files.length} file${files.length === 1 ? '' : 's'} matching /${params.regex}/ in "${searchDir}"${truncationNote}`,
          result: files
        };
      }

      // Content mode
      const effectiveLimit = headLimit === 0 ? Infinity : (headLimit ?? SEARCH_DEFAULT_HEAD_LIMIT);
      const isTruncated = results.length >= effectiveLimit && effectiveLimit !== Infinity;
      const truncationNote = isTruncated
        ? ` (showing first ${results.length} matches; use offset=${offset + results.length} to see more)`
        : '';

      return {
        success: true,
        message: `Found ${results.length} match${results.length === 1 ? '' : 'es'} for /${params.regex}/ in "${searchDir}"${truncationNote}`,
        result: results
      };
    });
  }
}

export class ListFilesTool extends BaseTool<ListFilesParams> {
  name = 'list_files';
  category = FilesCategory;
  description = 'List files in a directory. node_modules, .git, dist, build and other noisy directories are excluded by default.';
  isConcurrencySafe = true;
  getActivityDescription(params: ListFilesParams): string {
    return `Listing ${params.path}`;
  }
  parameters: ToolParameter[] = [
    {
      name: 'path',
      description: 'Directory to list',
      required: true,
      type: 'string'
    },
    {
      name: 'recursive',
      description: 'Whether to list recursively',
      required: false,
      type: 'boolean'
    },
    {
      name: 'file_pattern',
      description: 'Comma-separated file patterns or relative file paths to filter (e.g., "*.ts", "package.json, src/index.ts"). Patterns with a path segment (contain "/") will be matched against relative paths and will force a recursive search to find nested files.',
      required: false,
      type: 'string'
    }
  ];

  async execute(params: ListFilesParams): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      const rawPath = typeof params.path === 'string' ? (params.path.replace(/\.+$/, '') || '.') : params.path;
      const dirPath = validatePath(rawPath, this.workspacePath);
      let recursive = !!params.recursive;

      // Support multiple comma-separated patterns
      const patternParam = typeof params.file_pattern === 'string' ? params.file_pattern : '';
      const patternParts = patternParam
        .split(',')
        .map(p => p.trim())
        .filter(Boolean);

      type Pat = { raw: string; regex: RegExp; matchRelative: boolean };

      const patterns: Pat[] = patternParts.map(p => {
        const matchRelative = p.includes('/') || p.includes(path.sep);
        // escape regex special chars (including * and ?) so we can convert them to wildcards
        const esc = p.replace(/[-\\^$+?.()|[\]{}*]/g, '\\$&');
        const regexStr = '^' + esc.replace(/\\\*/g, '.*').replace(/\\\?/g, '.') + '$';
        return { raw: p, regex: new RegExp(regexStr), matchRelative };
      });

      // If any pattern requires a relative path match, enable recursion
      if (patterns.some(p => p.matchRelative)) recursive = true;

      const files: string[] = [];

      async function readDir(dir: string, workspacePath: string, isTopLevel: boolean): Promise<void> {
        let entries: import('fs').Dirent[];
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            // Skip noisy/large directories unless we're at top level listing non-recursively
            if (recursive && SEARCH_EXCLUDED_DIRS.has(entry.name)) {
              continue;
            }
            if (recursive) {
              await readDir(fullPath, workspacePath, false);
            } else if (isTopLevel) {
              // In non-recursive mode, list directories at the top level
              files.push(path.relative(workspacePath, fullPath) + '/');
            }
          } else if (entry.isFile()) {
            let matched = false;

            if (patterns.length === 0) {
              matched = true;
            } else {
              const relPath = path.relative(dirPath, fullPath).replace(/\\\\/g, '/');
              for (const p of patterns) {
                if (p.matchRelative) {
                  if (p.regex.test(relPath)) {
                    matched = true;
                    break;
                  }
                } else {
                  if (p.regex.test(entry.name)) {
                    matched = true;
                    break;
                  }
                }
              }
            }

            if (matched) {
              files.push(path.relative(workspacePath, fullPath));
            }
          }
        }
      }

      await readDir(dirPath, this.workspacePath, true);

      if (files.length > 1000) {
        return {
          success: false,
          message: `Too many files. try to be more specific. Listed ${files.length} items in "${getRelativePath(dirPath, this.workspacePath)}"${recursive ? ' recursively' : ''}`
        };
      }

      return {
        success: true,
        message: `Listed ${files.length} items in "${getRelativePath(dirPath, this.workspacePath)}"${recursive ? ' recursively' : ''}`,
        result: files
      };
    });
  }
}

export class InsertContentTool extends BaseTool<InsertContentParams> {
  name = 'insert_content';
  category = FilesCategory;
  description = 'Insert content at a specific line in a file';
  parameters: ToolParameter[] = [
    {
      name: 'path',
      description: 'File path',
      required: true,
      type: 'string'
    },
    {
      name: 'line',
      description: 'Line number to insert at (0 for append)',
      required: true,
      type: 'number'
    },
    {
      name: 'content',
      description: 'Content to insert',
      required: true,
      type: 'string'
    }
  ];

  async execute(params: InsertContentParams): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      const filePath = validatePath(params.path, this.workspacePath);
      await insertContentAtLine(
        filePath,
        params.content,
        params.line
      );

      return {
        success: true,
        message: `Content inserted at line ${params.line} in "${getRelativePath(filePath, this.workspacePath)}"`,
        result: `Content inserted at line ${params.line}`
      };
    });
  }
}

export class SearchAndReplaceTool extends BaseTool<SearchAndReplaceOptions> {
  name = 'search_and_replace';
  category = FilesCategory;
  description = 'Find and replace text in files with regex support';
  parameters: ToolParameter[] = [
    {
      name: 'path',
      description: 'File path',
      required: true,
      type: 'string'
    },
    {
      name: 'search',
      description: 'Text or pattern to search for',
      required: true,
      type: 'string'
    },
    {
      name: 'replace',
      description: 'Replacement text',
      required: true,
      type: 'string'
    },
    {
      name: 'use_regex',
      description: 'Whether to treat search as regex',
      required: false,
      type: 'boolean'
    },
    {
      name: 'ignore_case',
      description: 'Whether to ignore case',
      required: false,
      type: 'boolean'
    },
    {
      name: 'start_line',
      description: 'Starting line number (1-based)',
      required: false,
      type: 'number'
    },
    {
      name: 'end_line',
      description: 'Ending line number (1-based)',
      required: false,
      type: 'number'
    }
  ];

  async execute(params: SearchAndReplaceOptions): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      const filePath = validatePath(params.path, this.workspacePath);
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      const startLine = params.start_line || 1;
      const endLine = params.end_line || lines.length;

      // Create search regex
      let searchPattern: RegExp;
      if (params.use_regex) {
        try {
          const flags = params.ignore_case ? 'gi' : 'g';
          searchPattern = new RegExp(params.search, flags);
        } catch (error) {
          return {
            success: false,
            message: `Invalid regex pattern: ${params.search}`,
            error: `Invalid regex pattern: ${error instanceof Error ? this.sanitizeWorkspacePathFromMessage(error.message) : 'Unknown error'}`
          };
        }
      } else {
        const flags = params.ignore_case ? 'gi' : 'g';
        searchPattern = new RegExp(
          params.search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'),
          flags
        );
      }

      // Track changes
      let replacements = 0;
      const newLines = lines.map((line, index) => {
        const lineNum = index + 1;
        if (lineNum >= startLine && lineNum <= endLine) {
          const newLine = line.replace(searchPattern, (match) => {
            replacements++;
            return params.replace;
          });
          return newLine;
        }
        return line;
      });

      if (replacements === 0) {
        return {
          success: true,
          message: 'No matches found',
          result: {
            message: 'No matches found',
            replacements: 0
          }
        };
      }

      // Write changes back to file
      await writeFile(filePath, newLines.join('\n'));

      return {
        success: true,
        message: `Made ${replacements} replacement${replacements === 1 ? '' : 's'} in ${getRelativePath(filePath, this.workspacePath)}`,
        result: {
          message: `Made ${replacements} replacement${replacements === 1 ? '' : 's'}`,
          replacements
        }
      };
    });
  }
}

export class ReplaceContentTool extends BaseTool<any> {
  name = 'replace_content_in_range';
  category = FilesCategory;
  description = 'Replace content between start_line and end_line (inclusive) with new content';
  parameters: ToolParameter[] = [
    {
      name: 'path',
      description: 'File path',
      required: true,
      type: 'string'
    },
    {
      name: 'start_line',
      description: 'Starting line number (1-based)',
      required: true,
      type: 'number'
    },
    {
      name: 'end_line',
      description: 'Ending line number (1-based)',
      required: true,
      type: 'number'
    },
    {
      name: 'content',
      description: 'Replacement content',
      required: true,
      type: 'string'
    }
  ];

  async execute(params: any): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      const filePath = validatePath(params.path, this.workspacePath);
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      const start = Number(params.start_line);
      const end = Number(params.end_line);

      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
        return {
          success: false,
          message: `Invalid line range from ${params.start_line} to ${params.end_line}`
        };
      }

      // Build new file content by replacing the specified range
      const before = lines.slice(0, start - 1);
      const after = lines.slice(end);
      const insertLines = params.content.split('\n');
      const newLines = [...before, ...insertLines, ...after];

      await writeFile(filePath, newLines.join('\n'));

      const replacedCount = Math.max(0, end - start + 1);
      return {
        success: true,
        message: `Replaced ${replacedCount} line${replacedCount === 1 ? '' : 's'} (${start}-${end}) in "${getRelativePath(filePath, this.workspacePath)}"`,
        result: {
          path: getRelativePath(filePath, this.workspacePath),
          replaced: replacedCount
        }
      };
    });
  }
}

export class ReplaceInFileTool extends BaseTool<any> {
  name = 'replace_in_file';
  category = FilesCategory;
  description = 'Replace sections of content in an existing file using SEARCH/REPLACE blocks that define exact changes to specific parts of the file. This tool should be used when you need to make targeted changes to specific parts of a file.';
  parameters: ToolParameter[] = [
    {
      name: 'path',
      description: 'The path to the file to write to.',
      required: true,
      type: 'string'
    },
    {
      name: 'diff',
      description: `One or more SEARCH/REPLACE blocks following this exact format:
  \`\`\`
  ------- SEARCH
  [exact content to find]
  =======
  [new content to replace with]
  +++++++ REPLACE
  \`\`\`
  Critical rules:
  1. SEARCH content must match the associated file section to find EXACTLY:
     * Match character-for-character including whitespace, indentation, line endings
     * Include all comments, docstrings, etc.
  2. SEARCH/REPLACE blocks will ONLY replace the first match occurrence.
     * Including multiple unique SEARCH/REPLACE blocks if you need to make multiple changes.
     * Include *just* enough lines in each SEARCH section to uniquely match each set of lines that need to change.
     * When using multiple SEARCH/REPLACE blocks, list them in the order they appear in the file.
  3. Keep SEARCH/REPLACE blocks concise:
     * Break large SEARCH/REPLACE blocks into a series of smaller blocks that each change a small portion of the file.
     * Include just the changing lines, and a few surrounding lines if needed for uniqueness.
     * Do not include long runs of unchanging lines in SEARCH/REPLACE blocks.
     * Each line must be complete. Never truncate lines mid-way through as this can cause matching failures.
  4. Special operations:
     * To move code: Use two SEARCH/REPLACE blocks (one to delete from original + one to insert at new location)
     * To delete code: Use empty REPLACE section`,
      required: true,
      type: 'string'
    }
  ];

  async execute(params: any): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      try {
        const absolutePath = validatePath(params.path, this.workspacePath);
        const fileContent = await fs.readFile(absolutePath, 'utf-8');
        const diffText: string = params.diff || '';

        // Regex to capture blocks of the exact format:
        // ------- SEARCH\n<search>\n=======\n<replace>\n+++++++ REPLACE
        const blockRegex = /-{6,8}\s*SEARCH\s*\r?\n([\s\S]*?)\r?\n={6,8}\s*\r?\n([\s\S]*?)\r?\n\+{6,8}\s*REPLACE/g;

        const matches = [...diffText.matchAll(blockRegex)];

        if (matches.length === 0) {
          return {
            success: false,
            message: `${params.path} - No valid SEARCH/REPLACE blocks found in diff`
          };
        }

        // We'll perform replacements sequentially; each SEARCH block replaces only the first match
        let newContent = fileContent;
        const details: Array<{block: number; preview: string}> = [];

        for (let i = 0; i < matches.length; i++) {
          const m = matches[i];
          const searchText = m[1];
          const replaceText = m[2];

          const idx = newContent.indexOf(searchText);
          if (idx === -1) {
            return {
              success: false,
              message: `${params.path} - SEARCH block ${i + 1} not found in file. try to read the file to make sure the block is accurate`,
              result: {
                path: params.path,
                blockIndex: i + 1,
                searchPreview: searchText.slice(0, 200)
              }
            };
          }

          // Replace only the first occurrence
          newContent = newContent.slice(0, idx) + replaceText + newContent.slice(idx + searchText.length);

          details.push({ block: i + 1, preview: searchText.slice(0, 200) });
        }

        // Write back
        await writeFile(absolutePath, newContent);

        return {
          success: true,
          message: `${params.path} - Applied ${details.length} SEARCH/REPLACE block${details.length === 1 ? '' : 's'}`,
          result: {
            path: params.path,
            replacedBlocks: details.length,
            details
          }
        };
      } catch (error) {
        return {
          success: false,
          message: `${params.path || 'path'} - Failed to apply replacements`,
          error: error instanceof Error ? this.sanitizeWorkspacePathFromMessage(error.message) : 'Unknown error occurred'
        };
      }
    });
  }
}

export class PreviewFileTool extends BaseTool<PreviewFileParams> {
  name = 'preview_file';
  category = FilesCategory;
  description =
    'Returns a structural skeleton of a file — symbol names, line numbers, and metadata — ' +
    'without loading full content. Use this before read_file when you need to locate a specific ' +
    'function or assess whether a file is relevant. Best for exploration tasks and files over ~80 lines; for shorter ' +
    'files just use read_file.';
  isConcurrencySafe = true;

  getActivityDescription(params: PreviewFileParams): string {
    return `Previewing ${params.path}`;
  }

  parameters: ToolParameter[] = [
    {
      name: 'path',
      description: 'File path to preview',
      required: true,
      type: 'string',
    },
  ];

  async execute(params: PreviewFileParams): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      // Security: validatePath rejects any path that escapes the workspace directory
      const filePath = validatePath(params.path, this.workspacePath);
      const content = await fs.readFile(filePath, 'utf-8');
      const stat = await fs.stat(filePath);

      const ext = path.extname(filePath);
      const summarizer = FileSummarizerFactory.get(ext);
      const items = summarizer.summarize(content);
      const totalLines = content.split('\n').length;

      const summary: FileSummary = {
        file: getRelativePath(filePath, this.workspacePath),
        type: summarizer.languageLabel,
        total_lines: totalLines,
        last_modified: stat.mtime.toISOString().slice(0, 10),
        items,
      };

      return {
        success: true,
        message: `Previewed ${summary.file} — ${summary.total_lines} lines, ${items.length} items`,
        result: summary,
      };
    });
  }
}
