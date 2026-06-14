/**
 * Core interfaces shared across all file summarizers.
 * Kept separate from the factory to avoid circular imports.
 */

export interface SummaryItem {
  /** 1-based line number where this symbol starts */
  line: number;
  /** 'import' | 'class' | 'function' | 'method' | 'interface' | 'type' | 'enum'
   *  | 'variable' | 'heading' | 'key' | 'selector' | 'mixin' | 'table' | 'view'
   *  | 'package' | ... */
  kind: string;
  /** Symbol / heading / key name */
  name: string;
}

export interface FileSummary {
  /** Relative path, sanitised from workspacePath */
  file: string;
  /** Human label, e.g. "typescript", "python" */
  type: string;
  total_lines: number;
  /** ISO date, no time (privacy-safe) */
  last_modified: string;
  items: SummaryItem[];
}

export interface FileSummarizer {
  /** File extensions this summarizer handles, e.g. ['.ts', '.tsx'] */
  readonly extensions: string[];
  /** Language label used in the output */
  readonly languageLabel: string;
  /** Parse content and return structural items */
  summarize(content: string): SummaryItem[];
}
