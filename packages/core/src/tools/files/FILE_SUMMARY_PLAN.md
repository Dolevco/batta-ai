# File Summary Tool — Implementation Plan

## Goal

Add a `preview_file` tool that returns a structural skeleton of a file — symbol names, their
line numbers, and cheap metadata — without loading the full content into context. This enables
the agent to route across many files cheaply and decide which ones warrant a full `read_file`.

---

## Why This Matters

The leverage is in **routing, not just compression**.

| Scenario | Tokens (approx.) |
|---|---|
| Read 20 files in full to find the right one | ~15,000 |
| Preview 20 files → read 3 in full | ~500 + ~2,000 = **2,500** |

A single `preview_file` call on a 300-line TypeScript file costs ~40 tokens and tells the agent
whether `generateToken` lives there. Reading the file in full costs ~900 tokens.

---

## Output Format

```
file: src/auth/token.ts
type: typescript
total_lines: 312
last_modified: 2025-04-01
items:
  L12   import      jwt, bcrypt
  L34   function    generateToken
  L67   function    validateToken
  L89   class       TokenCache
  L201  function    revokeToken
```

Each item has: `line` (1-based), `kind` (import, class, function, method, interface, type,
variable, heading, key, selector, …), and `name`.

---

## What to Extract Per Language

| File type | Extensions | Items extracted |
|---|---|---|
| TypeScript / JavaScript | `.ts`, `.tsx`, `.js`, `.jsx` | imports (module names), classes, functions, methods, interfaces, type aliases, enums, exported variables |
| Python | `.py` | imports, classes, functions, decorated functions |
| Go | `.go` | package, imports, structs, interfaces, functions, methods |
| Markdown | `.md`, `.mdx` | h1–h4 headings |
| JSON | `.json` | top-level keys + value type hint (`string`, `number`, `array[N]`, `object`) |
| YAML | `.yml`, `.yaml` | top-level and second-level keys |
| TOML / INI / ENV | `.toml`, `.ini`, `.env` | all keys |
| SQL | `.sql` | `CREATE TABLE`, `CREATE VIEW`, `CREATE FUNCTION`, `CREATE PROCEDURE` names |
| CSS / SCSS | `.css`, `.scss`, `.sass` | selectors, mixin names, CSS variable names |
| Generic (fallback) | everything else | returns only file metadata, no items |

---

## Architecture

### Factory pattern

Each language gets its own `FileSummarizer` class. A `FileSummarizerFactory` selects the right
one by file extension. Adding support for a new language means adding one class and registering
it in the factory — no changes to the tool itself.

```
packages/core/src/tools/files/
├── fileTools.ts               (existing — add PreviewFileTool here)
├── types.ts                   (existing — add PreviewFileParams + output types)
├── index.ts                   (existing — register new tool in factory functions)
├── fs.ts                      (existing — untouched)
└── summarizers/
    ├── index.ts               (FileSummarizerFactory + FileSummarizer interface)
    ├── typescriptSummarizer.ts
    ├── pythonSummarizer.ts
    ├── goSummarizer.ts
    ├── markdownSummarizer.ts
    ├── jsonSummarizer.ts
    ├── yamlSummarizer.ts
    ├── sqlSummarizer.ts
    ├── cssSummarizer.ts
    ├── envSummarizer.ts       (covers .toml, .ini, .env)
    └── genericSummarizer.ts   (fallback, metadata only)
```

### Core interfaces (goes in `summarizers/index.ts`)

```typescript
export interface SummaryItem {
  line: number;       // 1-based line number where this symbol starts
  kind: string;       // 'import' | 'class' | 'function' | 'method' | 'interface'
                      // | 'type' | 'enum' | 'variable' | 'heading' | 'key'
                      // | 'selector' | 'mixin' | 'table' | 'view' | 'package' | ...
  name: string;       // symbol / heading / key name
}

export interface FileSummary {
  file: string;            // relative path (sanitised from workspacePath)
  type: string;            // human label, e.g. "typescript", "python"
  total_lines: number;
  last_modified: string;   // ISO date, no time (privacy-safe)
  items: SummaryItem[];
}

export interface FileSummarizer {
  /** File extensions this summarizer handles, e.g. ['.ts', '.tsx'] */
  readonly extensions: string[];
  /** Language label used in the output */
  readonly languageLabel: string;
  /** Parse content line-by-line and return structural items */
  summarize(content: string): SummaryItem[];
}
```

