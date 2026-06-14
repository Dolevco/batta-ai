export type { FileSummary } from './types';
import { FileSummarizer } from './types';

// ─── Concrete summarizers ──────────────────────────────────────────────────

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
