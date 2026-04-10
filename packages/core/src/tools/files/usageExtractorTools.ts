/**
 * Usage Extractor Tools
 *
 * Seven specialised tools for the UsageExtractor agent pipeline.
 * All tools are read-only; none mutate the workspace.
 *
 * Security invariants (applied uniformly across every tool):
 *   1. All file/directory paths are validated through validatePath() which
 *      rejects any path that would escape the workspace root.
 *   2. Regex parameters are compiled inside a try/catch; invalid patterns
 *      return a descriptive error result rather than throwing.
 *   3. Commit SHA parameters are passed directly to simple-git and never
 *      interpolated into shell commands.
 *   4. resolve_env_variable never returns raw secret values — value_hint
 *      is replaced with "***" for any value that passes containsSecrets().
 *   5. All error messages pass through sanitizeWorkspacePathFromMessage()
 *      so that absolute workspace paths are never disclosed to callers.
 */

import * as path from 'path';
import { promises as fs } from 'fs';
import simpleGit from 'simple-git';
import { BaseTool } from '../baseTool';
import { ToolCategory, ToolParameter, ToolResult } from '../types';
import { validatePath, searchFilesRecursive, SEARCH_EXCLUDED_DIRS } from './fs';
import { FilesCategory } from './fileTools';

// ─── Shared helpers ────────────────────────────────────────────────────────────

const MAX_RESULT_CHARS = 20_000;
const MAX_FILE_SIZE = 256_000; // 256 KB — same cap as SearchFilesTool

/** Lightweight secret-value detection used by resolve_env_variable. */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /eyJ[A-Za-z0-9_-]{20,}/,                      // JWT
  /(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/i, // Stripe-style
  /AKIA[0-9A-Z]{16}/,                            // AWS access key
  /[a-f0-9]{40}/,                               // 40-char hex token
  /AccountKey=[A-Za-z0-9+/=]{40,}/,              // Azure storage
  /ghp_[a-zA-Z0-9]{36,}/,                        // GitHub PAT
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/,// PEM key
];

function looksLikeSecret(value: string): boolean {
  const lower = value.toLowerCase();
  if (/(password|secret|token|apikey|api_key|private_key|client_secret)/.test(lower) &&
      value.length > 8) {
    return true;
  }
  return SECRET_VALUE_PATTERNS.some(p => p.test(value));
}

/** Trim a string result to MAX_RESULT_CHARS to prevent LLM context bloat. */
function capString(s: string): string {
  if (s.length <= MAX_RESULT_CHARS) return s;
  return s.slice(0, MAX_RESULT_CHARS) + '\n…(truncated)';
}

// ─── 1. GitChangedFilesTool ───────────────────────────────────────────────────

export interface GitChangedFilesParams extends Record<string, unknown> {
  since_commit: string;
  until_commit?: string;
  path_filter?: string;
}

export interface GitChangedFilesOutput {
  added: string[];
  modified: string[];
  deleted: string[];
  renamed: Array<{ from: string; to: string }>;
  all_changed: string[];
}

export class GitChangedFilesTool extends BaseTool<GitChangedFilesParams> {
  name = 'git_changed_files';
  category = FilesCategory;
  isConcurrencySafe = true;
  description =
    'Return the list of files changed between two commits (or since a commit) in the ' +
    'workspace repository. Use this as the entry point for incremental extraction runs ' +
    'to restrict all subsequent searches to only the files that changed.';

  getActivityDescription(params: GitChangedFilesParams): string {
    return `Getting changed files since ${params.since_commit}`;
  }

  parameters: ToolParameter[] = [
    {
      name: 'since_commit',
      description: 'SHA of the last indexed commit. All files changed after this commit are returned.',
      required: true,
      type: 'string',
    },
    {
      name: 'until_commit',
      description: 'Upper bound commit SHA (defaults to HEAD).',
      required: false,
      type: 'string',
    },
    {
      name: 'path_filter',
      description: 'Optional subdirectory to scope the diff (e.g. "src/").',
      required: false,
      type: 'string',
    },
  ];

  async execute(params: GitChangedFilesParams): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      // Security: validate path_filter if provided
      if (params.path_filter) {
        try {
          validatePath(params.path_filter, this.workspacePath);
        } catch {
          return { success: false, message: 'Invalid path_filter: path escapes workspace root.' };
        }
      }

      // Sanitise commit SHA — only allow hex chars, HEAD, and branch-safe chars.
      // This prevents shell-injection via the SHA parameter.
      const shaPattern = /^[a-fA-F0-9]{4,40}$|^HEAD$|^[a-zA-Z0-9._/-]{1,100}$/;
      if (!shaPattern.test(params.since_commit)) {
        return { success: false, message: 'Invalid since_commit format.' };
      }
      if (params.until_commit && !shaPattern.test(params.until_commit)) {
        return { success: false, message: 'Invalid until_commit format.' };
      }

      const git = simpleGit(this.workspacePath);

      const until = params.until_commit ?? 'HEAD';
      const range = `${params.since_commit}..${until}`;
      const diffArgs = ['--name-status', range];
      if (params.path_filter) diffArgs.push('--', params.path_filter);

      let diffOutput: string;
      try {
        diffOutput = await git.diff(diffArgs);
      } catch (err) {
        return {
          success: false,
          message: 'git diff failed — ensure the workspace is a git repository and the commit SHAs are valid.',
          error: err instanceof Error ? this.sanitizeWorkspacePathFromMessage(err.message) : 'Unknown error',
        };
      }