### FileSummarizerFactory (`summarizers/index.ts`)

```typescript
export class FileSummarizerFactory {
  private static readonly summarizers: FileSummarizer[] = [
    new TypeScriptSummarizer(),
    new PythonSummarizer(),
    new GoSummarizer(),
    new MarkdownSummarizer(),
    new JsonSummarizer(),
    new YamlSummarizer(),
    new SqlSummarizer(),
    new CssSummarizer(),
    new EnvSummarizer(),
    // GenericSummarizer is the fallback — not in the list
  ];

  static get(ext: string): FileSummarizer {
    return (
      this.summarizers.find(s => s.extensions.includes(ext.toLowerCase())) ??
      new GenericSummarizer()
    );
  }
}
```

---

## Implementation Details Per Summarizer

All summarizers work **line-by-line** (split on `\n`, iterate with index). No AST parsers —
regex is sufficient for structural extraction, avoids heavy dependencies, and keeps startup fast.

### TypeScriptSummarizer

Patterns to detect (applied per line):

| Kind | Regex |
|---|---|
| `import` | `/^import\s+.*\s+from\s+['"](.+)['"]/` → name = module path |
| `class` | `/(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/` |
| `interface` | `/(?:export\s+)?interface\s+(\w+)/` |
| `type` | `/(?:export\s+)?type\s+(\w+)\s*=/` |
| `enum` | `/(?:export\s+)?enum\s+(\w+)/` |
| `function` | `/(?:export\s+)?(?:async\s+)?function\s+(\w+)/` |
| `method` | `/^\s{2,}(?:public\|private\|protected\|async\|static\|override)*\s*(\w+)\s*\(/` (indented, inside a class) |
| `variable` | `/(?:export\s+)?const\s+(\w+)\s*[=:]/ ` (only top-level, indentation == 0) |
| `arrow fn` | `/(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(.*\)\s*=>/ ` |

**Class-context tracking**: set a flag when a `class` line is detected; clear it when indentation
returns to 0. Lines matching the `method` pattern inside class context are tagged as `method`.

### PythonSummarizer

| Kind | Regex |
|---|---|
| `import` | `/^(?:import\|from)\s+(\S+)/ ` |
| `class` | `/^class\s+(\w+)/` |
| `function` | `/^def\s+(\w+)/` |
| `method` | `/^\s{4,}def\s+(\w+)/` (indented) |
| `decorator` | `/^@(\w+)/` → capture and attach to next `def`/`class` name |

### GoSummarizer

| Kind | Regex |
|---|---|
| `package` | `/^package\s+(\w+)/` |
| `import` | Block between `import (` and `)` |
| `struct` | `/^type\s+(\w+)\s+struct/` |
| `interface` | `/^type\s+(\w+)\s+interface/` |
| `function` | `/^func\s+(\w+)/` |
| `method` | `/^func\s+\(\w+\s+\*?\w+\)\s+(\w+)/` |

### MarkdownSummarizer

Match `/^(#{1,4})\s+(.+)/`. Kind = `h1`/`h2`/`h3`/`h4`, name = heading text.

### JsonSummarizer

Parse with `JSON.parse` (safe on small files), then iterate top-level keys. Value hint:
- Array → `array[N]` (N = length)
- Object → `object`
- Otherwise → typeof value

Do not recurse below top level to keep output compact.

### YamlSummarizer

No YAML parser dependency. Detect lines matching `/^(\w[\w-]*):\s*/` (indent 0) as top-level
keys, and `/^  (\w[\w-]*):\s*/` (indent 2) as second-level keys.

### SqlSummarizer

Match `/^CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|FUNCTION|PROCEDURE)\s+(?:\w+\.)?(\w+)/i`.

### CssSummarizer

- Selectors: lines ending in `{` that are not inside a `@` block
- Mixins (SCSS): `/^@mixin\s+(\w+)/`
- CSS variables: `/^--[\w-]+/` inside `:root` blocks

### EnvSummarizer (covers `.env`, `.ini`, `.toml`)

