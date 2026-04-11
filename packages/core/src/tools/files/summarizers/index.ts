export type { SummaryItem, FileSummary, FileSummarizer } from './types';

import { FileSummarizer } from './types';

// ─── Concrete summarizers ──────────────────────────────────────────────────

export { TypeScriptSummarizer } from './typescriptSummarizer';
export { PythonSummarizer } from './pythonSummarizer';
export { GoSummarizer } from './goSummarizer';
export { MarkdownSummarizer } from './markdownSummarizer';
export { JsonSummarizer } from './jsonSummarizer';
export { YamlSummarizer } from './yamlSummarizer';
export { SqlSummarizer } from './sqlSummarizer';
export { CssSummarizer } from './cssSummarizer';
export { EnvSummarizer } from './envSummarizer';
export { GenericSummarizer } from './genericSummarizer';

import { TypeScriptSummarizer } from './typescriptSummarizer';
import { PythonSummarizer } from './pythonSummarizer';
import { GoSummarizer } from './goSummarizer';
import { MarkdownSummarizer } from './markdownSummarizer';
import { JsonSummarizer } from './jsonSummarizer';
import { YamlSummarizer } from './yamlSummarizer';
import { SqlSummarizer } from './sqlSummarizer';
import { CssSummarizer } from './cssSummarizer';
import { EnvSummarizer } from './envSummarizer';
import { GenericSummarizer } from './genericSummarizer';

// ─── Factory ───────────────────────────────────────────────────────────────

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