      const added: string[] = [];
      const modified: string[] = [];
      const deleted: string[] = [];
      const renamed: Array<{ from: string; to: string }> = [];

      for (const line of diffOutput.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const [status, ...rest] = trimmed.split('\t');
        if (!status || rest.length === 0) continue;
        if (status === 'A') added.push(rest[0]);
        else if (status === 'M') modified.push(rest[0]);
        else if (status === 'D') deleted.push(rest[0]);
        else if (status.startsWith('R') && rest.length === 2) renamed.push({ from: rest[0], to: rest[1] });
      }

      const all_changed = [...added, ...modified, ...renamed.map(r => r.to)];

      const output: GitChangedFilesOutput = { added, modified, deleted, renamed, all_changed };

      return {
        success: true,
        message: `Found ${all_changed.length} changed file(s) since ${params.since_commit}`,
        result: output,
      };
    });
  }
}

// ─── 2. GrepInFilesTool ────────────────────────────────────────────────────────

export interface GrepInFilesParams extends Record<string, unknown> {
  files: string[];
  regex: string;
  output_mode?: 'content' | 'files_with_matches';
  context_lines?: number;
}

export class GrepInFilesTool extends BaseTool<GrepInFilesParams> {
  name = 'grep_in_files';
  category = FilesCategory;
  isConcurrencySafe = true;
  description =
    'Run a regex search across an explicit list of files rather than a whole directory. ' +
    'Use this after git_changed_files to scope searches to only the changed files, ' +
    'avoiding expensive recursive directory walks.';

  getActivityDescription(params: GrepInFilesParams): string {
    return `Grepping ${params.files.length} file(s) for /${params.regex}/`;
  }

  parameters: ToolParameter[] = [
    {
      name: 'files',
      description: 'Explicit list of relative file paths to search within.',
      required: true,
      type: 'array',
    },
    {
      name: 'regex',
      description: 'Regular expression pattern to search for.',
      required: true,
      type: 'string',
    },
    {
      name: 'output_mode',
      description: '"content" returns matching lines with context (default). "files_with_matches" returns only file paths.',
      required: false,
      type: 'string',
    },
    {
      name: 'context_lines',
      description: 'Lines of context around each match (content mode only). Default: 2.',
      required: false,
      type: 'number',
    },
  ];

  async execute(params: GrepInFilesParams): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      if (!Array.isArray(params.files) || params.files.length === 0) {
        return { success: false, message: '`files` must be a non-empty array.' };
      }
      if (params.files.length > 500) {
        return { success: false, message: '`files` array is too large (max 500 paths).' };
      }

      // Security: validate every path
      const validatedPaths: string[] = [];
      for (const f of params.files) {
        if (typeof f !== 'string' || !f.trim()) continue;
        try {
          validatedPaths.push(validatePath(f, this.workspacePath));
        } catch {
          // skip paths that escape workspace
        }
      }

      // Compile regex safely
      let regex: RegExp;
      try {
        regex = new RegExp(params.regex, 'gm');
      } catch (e) {
        return {
          success: false,
          message: `Invalid regex: ${params.regex}`,
          error: e instanceof Error ? e.message : 'Invalid regex',
        };
      }

      const outputMode = params.output_mode === 'files_with_matches' ? 'files_with_matches' : 'content';
      const contextLines = params.context_lines ?? 2;
      const MAX_LINE_CHARS = 500;

      const matchingFiles: string[] = [];
      const contentResults: Array<{ file: string; line: number; content: string; context: string[] }> = [];

      for (const absPath of validatedPaths) {
        let stat;
        try { stat = await fs.stat(absPath); } catch { continue; }
        if (stat.size > MAX_FILE_SIZE) continue;

        let fileContent: string;
        try { fileContent = await fs.readFile(absPath, 'utf-8'); } catch { continue; }

        const relFile = path.relative(this.workspacePath, absPath);
        const freshRegex = new RegExp(regex.source, regex.flags);

        if (outputMode === 'files_with_matches') {
          if (freshRegex.test(fileContent)) matchingFiles.push(relFile);
          continue;
        }

        const lines = fileContent.split('\n');
        const matchRegex = new RegExp(regex.source, regex.flags);
        let match: RegExpExecArray | null;
        while ((match = matchRegex.exec(fileContent)) !== null) {
          const lineNum = fileContent.slice(0, match.index).split('\n').length;
          const start = Math.max(0, lineNum - contextLines - 1);
          const end = Math.min(lines.length, lineNum + contextLines);
          const context = lines.slice(start, end).map(l =>
            l.length > MAX_LINE_CHARS ? l.slice(0, MAX_LINE_CHARS) + '…' : l
          );
          const matchContent = match[0].length > MAX_LINE_CHARS
            ? match[0].slice(0, MAX_LINE_CHARS) + '…'
            : match[0];
          contentResults.push({ file: relFile, line: lineNum, content: matchContent, context });
          if (contentResults.length >= 250) break;
        }
        if (contentResults.length >= 250) break;
      }

      if (outputMode === 'files_with_matches') {
        return {
          success: true,
          message: `Found ${matchingFiles.length} file(s) matching /${params.regex}/`,
          result: matchingFiles,
        };
      }

      return {
        success: true,
        message: `Found ${contentResults.length} match(es) for /${params.regex}/`,
        result: contentResults,
      };
    });
  }
}

// ─── 3. ParsePackageManifestTool ──────────────────────────────────────────────

export interface ParsePackageManifestParams extends Record<string, unknown> {
  path: string;
}