Match `/^([A-Z_][A-Z0-9_]*)\s*[=:]/` per line. Name = key. **Do not extract values** — values
are often secrets.

---

## PreviewFileTool (in `fileTools.ts`)

```typescript
export class PreviewFileTool extends BaseTool<PreviewFileParams> {
  name = 'preview_file';
  category = FilesCategory;
  description =
    'Returns a structural skeleton of a file — symbol names, line numbers, and metadata — ' +
    'without loading full content. Use this before read_file when you need to locate a specific ' +
    'function or assess whether a file is relevant. Best for files over ~80 lines; for shorter ' +
    'files just use read_file.';
  isConcurrencySafe = true;

  parameters: ToolParameter[] = [
    {
      name: 'path',
      description: 'File path to preview',
      required: true,
      type: 'string'
    }
  ];

  async execute(params: PreviewFileParams): Promise<ToolResult> {
    return this.wrapExecution(params, async () => {
      const filePath = validatePath(params.path, this.workspacePath);
      const content = await fs.readFile(filePath, 'utf-8');
      const stat = await fs.stat(filePath);

      const ext = path.extname(filePath);
      const summarizer = FileSummarizerFactory.get(ext);
      const items = summarizer.summarize(content);
      const lines = content.split('\n');

      const summary: FileSummary = {
        file: getRelativePath(filePath, this.workspacePath),
        type: summarizer.languageLabel,
        total_lines: lines.length,
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
```

### New params type (in `files/types.ts`)

```typescript
export type PreviewFileParams = {
  path: string;
};
```

---

## Registration

In [files/index.ts](files/index.ts):

```typescript
import { PreviewFileTool, /* existing imports */ } from "./fileTools";

export const createFileTools = (config: ToolConfig) => {
  return [
    new PreviewFileTool(config),   // add here
    new ReadFileTool(config),
    // ... rest unchanged
  ];
};

export const createReadOnlyFileTools = (config: ToolConfig) => {
  return [
    new PreviewFileTool(config),   // add here
    new ReadFileTool(config),
    new SearchFilesTool(config),
    new ListFilesTool(config),
  ];
};
```

---

## When the Tool Should (and Should Not) Be Used

The description on the tool itself communicates this to the agent, but for completeness:

**Use `preview_file` when:**
- File is over ~80 lines
- You need to locate a specific function, class, or section before reading
- Exploring many files to find which ones are relevant (route before reading)
- Doing a first-pass on an unfamiliar codebase

**Use `read_file` directly when:**
- File is short (~50 lines or fewer)
- You already know the exact line range you need
- You need the full content anyway (e.g., a config file you will rewrite)

---

## Implementation Order

1. Create `packages/core/src/tools/files/summarizers/index.ts` — interfaces + factory
2. Implement `genericSummarizer.ts` (empty items, just metadata — needed as fallback)
3. Implement `typescriptSummarizer.ts` (highest value, most used file type)
4. Implement remaining summarizers: python → go → markdown → json → yaml → sql → css → env
5. Add `PreviewFileParams` to `files/types.ts`
6. Add `PreviewFileTool` to `fileTools.ts`
7. Register in `files/index.ts` (both `createFileTools` and `createReadOnlyFileTools`)
8. Write unit tests per summarizer in `packages/core/src/__tests__/tools/files/summarizers/`

---

## Testing Strategy

Each summarizer is a pure function (`summarize(content: string): SummaryItem[]`), making tests
trivial: pass fixture strings, assert items array.

Test cases per summarizer:
- Happy path: typical file content, assert correct items and line numbers
- Empty file: should return `[]` with no crash
- Edge cases per language (e.g., multiline imports in TS, block imports in Go)

The `PreviewFileTool` itself gets an integration test: create a temp file, call `execute`,
assert the returned `FileSummary` shape.

---

## What This Plan Does NOT Include

- **AST-based parsing** — regex is sufficient for structural extraction and avoids runtime deps
- **Recursive directory preview** — `list_files` already handles directory enumeration; pair it
  with `preview_file` when the agent needs to scan many files
- **Caching** — file system reads are fast enough; caching adds complexity without clear need
- **Streaming / incremental output** — out of scope for this tool type
