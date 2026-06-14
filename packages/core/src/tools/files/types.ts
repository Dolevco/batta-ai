export type ReadFileParams = { 
  path: string;
  fromLine?: number;
  toLine?: number;
};

export type WriteFileParams = {
  path: string;
  content: string;
  line_count: number;
};

export type SearchFilesParams = {
  path: string;
  regex: string;
  file_pattern?: string;
  /** Output mode: "content" returns matching lines with context; "files_with_matches" returns only file paths. Default: "content" */
  output_mode?: 'content' | 'files_with_matches';
  /** Number of context lines to show before and after each match (only applies to "content" mode). Default: 2 */
  context_lines?: number;
  /** Case insensitive search. Default: false */
  case_insensitive?: boolean;
  /** Limit results to first N entries. Default: 250. Pass 0 for unlimited. */
  head_limit?: number;
  /** Skip first N entries before applying head_limit. Default: 0 */
  offset?: number;
};

export type ListFilesParams = {
  path: string;
  recursive?: boolean;
  file_pattern?: string;
};

export type InsertContentParams = {
  path: string;
  line: number;
  content: string;
};

export type SearchAndReplaceOptions = {
  path: string;
  search: string;
  replace: string;
  use_regex?: boolean;
  ignore_case?: boolean;
  start_line?: number;
  end_line?: number;
};

export type PreviewFileParams = {
  path: string;
};