export interface ManifestDependency {
  name: string;
  version: string;
  isDev: boolean;
  isInternal: boolean;
}

export interface ParsedManifest {
  packageManager: 'npm' | 'pip' | 'go' | 'maven' | 'cargo' | 'unknown';
  name: string;
  version?: string;
  dependencies: ManifestDependency[];
  scripts?: Record<string, string>;
  workspaces?: string[];
}

export class ParsePackageManifestTool extends BaseTool<ParsePackageManifestParams> {
  name = 'parse_package_manifest';
  category = FilesCategory;
  isConcurrencySafe = true;
  description =
    'Parse a dependency manifest (package.json, requirements.txt, go.mod, Cargo.toml, pom.xml) ' +
    'and return structured dependency data. Use at the start of service analysis to identify ' +
    'which HTTP/queue/ORM libraries are available before running pattern searches.';

  getActivityDescription(params: ParsePackageManifestParams): string {
    return `Parsing manifest ${params.path}`;
  }

  parameters: ToolParameter[] = [
    {
      name: 'path',
      description: 'Path to the manifest file (e.g. "package.json", "requirements.txt").',
      required: true,
      type: 'string',
    },
  ];

  async execute(params: ParsePackageManifestParams): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      const filePath = validatePath(params.path, this.workspacePath);

      let content: string;
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch (err) {
        return {
          success: false,
          message: `Cannot read manifest at ${params.path}`,
          error: err instanceof Error ? this.sanitizeWorkspacePathFromMessage(err.message) : 'Read error',
        };
      }

      const filename = path.basename(filePath).toLowerCase();
      let result: ParsedManifest;

      try {
        if (filename === 'package.json') {
          result = this.parsePackageJson(content);
        } else if (filename === 'requirements.txt') {
          result = this.parseRequirementsTxt(content);
        } else if (filename === 'go.mod') {
          result = this.parseGoMod(content);
        } else if (filename === 'cargo.toml') {
          result = this.parseCargoToml(content);
        } else if (filename === 'pom.xml') {
          result = this.parsePomXml(content);
        } else {
          return {
            success: false,
            message: `Unsupported manifest type: ${filename}. Supported: package.json, requirements.txt, go.mod, Cargo.toml, pom.xml`,
          };
        }
      } catch (parseErr) {
        return {
          success: false,
          message: `Failed to parse ${filename}`,
          error: parseErr instanceof Error ? parseErr.message : 'Parse error',
        };
      }

      return {
        success: true,
        message: `Parsed ${filename}: ${result.dependencies.length} dependencies (${result.dependencies.filter(d => d.isInternal).length} internal)`,
        result,
      };
    });
  }

  private parsePackageJson(content: string): ParsedManifest {
    const pkg = JSON.parse(content);
    const deps: ManifestDependency[] = [];

    const addDeps = (obj: Record<string, string> | undefined, isDev: boolean) => {
      for (const [name, version] of Object.entries(obj ?? {})) {
        deps.push({
          name,
          version: String(version),
          isDev,
          isInternal: name.startsWith('@') && name.includes('/') &&
            !name.startsWith('@types/') &&
            (pkg.workspaces !== undefined ||
              String(version).startsWith('workspace:') ||
              String(version).startsWith('file:')),
        });
      }
    };

    addDeps(pkg.dependencies, false);
    addDeps(pkg.devDependencies, true);
    addDeps(pkg.peerDependencies, false);

    const scripts: Record<string, string> = {};
    for (const [k, v] of Object.entries(pkg.scripts ?? {})) {
      scripts[k] = String(v);
    }

    return {
      packageManager: 'npm',
      name: pkg.name ?? '',
      version: pkg.version,
      dependencies: deps,
      scripts: Object.keys(scripts).length > 0 ? scripts : undefined,
      workspaces: Array.isArray(pkg.workspaces)
        ? pkg.workspaces
        : Array.isArray(pkg.workspaces?.packages)
          ? pkg.workspaces.packages
          : undefined,
    };
  }

  private parseRequirementsTxt(content: string): ParsedManifest {
    const deps: ManifestDependency[] = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;
      const match = trimmed.match(/^([A-Za-z0-9_.-]+)([>=<!^~].*)?$/);
      if (match) {
        deps.push({ name: match[1], version: match[2]?.trim() ?? '*', isDev: false, isInternal: false });
      }
    }
    return { packageManager: 'pip', name: '', dependencies: deps };
  }

  private parseGoMod(content: string): ParsedManifest {
    const deps: ManifestDependency[] = [];
    let moduleName = '';
    let inRequire = false;
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('module ')) { moduleName = trimmed.replace('module ', '').trim(); continue; }
      if (trimmed === 'require (') { inRequire = true; continue; }
      if (inRequire && trimmed === ')') { inRequire = false; continue; }
      if (inRequire || trimmed.startsWith('require ')) {
        const parts = trimmed.replace(/^require\s+/, '').split(/\s+/);
        if (parts.length >= 2 && !parts[0].startsWith('//')) {
          deps.push({ name: parts[0], version: parts[1], isDev: false, isInternal: false });
        }
      }
    }
    return { packageManager: 'go', name: moduleName, dependencies: deps };
  }

  private parseCargoToml(content: string): ParsedManifest {
    const deps: ManifestDependency[] = [];
    let name = '';
    let version: string | undefined;
    let section = '';
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('[')) { section = trimmed; continue; }
      if (section === '[package]') {
        const nm = trimmed.match(/^name\s*=\s*"([^"]+)"/); if (nm) { name = nm[1]; continue; }
        const vm = trimmed.match(/^version\s*=\s*"([^"]+)"/); if (vm) { version = vm[1]; continue; }
      }
      if (section === '[dependencies]' || section === '[dev-dependencies]') {
        const isDev = section === '[dev-dependencies]';
        const m = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]+)"|.*version\s*=\s*"([^"]+)")/);
        if (m) deps.push({ name: m[1], version: m[2] ?? m[3] ?? '*', isDev, isInternal: false });
      }
    }
    return { packageManager: 'cargo', name, version, dependencies: deps };
  }

  private parsePomXml(content: string): ParsedManifest {
    const deps: ManifestDependency[] = [];
    const depRegex = /<dependency>[\s\S]*?<groupId>(.*?)<\/groupId>[\s\S]*?<artifactId>(.*?)<\/artifactId>[\s\S]*?(?:<version>(.*?)<\/version>)?[\s\S]*?(?:<scope>(.*?)<\/scope>)?[\s\S]*?<\/dependency>/g;
    let match: RegExpExecArray | null;
    while ((match = depRegex.exec(content)) !== null) {
      const scope = match[4]?.trim() ?? 'compile';
      deps.push({
        name: `${match[1].trim()}:${match[2].trim()}`,
        version: match[3]?.trim() ?? '*',
        isDev: scope === 'test',
        isInternal: false,
      });
    }
    const nameMatch = content.match(/<artifactId>(.*?)<\/artifactId>/);
    const versionMatch = content.match(/<version>(.*?)<\/version>/);
    return {
      packageManager: 'maven',
      name: nameMatch?.[1] ?? '',
      version: versionMatch?.[1],
      dependencies: deps,
    };
  }
}

// ─── 4. ReadSchemaFileTool ─────────────────────────────────────────────────────

export interface ReadSchemaFileParams extends Record<string, unknown> {
  path: string;
  technology?: string;
}

export interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  isIdentity: boolean;
  isForeignKey: boolean;
  references?: string;
}

export interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
}

export interface ParsedSchema {
  technology: string;
  tables: SchemaTable[];
  raw_excerpt?: string;
}

export class ReadSchemaFileTool extends BaseTool<ReadSchemaFileParams> {
  name = 'read_schema_file';
  category = FilesCategory;
  isConcurrencySafe = true;
  description =
    'Parse a schema/ORM definition file and return a structured table/column representation. ' +
    'Supports Prisma (schema.prisma), TypeORM (@Entity files), Mongoose schemas, SQL migration ' +
    'files, JSON Schema, and Protobuf. Returns structured tables+columns the agent can reason ' +
    'about without reading raw text.';

  getActivityDescription(params: ReadSchemaFileParams): string {
    return `Reading schema ${params.path}`;
  }

  parameters: ToolParameter[] = [
    {
      name: 'path',
      description: 'Path to the schema file (e.g. "prisma/schema.prisma", "migrations/001.sql").',
      required: true,
      type: 'string',
    },
    {
      name: 'technology',
      description: 'Optional hint: "prisma" | "typeorm" | "mongoose" | "sql" | "json-schema" | "proto".',
      required: false,
      type: 'string',
    },
  ];

  async execute(params: ReadSchemaFileParams): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      const filePath = validatePath(params.path, this.workspacePath);

      let content: string;
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch (err) {
        return {
          success: false,
          message: `Cannot read schema at ${params.path}`,
          error: err instanceof Error ? this.sanitizeWorkspacePathFromMessage(err.message) : 'Read error',
        };
      }

      const ext = path.extname(filePath).toLowerCase();
      const filename = path.basename(filePath).toLowerCase();
      const hint = params.technology?.toLowerCase();

      let parsed: ParsedSchema | null = null;

      try {
        if (hint === 'prisma' || filename === 'schema.prisma' || ext === '.prisma') {
          parsed = this.parsePrisma(content);
        } else if (hint === 'sql' || ext === '.sql') {
          parsed = this.parseSql(content);
        } else if (hint === 'json-schema' || ext === '.json') {
          parsed = this.parseJsonSchema(content);
        } else if (hint === 'proto' || ext === '.proto') {
          parsed = this.parseProto(content);
        } else if (hint === 'typeorm' || ext === '.ts') {
          parsed = this.parseTypeOrm(content);
        } else if (hint === 'mongoose') {
          parsed = this.parseMongoose(content);
        } else {
          // Auto-detect
          if (content.includes('model ') && content.includes('@id')) {
            parsed = this.parsePrisma(content);
          } else if (/CREATE\s+TABLE/i.test(content)) {
            parsed = this.parseSql(content);
          } else if (content.includes('@Entity')) {
            parsed = this.parseTypeOrm(content);
          } else if (content.includes('new Schema(')) {
            parsed = this.parseMongoose(content);
          } else {
            parsed = { technology: 'unknown', tables: [] };
          }
        }
      } catch {
        // Parsing failed — return raw excerpt as fallback
        const lines = content.split('\n');
        return {
          success: true,
          message: `Could not parse schema structurally; returning raw excerpt.`,
          result: {
            technology: hint ?? 'unknown',
            tables: [],
            raw_excerpt: lines.slice(0, 200).join('\n'),
          } as ParsedSchema,
        };
      }

      return {
        success: true,
        message: `Parsed schema: ${parsed.tables.length} table(s) found.`,
        result: parsed,
      };
    });
  }

  private parsePrisma(content: string): ParsedSchema {
    const tables: SchemaTable[] = [];
    const modelRegex = /^model\s+(\w+)\s*\{([^}]+)\}/gm;
    let modelMatch: RegExpExecArray | null;
    while ((modelMatch = modelRegex.exec(content)) !== null) {
      const name = modelMatch[1];
      const body = modelMatch[2];
      const columns: SchemaColumn[] = [];
      for (const line of body.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@') || trimmed.startsWith('@@')) continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length < 2) continue;
        const [colName, colType] = parts;
        const nullable = colType.endsWith('?');
        const isIdentity = trimmed.includes('@id');
        const isForeignKey = trimmed.includes('@relation');
        const refMatch = trimmed.match(/references:\s*\[(\w+)\]/);
        columns.push({
          name: colName,
          type: colType.replace('?', ''),
          nullable,
          isIdentity,
          isForeignKey,
          references: isForeignKey && refMatch ? refMatch[1] : undefined,
        });
      }
      tables.push({ name, columns });
    }
    return { technology: 'prisma', tables };
  }

  private parseSql(content: string): ParsedSchema {
    const tables: SchemaTable[] = [];
    const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)[`"']?\s*\(([^;]+)\)/gi;
    let match: RegExpExecArray | null;
    while ((match = createTableRegex.exec(content)) !== null) {
      const name = match[1];
      const body = match[2];
      const columns: SchemaColumn[] = [];
      for (const line of body.split('\n')) {
        const trimmed = line.trim().replace(/,$/, '');
        if (!trimmed || /^(PRIMARY|UNIQUE|INDEX|KEY|CONSTRAINT|CHECK|FOREIGN)/i.test(trimmed)) continue;
        const colMatch = trimmed.match(/^[`"']?(\w+)[`"']?\s+([A-Za-z]+(?:\(\d+(?:,\d+)?\))?)/);
        if (!colMatch) continue;
        const nullable = !/NOT\s+NULL/i.test(trimmed);
        const isIdentity = /AUTO_INCREMENT|SERIAL|IDENTITY/i.test(trimmed) || /PRIMARY\s+KEY/i.test(trimmed);
        const fkMatch = trimmed.match(/REFERENCES\s+[`"']?(\w+)[`"']?\s*\([`"']?(\w+)[`"']?\)/i);
        columns.push({
          name: colMatch[1],
          type: colMatch[2].toUpperCase(),
          nullable,
          isIdentity,
          isForeignKey: !!fkMatch,
          references: fkMatch ? `${fkMatch[1]}.${fkMatch[2]}` : undefined,
        });
      }
      tables.push({ name, columns });
    }
    return { technology: 'sql', tables };
  }

  private parseJsonSchema(content: string): ParsedSchema {
    const schema = JSON.parse(content);
    const tables: SchemaTable[] = [];
    const defs = schema.$defs ?? schema.definitions ?? {};
    for (const [name, def] of Object.entries(defs as Record<string, any>)) {
      if (def.type !== 'object' || !def.properties) continue;
      const required: string[] = def.required ?? [];
      const columns: SchemaColumn[] = Object.entries(def.properties as Record<string, any>).map(([colName, colDef]) => ({
        name: colName,
        type: (colDef as any).type ?? 'unknown',
        nullable: !required.includes(colName),
        isIdentity: colName === 'id' || colName === '_id',
        isForeignKey: colName.endsWith('_id') || colName.endsWith('Id'),
      }));
      tables.push({ name, columns });
    }
    return { technology: 'json-schema', tables };
  }

  private parseProto(content: string): ParsedSchema {
    const tables: SchemaTable[] = [];
    const messageRegex = /message\s+(\w+)\s*\{([^}]+)\}/g;
    let match: RegExpExecArray | null;
    while ((match = messageRegex.exec(content)) !== null) {
      const columns: SchemaColumn[] = [];
      for (const line of match[2].split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//')) continue;
        const fieldMatch = trimmed.match(/(?:repeated\s+)?(\w+)\s+(\w+)\s*=/);
        if (fieldMatch) {
          columns.push({
            name: fieldMatch[2],
            type: fieldMatch[1],
            nullable: false,
            isIdentity: fieldMatch[2] === 'id',
            isForeignKey: false,
          });
        }
      }
      tables.push({ name: match[1], columns });
    }
    return { technology: 'proto', tables };
  }

  private parseTypeOrm(content: string): ParsedSchema {
    const tables: SchemaTable[] = [];
    const entityRegex = /@Entity[^)]*\)\s*(?:export\s+)?class\s+(\w+)/g;
    const allEntities: string[] = [];
    let em: RegExpExecArray | null;
    while ((em = entityRegex.exec(content)) !== null) allEntities.push(em[1]);

    for (const entityName of allEntities) {
      const columns: SchemaColumn[] = [];
      const columnRegex = /@(PrimaryGeneratedColumn|PrimaryColumn|Column|ManyToOne|OneToMany|OneToOne)[^)]*\)[^@\n]*\n\s+(\w+)[\?!]?\s*:\s*(\w+)/g;
      let cm: RegExpExecArray | null;
      while ((cm = columnRegex.exec(content)) !== null) {
        const decorator = cm[1];
        columns.push({
          name: cm[2],
          type: cm[3],
          nullable: false,
          isIdentity: decorator.includes('PrimaryGenerated') || decorator.includes('PrimaryColumn'),
          isForeignKey: decorator.includes('ManyToOne') || decorator.includes('OneToOne'),
        });
      }
      tables.push({ name: entityName, columns });
    }
    return { technology: 'typeorm', tables };
  }

  private parseMongoose(content: string): ParsedSchema {
    const tables: SchemaTable[] = [];
    const schemaRegex = /(?:const\s+(\w+)Schema\s*=\s*)?new\s+Schema\s*\(\s*\{([^}]+)\}/g;
    let match: RegExpExecArray | null;
    while ((match = schemaRegex.exec(content)) !== null) {
      const schemaName = match[1] ?? 'Unknown';
      const body = match[2];
      const columns: SchemaColumn[] = [];
      for (const line of body.split('\n')) {
        const trimmed = line.trim().replace(/,$/, '');
        const fieldMatch = trimmed.match(/^(\w+)\s*:/);
        if (!fieldMatch) continue;
        const typeMatch = trimmed.match(/type\s*:\s*(\w+)/);
        const required = /required\s*:\s*true/.test(trimmed);
        columns.push({
          name: fieldMatch[1],
          type: typeMatch?.[1] ?? 'Mixed',
          nullable: !required,
          isIdentity: fieldMatch[1] === '_id',
          isForeignKey: /ObjectId|Ref/.test(trimmed),
        });
      }
      tables.push({ name: schemaName, columns });
    }
    return { technology: 'mongoose', tables };
  }
}

// ─── 5. ResolveEnvVariableTool ────────────────────────────────────────────────

export interface ResolveEnvVariableParams extends Record<string, unknown> {
  variable_name: string;
  service_path: string;
}

export interface EnvVariableSource {
  file: string;
  line: number;
  value_hint: string;
  source_type: 'dotenv' | 'docker-compose' | 'helm-values' | 'k8s-configmap' | 'ci-yaml' | 'default-in-code';
}

export interface ResolvedEnvVariable {
  found: boolean;
  sources: EnvVariableSource[];
  resolved_value?: string;
  is_secret: boolean;
}

export class ResolveEnvVariableTool extends BaseTool<ResolveEnvVariableParams> {
  name = 'resolve_env_variable';
  category = FilesCategory;
  isConcurrencySafe = true;
  description =
    'Given an environment variable name, find all places it is defined across .env files, ' +
    'docker-compose.yml, Helm values, k8s ConfigMaps, and CI YAMLs. Returns the value hint ' +
    '(never a raw secret — secrets are masked as "***"). Use before marking an HTTP base URL ' +
    'or queue name as "unresolved".';

  getActivityDescription(params: ResolveEnvVariableParams): string {
    return `Resolving env var ${params.variable_name}`;
  }

  parameters: ToolParameter[] = [
    {
      name: 'variable_name',
      description: 'The env variable name to look up (e.g. "PAYMENT_SERVICE_URL").',
      required: true,
      type: 'string',
    },
    {
      name: 'service_path',
      description: 'Root directory to search in (defaults to workspace root if ".").',
      required: true,
      type: 'string',
    },
  ];

  async execute(params: ResolveEnvVariableParams): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      // Security: validate variable name — only allow safe identifier characters
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(params.variable_name)) {
        return { success: false, message: 'Invalid variable_name: must be a valid env var identifier (A-Z, 0-9, _).' };
      }

      const searchRoot = validatePath(params.service_path, this.workspacePath);

      const sources: EnvVariableSource[] = [];
      const varName = params.variable_name;

      // Collect candidate config files
      const candidateFiles = await this.collectConfigFiles(searchRoot);

      for (const absFilePath of candidateFiles) {
        let content: string;
        try { content = await fs.readFile(absFilePath, 'utf-8'); } catch { continue; }

        const relFile = path.relative(this.workspacePath, absFilePath);
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line.includes(varName)) continue;

          const valueHint = this.extractValueHint(line, varName);
          if (valueHint === null) continue;

          // Security: redact secrets
          const masked = looksLikeSecret(valueHint) ? '***' : valueHint;

          sources.push({
            file: relFile,
            line: i + 1,
            value_hint: masked,
            source_type: this.classifySourceType(relFile),
          });
        }
      }

      if (sources.length === 0) {
        return {
          success: true,
          message: `Environment variable "${varName}" not found in any config files.`,
          result: { found: false, sources: [], is_secret: false } as ResolvedEnvVariable,
        };
      }

      // Pick the best resolved_value: first non-secret, non-empty, non-placeholder value
      const best = sources.find(s =>
        s.value_hint !== '***' &&
        s.value_hint !== '' &&
        !s.value_hint.startsWith('${') &&
        !s.value_hint.startsWith('$(')
      );

      const isSecret = sources.some(s => s.value_hint === '***');

      const result: ResolvedEnvVariable = {
        found: true,
        sources,
        resolved_value: best?.value_hint,
        is_secret: isSecret,
      };

      return {
        success: true,
        message: `Found "${varName}" in ${sources.length} source(s).`,
        result,
      };
    });
  }

  private async collectConfigFiles(searchRoot: string): Promise<string[]> {
    const result: string[] = [];
    const configPatterns = /^(\.env[\w.-]*|docker-compose[\w.-]*\.ya?ml|values[\w.-]*\.ya?ml|.*configmap[\w.-]*\.ya?ml|.*\.github[\\/].*\.ya?ml|gitlab-ci[\w.-]*\.ya?ml)$/i;

    async function walk(dir: string): Promise<void> {
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!SEARCH_EXCLUDED_DIRS.has(entry.name)) await walk(path.join(dir, entry.name));
        } else if (entry.isFile() && configPatterns.test(entry.name)) {
          result.push(path.join(dir, entry.name));
        }
      }
    }

    await walk(searchRoot);
    return result;
  }

  private extractValueHint(line: string, varName: string): string | null {
    // dotenv style: VAR_NAME=value or VAR_NAME="value"
    const dotenvMatch = line.match(new RegExp(`^\\s*${varName}\\s*=\\s*(.*)$`));
    if (dotenvMatch) return dotenvMatch[1].trim().replace(/^['"]|['"]$/g, '');

    // YAML style: VAR_NAME: value or - VAR_NAME=value
    const yamlMatch = line.match(new RegExp(`${varName}[:\\s=]+(.+)$`));
    if (yamlMatch) return yamlMatch[1].trim().replace(/^['"]|['"]$/g, '');

    return null;
  }

  private classifySourceType(relFile: string): EnvVariableSource['source_type'] {
    const lower = relFile.toLowerCase();
    if (lower.includes('.env')) return 'dotenv';
    if (lower.includes('docker-compose')) return 'docker-compose';
    if (lower.includes('values')) return 'helm-values';
    if (lower.includes('configmap')) return 'k8s-configmap';
    if (lower.includes('.github') || lower.includes('gitlab-ci')) return 'ci-yaml';
    return 'default-in-code';
  }
}

// ─── 6. ExtractTypeDefinitionTool ─────────────────────────────────────────────

export interface ExtractTypeDefinitionParams extends Record<string, unknown> {
  type_name: string;
  start_file: string;
  service_path: string;
}

export interface TypeField {
  name: string;
  type: string;
  optional: boolean;
}

export interface ExtractedTypeDefinition {
  found: boolean;
  definition_file: string;
  line_range: [number, number];
  definition_text: string;
  fields?: TypeField[];
}

export class ExtractTypeDefinitionTool extends BaseTool<ExtractTypeDefinitionParams> {
  name = 'extract_type_definition';
  category = FilesCategory;
  isConcurrencySafe = true;
  description =
    'Find the full TypeScript interface or type alias definition for a given type name, ' +
    'following imports from the start file if needed. Returns the definition text and ' +
    'parsed field list. Use when you find a typed queue payload or HTTP response schema ' +
    'and need to know its fields.';

  getActivityDescription(params: ExtractTypeDefinitionParams): string {
    return `Extracting type definition for ${params.type_name}`;
  }

  parameters: ToolParameter[] = [
    {
      name: 'type_name',
      description: 'TypeScript type or interface name to find (e.g. "PaymentJobPayload").',
      required: true,
      type: 'string',
    },
    {
      name: 'start_file',
      description: 'File where the type was referenced (import resolution starts here).',
      required: true,
      type: 'string',
    },
    {
      name: 'service_path',
      description: 'Service root directory — fallback search scope if import resolution fails.',
      required: true,
      type: 'string',
    },
  ];

  async execute(params: ExtractTypeDefinitionParams): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      // Security: type names must be safe identifiers
      if (!/^[A-Za-z_$][A-Za-z0-9_$]{0,199}$/.test(params.type_name)) {
        return { success: false, message: 'Invalid type_name: must be a valid TypeScript identifier.' };
      }

      const startFilePath = validatePath(params.start_file, this.workspacePath);
      const serviceRoot = validatePath(params.service_path, this.workspacePath);
      const typeName = params.type_name;

      // Step 1: check if the type is imported in start_file → follow import
      const resolvedFile = await this.followImport(typeName, startFilePath, serviceRoot);

      // Step 2: if we have a resolved file, search there; otherwise fall back to service-wide grep
      const searchFiles = resolvedFile ? [resolvedFile] : await this.grepForType(typeName, serviceRoot);

      for (const absFilePath of searchFiles) {
        const result = await this.findTypeInFile(typeName, absFilePath);
        if (result) {
          return {
            success: true,
            message: `Found type "${typeName}" in ${path.relative(this.workspacePath, absFilePath)}`,
            result,
          };
        }
      }

      return {
        success: true,
        message: `Type "${typeName}" not found.`,
        result: { found: false, definition_file: '', line_range: [0, 0], definition_text: '' } as ExtractedTypeDefinition,
      };
    });
  }

  private async followImport(typeName: string, startFilePath: string, serviceRoot: string): Promise<string | null> {
    let startContent: string;
    try { startContent = await fs.readFile(startFilePath, 'utf-8'); } catch { return null; }

    // Look for: import { ..., TypeName, ... } from '...'
    const importRegex = new RegExp(`import\\s*\\{[^}]*\\b${typeName}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`);
    const match = importRegex.exec(startContent);
    if (!match) return null;

    const importPath = match[1];
    // Resolve relative imports
    if (importPath.startsWith('.')) {
      const base = path.dirname(startFilePath);
      const candidates = [
        path.resolve(base, importPath + '.ts'),
        path.resolve(base, importPath + '/index.ts'),
        path.resolve(base, importPath),
      ];
      for (const c of candidates) {
        try {
          await fs.stat(c);
          // Security: ensure resolved path stays within workspace
          if (c.startsWith(serviceRoot) || c.startsWith(this.workspacePath)) return c;
        } catch { /* not found */ }
      }
    }
    return null;
  }

  private async grepForType(typeName: string, serviceRoot: string): Promise<string[]> {
    const pattern = new RegExp(`(?:interface|type)\\s+${typeName}\\b`, 'gm');
    const results = await searchFilesRecursive(
      serviceRoot, pattern, '*.ts', 0, this.workspacePath,
      { outputMode: 'files_with_matches', headLimit: 5 }
    );
    return results.map(r => path.resolve(this.workspacePath, r.file));
  }

  private async findTypeInFile(typeName: string, absFilePath: string): Promise<ExtractedTypeDefinition | null> {
    let content: string;
    try { content = await fs.readFile(absFilePath, 'utf-8'); } catch { return null; }

    const lines = content.split('\n');
    const startPattern = new RegExp(`^(?:export\\s+)?(?:interface|type)\\s+${typeName}\\b`);

    for (let i = 0; i < lines.length; i++) {
      if (!startPattern.test(lines[i])) continue;

      // Find the end of the definition (matching braces or semicolon for type aliases)
      let depth = 0;
      let endLine = i;
      let found = false;
      for (let j = i; j < Math.min(i + 100, lines.length); j++) {
        for (const ch of lines[j]) {
          if (ch === '{') depth++;
          else if (ch === '}') { depth--; if (depth === 0) { endLine = j; found = true; break; } }
        }
        if (found) break;
        // type alias without braces (e.g. `type Foo = string | number;`)
        if (j === i && !lines[j].includes('{') && lines[j].includes(';')) { endLine = i; break; }
      }

      const definitionText = lines.slice(i, endLine + 1).join('\n').slice(0, 4000);
      const fields = this.parseFields(definitionText);
      const relFile = path.relative(this.workspacePath, absFilePath);

      return {
        found: true,
        definition_file: relFile,
        line_range: [i + 1, endLine + 1],
        definition_text: definitionText,
        fields,
      };
    }
    return null;
  }

  private parseFields(text: string): TypeField[] {
    const fields: TypeField[] = [];
    // Match lines like:   fieldName?: string;  or  fieldName: string | null;
    const fieldRegex = /^\s{0,4}(\w+)(\?)?\s*:\s*([^;\n,}]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = fieldRegex.exec(text)) !== null) {
      // Skip the type/interface declaration line itself
      if (match[1] === 'interface' || match[1] === 'type' || match[1] === 'export') continue;
      fields.push({
        name: match[1],
        type: match[3].trim(),
        optional: match[2] === '?',
      });
    }
    return fields;
  }
}

// ─── 7. FindUsagesOfSymbolTool ────────────────────────────────────────────────

export interface FindUsagesOfSymbolParams extends Record<string, unknown> {
  symbol_name: string;
  service_path: string;
  usage_kind?: 'call' | 'import' | 'any';
}

export interface SymbolUsage {
  file: string;
  line: number;
  context: string;
  kind: 'call' | 'import' | 'instantiation' | 'assignment';
}

export interface FindUsagesResult {
  usages: SymbolUsage[];
  total_found: number;
}

export class FindUsagesOfSymbolTool extends BaseTool<FindUsagesOfSymbolParams> {
  name = 'find_usages_of_symbol';
  category = FilesCategory;
  isConcurrencySafe = true;
  description =
    'Find all call sites, imports, or instantiations of a specific function, class, ' +
    'or variable within a service directory. Use this to verify that an exported symbol ' +
    'is called at runtime (not only type-imported) and to capture all queue produce call sites.';

  getActivityDescription(params: FindUsagesOfSymbolParams): string {
    return `Finding usages of ${params.symbol_name}`;
  }

  parameters: ToolParameter[] = [
    {
      name: 'symbol_name',
      description: 'Function, class, or variable name to search for (e.g. "sendPaymentEvent").',
      required: true,
      type: 'string',
    },
    {
      name: 'service_path',
      description: 'Directory scope for the search.',
      required: true,
      type: 'string',
    },
    {
      name: 'usage_kind',
      description: 'Filter: "call" (only function calls), "import" (only imports), "any" (all). Default: "any".',
      required: false,
      type: 'string',
    },
  ];

  async execute(params: FindUsagesOfSymbolParams): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      // Security: symbol name must be a valid identifier
      if (!/^[A-Za-z_$][A-Za-z0-9_$.]{0,199}$/.test(params.symbol_name)) {
        return { success: false, message: 'Invalid symbol_name: must be a valid identifier.' };
      }

      const serviceRoot = validatePath(params.service_path, this.workspacePath);
      const symbolName = params.symbol_name;
      const usageKindFilter = params.usage_kind ?? 'any';

      // Escape the symbol name for use in a regex
      const escapedSymbol = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(`\\b${escapedSymbol}\\b`, 'gm');

      const rawResults = await searchFilesRecursive(
        serviceRoot, searchRegex, '*.ts', 2, this.workspacePath,
        { outputMode: 'content', contextLines: 2, headLimit: 200 }
      );

      const usages: SymbolUsage[] = [];

      for (const r of rawResults) {
        const kind = this.classifyUsage(r.content, r.context);
        if (usageKindFilter === 'call' && kind !== 'call') continue;
        if (usageKindFilter === 'import' && kind !== 'import') continue;
        usages.push({
          file: r.file,
          line: r.line,
          context: r.context.join('\n'),
          kind,
        });
      }

      return {
        success: true,
        message: `Found ${usages.length} usage(s) of "${symbolName}".`,
        result: { usages, total_found: usages.length } as FindUsagesResult,
      };
    });
  }

  private classifyUsage(matchLine: string, context: string[]): SymbolUsage['kind'] {
    const fullContext = context.join('\n') + '\n' + matchLine;
    if (/^\s*import\b/.test(matchLine) || /import\s*\{[^}]*\}/.test(matchLine)) return 'import';
    if (/\bnew\s+/.test(fullContext.slice(Math.max(0, fullContext.lastIndexOf(matchLine) - 10)))) return 'instantiation';
    if (/\w+\s*\(/.test(matchLine)) return 'call';
    return 'assignment';
  }
}
